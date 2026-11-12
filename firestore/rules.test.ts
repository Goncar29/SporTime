import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { MAX_TIMESTAMP_MS } from "../src/shared/domain/timestamp";
import {
  MAX_ROUND_NAME_LENGTH,
  MODES,
  LIMITS,
  defaultConfig,
  toStoredConfig,
  type NumericField,
} from "../src/workouts/domain/workout";

let env: RulesTestEnvironment;

const asUser = (uid: string) => env.authenticatedContext(uid).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

const config = defaultConfig("tabata");
const workout = { name: "Leg day", config, createdAt: 1_700_000_000_000 };
const entry = { config, finishedAt: 1_700_000_000_000, activeMs: 240_000, marks: 0 };

const workoutPath = (uid: string) => `users/${uid}/workouts/w1`;
const entryPath = (uid: string) => `users/${uid}/history/h1`;

/** A new document each time: writing twice to one path would be rejected as an update. */
let nextId = 0;
const freshDoc = (kind: string) => doc(asUser("alice"), `users/alice/${kind}/doc-${++nextId}`);

async function seed(path: string, data: object) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-sportime",
    firestore: { rules: readFileSync("firestore/firestore.rules", "utf8") },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

afterAll(async () => {
  await env.cleanup();
});

describe("ownership", () => {
  for (const [label, path, data] of [
    ["workouts", workoutPath, workout],
    ["history", entryPath, entry],
  ] as const) {
    describe(label, () => {
      it("lets a user create, read, list and delete their own documents", async () => {
        const db = asUser("alice");
        await assertSucceeds(setDoc(doc(db, path("alice")), data));
        await assertSucceeds(getDoc(doc(db, path("alice"))));
        await assertSucceeds(getDocs(collection(db, `users/alice/${label}`)));
        await assertSucceeds(deleteDoc(doc(db, path("alice"))));
      });

      it("hides them from every other user", async () => {
        await seed(path("alice"), data);
        const db = asUser("mallory");
        await assertFails(getDoc(doc(db, path("alice"))));
        await assertFails(getDocs(collection(db, `users/alice/${label}`)));
        await assertFails(setDoc(doc(db, path("alice")), data));
        await assertFails(deleteDoc(doc(db, path("alice"))));
      });

      it("rejects anyone signed out", async () => {
        await seed(path("alice"), data);
        const db = asGuest();
        await assertFails(getDoc(doc(db, path("alice"))));
        await assertFails(getDocs(collection(db, `users/alice/${label}`)));
        await assertFails(setDoc(doc(db, path("alice")), data));
        await assertFails(deleteDoc(doc(db, path("alice"))));
      });

      it("accepts the same document again, as the SDK resends after a lost answer", async () => {
        await seed(path("alice"), data);
        await assertSucceeds(setDoc(doc(asUser("alice"), path("alice")), data));
        await assertFails(setDoc(doc(asUser("mallory"), path("alice")), data));
      });
    });
  }

  it("keeps a history entry immutable", async () => {
    await seed(entryPath("alice"), entry);
    const changed = { ...entry, config: defaultConfig("amrap") };
    await assertFails(
      updateDoc(doc(asUser("alice"), entryPath("alice")), { config: changed.config }),
    );
    await assertFails(setDoc(doc(asUser("alice"), entryPath("alice")), changed));
  });

  it("rejects anything outside the two collections", async () => {
    const db = asUser("alice");
    await assertFails(setDoc(doc(db, "users/alice"), { name: "Alice" }));
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(setDoc(doc(db, "users/alice/other/x"), { a: 1 }));
    await assertFails(setDoc(doc(db, "public/x"), { a: 1 }));
    await assertFails(getDocs(collection(db, "users")));
  });
});

describe("saved workout shape", () => {
  const save = (data: object) => setDoc(freshDoc("workouts"), data);

  it("accepts the defaults of every mode", async () => {
    for (const { id } of MODES) {
      await assertSucceeds(save({ ...workout, config: defaultConfig(id) }));
    }
  });

  it("accepts a name of 1 and 40 characters", async () => {
    await assertSucceeds(save({ ...workout, name: "a" }));
    await assertSucceeds(save({ ...workout, name: "a".repeat(40) }));
  });

  it("rejects an invalid name", async () => {
    for (const name of ["", "   ", "a".repeat(41), 7, null]) {
      await assertFails(save({ ...workout, name }));
    }
  });

  it("rejects extra or missing fields", async () => {
    await assertFails(save({ ...workout, email: "alice@example.com" }));
    await assertFails(save({ name: workout.name, config }));
    await assertFails(save({ name: workout.name, createdAt: workout.createdAt }));
  });

  it("rejects a createdAt that is not a date the app can show", async () => {
    await assertFails(save({ ...workout, createdAt: "today" }));
    await assertFails(save({ ...workout, createdAt: 1.5 }));
    await assertFails(save({ ...workout, createdAt: -1 }));
    await assertFails(save({ ...workout, createdAt: MAX_TIMESTAMP_MS + 1 }));
    await assertSucceeds(save({ ...workout, createdAt: MAX_TIMESTAMP_MS }));
  });

  it("counts a name's length like the app does", async () => {
    await assertSucceeds(save({ ...workout, name: "💪".repeat(20) }));
    await assertFails(save({ ...workout, name: "💪".repeat(21) }));
  });
});

describe("history entry shape", () => {
  const add = (data: object) => setDoc(freshDoc("history"), data);

  it("accepts the upper limits", async () => {
    await assertSucceeds(add({ ...entry, activeMs: 604_800_000, marks: 10_000 }));
  });

  it("rejects extra or missing fields", async () => {
    await assertFails(add({ ...entry, note: "x" }));
    await assertFails(add({ config, finishedAt: entry.finishedAt, activeMs: entry.activeMs }));
  });

  it("rejects out-of-range or mistyped values", async () => {
    for (const change of [
      { activeMs: -1 },
      { activeMs: 604_800_001 },
      { activeMs: 1.5 },
      { marks: -1 },
      { marks: 10_001 },
      { finishedAt: "now" },
      { finishedAt: -1 },
      { finishedAt: MAX_TIMESTAMP_MS + 1 },
    ]) {
      await assertFails(add({ ...entry, ...change }));
    }
  });
});

describe("workout config", () => {
  const save = (data: object) => setDoc(freshDoc("workouts"), { ...workout, config: data });

  const fields = Object.keys(LIMITS) as NumericField[];

  it("accepts each field at its domain limits", async () => {
    for (const key of fields) {
      await assertSucceeds(save({ ...config, [key]: LIMITS[key].min }));
      await assertSucceeds(save({ ...config, [key]: LIMITS[key].max }));
    }
  });

  it("rejects each field past its domain limits or with the wrong type", async () => {
    for (const key of fields) {
      await assertFails(save({ ...config, [key]: LIMITS[key].min - 1 }));
      await assertFails(save({ ...config, [key]: LIMITS[key].max + 1 }));
      await assertFails(save({ ...config, [key]: 1.5 }));
      await assertFails(save({ ...config, [key]: "1" }));
    }
  });

  it("rejects an unknown mode, extra fields and missing fields", async () => {
    await assertFails(save({ ...config, mode: "yoga" }));
    await assertFails(save({ ...config, extra: 1 }));
    const { rounds: _rounds, ...withoutRounds } = config;
    await assertFails(save(withoutRounds));
  });
});

describe("round names", () => {
  // Stored as one string, a name per line, so the rules can check every name is text.
  const named = { ...config, roundNames: "Burpees\n\nSentadillas 💪" };
  const save = (data: object) => setDoc(freshDoc("workouts"), { ...workout, config: data });
  const add = (data: object) => setDoc(freshDoc("history"), { ...entry, config: data });
  const longest = "a".repeat(MAX_ROUND_NAME_LENGTH);
  const lines = (count: number, name = longest) => Array<string>(count).fill(name).join("\n");

  it("are optional, so configs written before them still pass", async () => {
    await assertSucceeds(save(config));
    await assertSucceeds(add(config));
  });

  it("are accepted in saved workouts and history entries", async () => {
    await assertSucceeds(save(named));
    await assertSucceeds(add(named));
  });

  it("accept what the app stores", async () => {
    const stored = toStoredConfig({ ...config, roundNames: [" Burpees ", "", "Squats"] });
    expect(stored.roundNames).toBe("Burpees\n\nSquats");
    await assertSucceeds(save(stored));
  });

  it("accept one name per round at the longest length, for the most rounds", async () => {
    const rounds = LIMITS.rounds.max;
    await assertSucceeds(save({ ...config, rounds, roundNames: lines(rounds) }));
  });

  it("reject more names than rounds", async () => {
    await assertFails(save({ ...config, rounds: 2, roundNames: "a\nb\nc" }));
    await assertFails(save({ ...config, rounds: 2, roundNames: "\n\nc" }));
    const rounds = LIMITS.rounds.max;
    await assertFails(save({ ...config, rounds, roundNames: lines(rounds + 1, "a") }));
  });

  it("reject a name that is too long or untrimmed, and an empty last line", async () => {
    for (const roundNames of [
      "a".repeat(MAX_ROUND_NAME_LENGTH + 1),
      `Burpees\n${"a".repeat(MAX_ROUND_NAME_LENGTH + 1)}`,
      " Burpees",
      "Burpees ",
      "Burpees\n Squats",
      "Burpees\n",
      "",
    ]) {
      await assertFails(save({ ...config, roundNames }));
    }
  });

  it("reject anything that is not text", async () => {
    for (const roundNames of [7, null, true, ["Burpees"], [7], { 0: "Burpees" }]) {
      await assertFails(save({ ...config, roundNames }));
      await assertFails(add({ ...config, roundNames }));
    }
  });

  it("are rejected in modes without rounds", async () => {
    await assertFails(save({ ...defaultConfig("amrap"), roundNames: "Burpees" }));
  });

  it("accept the most rounds of the longest accented or emoji names, in both collections", async () => {
    const rounds = LIMITS.rounds.max;
    for (const name of [
      "é".repeat(MAX_ROUND_NAME_LENGTH),
      "💪".repeat(MAX_ROUND_NAME_LENGTH / 2),
    ]) {
      const most = { ...config, rounds, roundNames: lines(rounds, name) };
      await assertSucceeds(save(most));
      await assertSucceeds(add(most));
    }
  });

  it("are rejected for stopwatch, For Time and AMRAP in both collections", async () => {
    for (const mode of ["stopwatch", "forTime", "amrap"] as const) {
      const withNames = { ...defaultConfig(mode), roundNames: "Burpees" };
      await assertFails(save(withNames));
      await assertFails(add(withNames));
    }
  });

  it("cannot be added to a history entry already saved", async () => {
    await seed(entryPath("alice"), entry);
    await assertFails(
      updateDoc(doc(asUser("alice"), entryPath("alice")), { "config.roundNames": "Burpees" }),
    );
  });

  it("can be added to a saved workout by editing it", async () => {
    await seed(workoutPath("alice"), workout);
    await assertSucceeds(
      updateDoc(doc(asUser("alice"), workoutPath("alice")), { "config.roundNames": "Burpees" }),
    );
  });
});

describe("editing a saved workout", () => {
  const path = workoutPath("alice");
  const edited = {
    name: "Leg day, harder",
    config: toStoredConfig({ ...defaultConfig("emom"), rounds: 12, roundNames: ["Squats"] }),
    createdAt: workout.createdAt,
  };

  beforeEach(async () => {
    await seed(path, workout);
  });

  it("lets the owner change the name, the type and every setting", async () => {
    await assertSucceeds(setDoc(doc(asUser("alice"), path), edited));
    await env.withSecurityRulesDisabled(async (context) => {
      expect((await getDoc(doc(context.firestore(), path))).data()).toEqual(edited);
    });
  });

  it("lets the owner change one field at a time", async () => {
    await assertSucceeds(updateDoc(doc(asUser("alice"), path), { name: "Renamed" }));
  });

  it("keeps its creation time, which sets its place in the list", async () => {
    await assertFails(setDoc(doc(asUser("alice"), path), { ...edited, createdAt: Date.now() }));
    await assertFails(updateDoc(doc(asUser("alice"), path), { createdAt: 1 }));
  });

  it("checks the result like a new workout", async () => {
    const db = asUser("alice");
    await assertFails(updateDoc(doc(db, path), { name: "   " }));
    await assertFails(updateDoc(doc(db, path), { name: "x".repeat(41) }));
    await assertFails(updateDoc(doc(db, path), { "config.rounds": 100 }));
    await assertFails(updateDoc(doc(db, path), { "config.mode": "yoga" }));
    await assertFails(updateDoc(doc(db, path), { extra: true }));
  });

  it("is refused to anyone else", async () => {
    await assertFails(setDoc(doc(asUser("mallory"), path), edited));
    await assertFails(updateDoc(doc(asUser("mallory"), path), { name: "Mine now" }));
    await assertFails(setDoc(doc(asGuest(), path), edited));
  });
});
