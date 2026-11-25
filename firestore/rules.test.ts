import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CONTACT_LIMITS,
  contactFromEntry,
  isContactEmail,
  toStoredContact,
} from "../src/contacts/domain/contact";
import {
  DIRECTORY_LIMITS,
  directoryEntryFor,
  isGooglePhoto,
  normalizeEmail,
} from "../src/directory/domain/directory";
import {
  ROUTINE_LIMITS,
  isLocalLink,
  normalizeLink,
  toStoredRoutine,
  type RoutineDraft,
} from "../src/routines/domain/routine";
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

const routineDraft: RoutineDraft = {
  name: "Empuje",
  notes: "Calentar bien.\nHombros primero.",
  createdAt: 1_700_000_000_000,
  stages: [
    {
      name: "Bloque A",
      exercises: [
        {
          name: "Press banca",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 62.5,
          weightUnit: "kg",
          notes: "Pausa abajo",
        },
        { repsMin: 12 },
      ],
    },
    { exercises: [{ weight: 20, weightUnit: "lb" }] },
  ],
};
const routine = toStoredRoutine(routineDraft);

const workoutPath = (uid: string) => `users/${uid}/workouts/w1`;
const entryPath = (uid: string) => `users/${uid}/history/h1`;
const routinePath = (uid: string) => `users/${uid}/routines/r1`;

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
    ["routines", routinePath, routine],
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

  it("rejects anything outside the user's collections", async () => {
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

describe("routine shape", () => {
  const save = (data: object) => setDoc(freshDoc("routines"), data);
  const withStage = (stage: object) => ({ name: "R", createdAt: 1, stages: [stage] });
  const withLine = (line: string) => withStage({ exercises: line });
  const L = ROUTINE_LIMITS;

  const longestLink = `https://x.com/${"e".repeat(L.linkLength - 14)}`;

  /** Every stage, exercise and text at its limit: the most a rule ever has to evaluate. */
  const largest = toStoredRoutine({
    name: "a".repeat(L.nameLength),
    notes: "n".repeat(L.notesLength),
    createdAt: MAX_TIMESTAMP_MS,
    stages: Array.from({ length: L.stages }, () => ({
      name: "b".repeat(L.stageNameLength),
      notes: "m".repeat(L.notesLength),
      exercises: Array.from({ length: L.exercisesPerStage }, () => ({
        name: "c".repeat(L.exerciseNameLength),
        repsMin: L.reps.max - 1,
        repsMax: L.reps.max,
        restSeconds: L.restSeconds.max,
        weight: L.weight.max - 0.5,
        weightUnit: "lb" as const,
        notes: "d".repeat(L.exerciseNotesLength),
        link: longestLink,
      })),
    })),
  });

  it("accepts a routine with every optional field, and one with none", async () => {
    await assertSucceeds(save(routine));
    await assertSucceeds(save({ name: "Solo", createdAt: 1, stages: [] }));
    await assertSucceeds(save(withStage({ name: "Solo el nombre", exercises: "" })));
  });

  it("accepts the largest routine the app can write", async () => {
    expect(longestLink).toHaveLength(L.linkLength);
    expect(largest.stages[0]!.exercises).toContain(`\t${longestLink}\n`);
    await assertSucceeds(save(largest));
  });

  it("accepts an https link on an exercise, alone or with other fields", async () => {
    for (const line of [
      "\t\t\t\t\thttps://youtu.be/abc",
      "Remo\t10\t90\t60kg\tlento\thttps://www.youtube.com/watch?v=abc&t=1s",
      "\t\t\t\t\thttps://www.youtube.com/@canal",
      `\t\t\t\t\t${longestLink}`,
    ]) {
      await assertSucceeds(save(withLine(line)));
    }
  });

  it("refuses a link that is not https, holds credentials or spaces, or is too long", async () => {
    for (const link of [
      "http://x.com",
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "HTTPS://X.COM",
      "https://user:pw@x.com",
      "https://user@x.com/a",
      "https://@x.com",
      "https:// x.com",
      "https://x.com/a b",
      "https://x.com/a\u00a0b",
      "https://x.com/a\u0085b",
      "https://",
      "https:///x",
      // The host part, and the rest after it, each within the 292 characters after https://.
      // A link of 300 to 592 characters split across both still passes: the app drops it on read.
      `https://${"e".repeat(L.linkLength - 7)}`,
      `https://x.com/${"e".repeat(L.linkLength - 8)}`,
    ]) {
      await assertFails(save(withLine(`\t\t\t\t\t${link}`)));
    }
  });

  it("accepts the largest routine with every link at its longest on a real site", async () => {
    const site = "https://www.youtube.com/watch?v=";
    const link = site + "v".repeat(L.linkLength - site.length);
    expect(normalizeLink(link)).toBe(link);
    const stages = largest.stages.map((stage) => ({
      ...stage,
      exercises: stage.exercises.replaceAll(longestLink, link),
    }));
    expect(stages[L.stages - 1]!.exercises.split("\n")).toHaveLength(L.exercisesPerStage);
    expect(stages[L.stages - 1]!.exercises.endsWith(`\t${link}`)).toBe(true);
    await assertSucceeds(save({ ...largest, stages }));
  });

  it("limits the number of stages and of exercises in each", async () => {
    await assertFails(save({ ...largest, stages: [...largest.stages, largest.stages[0]] }));
    const line = "x\t\t\t\t\t";
    const lines = (count: number) => Array.from({ length: count }, () => line).join("\n");
    await assertSucceeds(save(withLine(lines(L.exercisesPerStage))));
    await assertFails(save(withLine(lines(L.exercisesPerStage + 1))));
  });

  it("requires a visible name within the limit and a valid creation time", async () => {
    await assertFails(save({ ...routine, name: "" }));
    await assertFails(save({ ...routine, name: "   " }));
    await assertFails(save({ ...routine, name: "a".repeat(L.nameLength + 1) }));
    await assertFails(save({ ...routine, name: "a\tb" }));
    await assertFails(save({ ...routine, createdAt: MAX_TIMESTAMP_MS + 1 }));
    await assertFails(save({ ...routine, createdAt: "today" }));
  });

  it("rejects extra or missing fields at every level", async () => {
    await assertFails(save({ ...routine, owner: "mallory" }));
    await assertFails(save({ name: "R", createdAt: 1 }));
    await assertFails(save(withStage({ name: "Sin ejercicios" })));
    await assertFails(save(withStage({ exercises: "", html: "<b>" })));
    await assertFails(save({ ...routine, stages: "not a list" }));
  });

  it("checks the length and characters of notes", async () => {
    await assertSucceeds(save({ ...routine, notes: "línea 1\nlínea 2" }));
    await assertFails(save({ ...routine, notes: "n".repeat(L.notesLength + 1) }));
    await assertFails(save({ ...routine, notes: "a\u0000b" }));
    await assertFails(save(withStage({ notes: "m".repeat(L.notesLength + 1), exercises: "" })));
    await assertFails(save(withStage({ name: "a\nb", exercises: "" })));
  });

  it("accepts each exercise field on its own", async () => {
    for (const line of [
      "Remo\t\t\t\t\t",
      "\t10\t\t\t\t",
      "\t8-10\t\t\t\t",
      "\t\t90\t\t\t",
      "\t\t\t60kg\t\t",
      "\t\t\t\tlento\t",
    ]) {
      await assertSucceeds(save(withLine(line)));
    }
  });

  it("rejects exercise lines that are malformed", async () => {
    for (const line of [
      // Lines written before links had five fields; nothing with them was ever published.
      "Remo\t\t\t\t",
      "Remo\t\t\t\t\t\t",
      "\t0\t\t\t\t",
      "\tdiez\t\t\t\t",
      "\t8 - 10\t\t\t\t",
      "\t\t1:30\t\t\t",
      "\t\t\t60\t\t",
      "\t\t\t60st\t\t",
      "\t\t\t62.55kg\t\t",
      `${"c".repeat(L.exerciseNameLength + 1)}\t\t\t\t\t`,
      `\t\t\t\t${"d".repeat(L.exerciseNotesLength + 1)}\t`,
      "a\u0007b\t\t\t\t\t",
    ]) {
      await assertFails(save(withLine(line)));
    }
  });

  it("mirrors the number limits in ROUTINE_LIMITS", async () => {
    const reps = (value: number) => withLine(`\t${value}\t\t\t\t`);
    const rest = (value: number) => withLine(`\t\t${value}\t\t\t`);
    const weight = (value: number) => withLine(`\t\t\t${value}kg\t\t`);
    await assertSucceeds(save(reps(L.reps.min)));
    await assertSucceeds(save(reps(L.reps.max)));
    await assertFails(save(reps(L.reps.min - 1)));
    await assertFails(save(reps(L.reps.max + 1)));
    await assertSucceeds(save(rest(L.restSeconds.min)));
    await assertSucceeds(save(rest(L.restSeconds.max)));
    await assertFails(save(rest(L.restSeconds.max + 1)));
    await assertSucceeds(save(weight(L.weight.min)));
    await assertSucceeds(save(weight(L.weight.max)));
    await assertSucceeds(save(weight(62.5)));
    await assertFails(save(weight(L.weight.max + 0.5)));
  });

  it("refuses every wrong type at each level", async () => {
    for (const data of [
      withStage({ exercises: 5 }),
      withStage({ exercises: null }),
      withStage({ exercises: ["x\t\t\t\t\t"] }),
      withStage({ name: 5, exercises: "" }),
      withStage({ notes: ["a"], exercises: "" }),
      { name: "R", createdAt: 1, stages: ["x"] },
      { name: "R", createdAt: 1, stages: [null] },
      { name: "R", createdAt: 1, stages: [...Array(9).fill({ exercises: "" }), { exercises: 5 }] },
      { ...routine, notes: 5 },
      { ...routine, createdAt: 1.5 },
    ]) {
      await assertFails(save(data));
    }
  });

  it("cannot sneak a field or line past the exercise pattern", async () => {
    for (const line of [
      "a\t\t\t\t\t\n",
      "\na\t\t\t\t\t",
      "a\t\t\t\t\t\n\nb\t\t\t\t\t",
      "a\t\t\t\t\t\r\nb\t\t\t\t\t",
      "a\t\t\t\t\t\nb\t\t\t\t\t\tc",
      "a\t\t\t\t\thttps://x.com\nb\t\t\t\t\thttps://u@x.com",
      "a\t\t\t\t\thttps://x.com\r\nb\t\t\t\t\t",
      "\t\t3601\t\t\t",
      "\t\t0900\t\t\t",
      "\t\t\t1000.5kg\t\t",
      "\t\t\t1e3kg\t\t",
      "\t\t\t62.5kgkg\t\t",
      "\t010\t\t\t\t",
      "a\u0085\t\t\t\t\t",
    ]) {
      await assertFails(save(withLine(line)));
    }
  });

  describe("links to the local network or an IP address (S12)", () => {
    const local = [
      "https://localhost",
      "https://LocalHost:5173/x",
      "https://app.localhost",
      "https://localhost.",
      "https://192.168.0.1",
      "https://8.8.8.8",
      "https://192.168.0.1:8080/admin",
      "https://8.8.8.8.",
      "https://3232235521",
      "https://0xC0A80001",
      "https://0xc0a80001/x",
      "https://0xC0.0250.0.1",
      "https://0300.0250.0.1",
      "https://127.1",
      "https://10.1.1",
      "https://[::1]",
      "https://[2001:db8::1]:8443/x",
      "https://[::ffff:192.168.0.1]",
      "https://router",
      "https://router:8080/admin",
      "https://router.",
      "https://www",
      "https://nas.local",
      "https://NAS.LOCAL/fotos",
      "https://printer.lan",
      "https://db.internal:8443",
      "https://box.home.arpa",
      "https://box.Home.Arpa.",
      "https://nas\u3002local",
      "https://192\uff0e168\uff0e0\uff0e1",
    ];
    const sites = [
      "https://youtube.com/watch?v=abc",
      "https://www.youtube.com/watch?v=abc&t=1s",
      "https://www.instagram.com/p/C1a2b3c4d5/",
      "https://youtu.be/abc",
      "https://localhost.com/x",
      "https://local.example.org",
      "https://lan.party.net",
      "https://123.example.com",
      "https://0xdead.beef.io",
      "https://example.io:8443/x",
      "https://youtube\u3002com",
    ];
    const path = routinePath("alice");
    const line = (link: string) => `Remo\t10\t\t\t\t${link}`;
    const withLink = (link: string) => withLine(`a\t\t\t\t\thttps://x.com\n${line(link)}`);

    it("refuses each one on create, as the app does", async () => {
      for (const link of local) {
        expect(isLocalLink(link), link).toBe(true);
        await assertFails(save(withLine(line(link))));
        await assertFails(save(withLink(link)));
      }
    });

    it("refuses each one on update", async () => {
      await seed(path, withLine(line("https://youtu.be/abc")));
      const db = asUser("alice");
      for (const link of local) {
        await assertFails(setDoc(doc(db, path), withLine(line(link))));
        await assertFails(updateDoc(doc(db, path), { stages: [{ exercises: line(link) }] }));
      }
    });

    it("accepts links to named sites on create and update, as the app does", async () => {
      await seed(path, withLine(line("https://youtu.be/abc")));
      for (const link of sites) {
        expect(normalizeLink(link), link).toBe(link);
        await assertSucceeds(save(withLine(line(link))));
        await assertSucceeds(save(withLink(link)));
        await assertSucceeds(setDoc(doc(asUser("alice"), path), withLine(line(link))));
      }
    });

    it("refuses a local host in any letter case", async () => {
      for (const link of ["https://LOCALHOST", "https://Router", "https://0XC0A80001"]) {
        await assertFails(save(withLine(line(link))));
      }
    });

    it("reads only the link field, not notes that look like a link", async () => {
      await assertSucceeds(save(withLine("Remo\t\t\t\thttps://router/x\thttps://youtu.be/abc")));
      await assertSucceeds(save(withLine("https://localhost/x\t\t\t\t\t")));
      await assertSucceeds(save(withLine("Remo\t\t\t\thttps://[::1]\t")));
    });

    it("keeps every link the app accepts within the rules, and refuses every one it does not", async () => {
      for (const link of [
        ...local,
        ...sites,
        "https://you%2Ecom",
        "https://youtube\u2024com",
        "https://a.1..",
        "https://x.0x",
        "https://www.",
        "https://.com",
      ]) {
        const accepted = normalizeLink(link) === link;
        const stored = toStoredRoutine({
          name: "R",
          createdAt: 1,
          stages: [{ exercises: [{ name: "Remo", link }] }],
        });
        expect(stored.stages[0]!.exercises, link).toBe(
          accepted ? `Remo\t\t\t\t\t${link}` : "Remo\t\t\t\t\t",
        );
        await assertSucceeds(save(stored));
        if (accepted) await assertSucceeds(save(withLine(line(link))));
        if (isLocalLink(link)) await assertFails(save(withLine(line(link))));
      }
    });

    it("keeps a routine stored with one: it can be deleted or resent, and saved once fixed", async () => {
      const stored = withLine(line("https://192.168.0.1/video"));
      await seed(path, stored);
      const db = asUser("alice");
      await assertSucceeds(getDoc(doc(db, path)));
      await assertSucceeds(setDoc(doc(db, path), stored));
      await assertFails(setDoc(doc(db, path), { ...stored, name: "Renombrada" }));
      await assertSucceeds(setDoc(doc(db, path), { ...withLine(line("")), name: "Renombrada" }));
      await assertSucceeds(deleteDoc(doc(db, path)));
    });
  });

  it("accepts multibyte text the app writes, and edits of the largest routine", async () => {
    const e = "\u{1F4AA}";
    await assertSucceeds(
      save(
        toStoredRoutine({
          name: e.repeat(20),
          notes: e.repeat(250),
          createdAt: 1,
          stages: [
            {
              name: e.repeat(20),
              notes: e.repeat(250),
              exercises: [{ name: e.repeat(20), notes: e.repeat(60), weight: 0 }],
            },
          ],
        }),
      ),
    );
    const path = routinePath("alice");
    await seed(path, largest);
    await assertSucceeds(
      setDoc(doc(asUser("alice"), path), { ...largest, name: "b".repeat(L.nameLength) }),
    );
  });

  it("denies collection-group reads of routines", async () => {
    await assertFails(getDocs(collectionGroup(asUser("mallory"), "routines")));
  });

  it("lets an edit remove the routine's notes, as the app sends it", async () => {
    await seed(routinePath("alice"), routine);
    const { notes: _removed, ...withoutNotes } = routine;
    await assertSucceeds(
      updateDoc(doc(asUser("alice"), routinePath("alice")), {
        ...withoutNotes,
        notes: deleteField(),
      }),
    );
  });

  it("lets the owner edit a routine while it keeps its creation time", async () => {
    await seed(routinePath("alice"), routine);
    const path = routinePath("alice");
    const edited = toStoredRoutine({ ...routineDraft, name: "Empuje B", stages: [] });
    await assertSucceeds(setDoc(doc(asUser("alice"), path), edited));
    await assertFails(setDoc(doc(asUser("alice"), path), { ...edited, createdAt: 2 }));
    await assertFails(setDoc(doc(asUser("alice"), path), { ...edited, name: "" }));
    await assertFails(setDoc(doc(asUser("mallory"), path), edited));
  });
});

describe("directory", () => {
  const aliceEmail = "alice@example.com";
  const entryPath = (email: string) => `directory/${email}`;
  const aliceEntry = directoryEntryFor({
    id: "alice",
    name: "Alice Liddell",
    email: aliceEmail,
    photoUrl: "https://lh3.googleusercontent.com/a/alice=s96-c",
  });
  /** Signed in with Google, so the token carries the account's email, verified unless told. */
  const signedIn = (uid: string, email: string, emailVerified = true) =>
    env.authenticatedContext(uid, { email, email_verified: emailVerified }).firestore();
  const asAlice = () => signedIn("alice", aliceEmail);
  const write = (data: object, db = asAlice(), email = aliceEmail) =>
    setDoc(doc(db, entryPath(email)), data);

  it("lets anyone signed in read one exact email, and nobody signed out", async () => {
    await seed(entryPath(aliceEmail), aliceEntry);
    const found = await assertSucceeds(
      getDoc(doc(signedIn("bob", "bob@example.com"), entryPath(aliceEmail))),
    );
    expect(found.data()).toEqual(aliceEntry);
    await assertSucceeds(getDoc(doc(asUser("bob"), entryPath("nobody@example.com"))));
    await assertFails(getDoc(doc(asGuest(), entryPath(aliceEmail))));
  });

  it("never lists it, not even for an entry's owner", async () => {
    await seed(entryPath(aliceEmail), aliceEntry);
    await assertFails(getDocs(collection(asAlice(), "directory")));
    await assertFails(getDocs(collection(signedIn("bob", "bob@example.com"), "directory")));
    await assertFails(getDocs(collection(asGuest(), "directory")));
    await assertFails(getDocs(collectionGroup(asAlice(), "directory")));
  });

  it("lets the owner of a verified email list themselves, and change and resend it", async () => {
    await assertSucceeds(write(aliceEntry));
    await assertSucceeds(write(aliceEntry));
    await assertSucceeds(write({ ...aliceEntry, name: "Alice L." }));
  });

  it("matches the token's email however it is written", async () => {
    await assertSucceeds(write(aliceEntry, signedIn("alice", " Alice@Example.COM ")));
    await assertFails(write(aliceEntry, asAlice(), "Alice@Example.com"));
  });

  it("refuses an entry under someone else's email", async () => {
    await assertFails(write(aliceEntry, signedIn("alice", aliceEmail), "bob@example.com"));
    await assertFails(
      write({ ...aliceEntry, uid: "mallory" }, signedIn("mallory", "mallory@example.com")),
    );
  });

  it("refuses an email that is not verified, or a token without one", async () => {
    await assertFails(write(aliceEntry, signedIn("alice", aliceEmail, false)));
    await assertFails(write(aliceEntry, asUser("alice")));
    await assertFails(write(aliceEntry, asGuest()));
  });

  it("refuses a uid that is not the writer's", async () => {
    await assertFails(write({ ...aliceEntry, uid: "bob" }));
    await assertFails(write({ ...aliceEntry, uid: 7 }));
  });

  it("refuses extra, missing or oversized fields", async () => {
    await assertFails(write({ ...aliceEntry, email: aliceEmail }));
    await assertFails(write({ uid: "alice", photo: "" }));
    await assertFails(write({ name: "Alice", photo: "" }));
    await assertFails(write({ ...aliceEntry, name: "a".repeat(DIRECTORY_LIMITS.nameLength + 1) }));
    await assertSucceeds(write({ ...aliceEntry, name: "a".repeat(DIRECTORY_LIMITS.nameLength) }));
    await assertFails(write({ ...aliceEntry, name: 7 }));
    await assertFails(write({ ...aliceEntry, name: "Alice\nLiddell" }));
    const base = "https://lh3.googleusercontent.com/";
    const longest = base + "a".repeat(DIRECTORY_LIMITS.photoLength - base.length);
    await assertSucceeds(write({ ...aliceEntry, photo: longest }));
    await assertFails(write({ ...aliceEntry, photo: `${longest}a` }));
  });

  it("accepts an empty name and an empty or absent photo", async () => {
    await assertSucceeds(write({ ...aliceEntry, name: "", photo: "" }));
    await assertSucceeds(write({ uid: "alice", name: "Alice" }));
  });

  it("refuses a photo that is not https on googleusercontent.com", async () => {
    for (const photo of [
      "http://lh3.googleusercontent.com/a",
      "https://evil.com/a.png",
      "https://lh3.googleusercontent.com.evil.com/a",
      "https://evilgoogleusercontent.com/a",
      "https://user@lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com:8080/a",
      "https://lh3.googleusercontent.com/a b",
      "javascript:alert(1)",
      7,
      null,
    ]) {
      await assertFails(write({ ...aliceEntry, photo }));
    }
  });

  it("lets only the owner delete it", async () => {
    await seed(entryPath(aliceEmail), aliceEntry);
    await assertFails(deleteDoc(doc(signedIn("bob", "bob@example.com"), entryPath(aliceEmail))));
    // Even one signed in with the same email, under another account.
    await assertFails(deleteDoc(doc(signedIn("mallory", aliceEmail), entryPath(aliceEmail))));
    await assertFails(deleteDoc(doc(asGuest(), entryPath(aliceEmail))));
    await assertSucceeds(deleteDoc(doc(asAlice(), entryPath(aliceEmail))));
  });

  it("keeps every entry the app writes within the rules", async () => {
    for (const user of [
      { id: "alice", name: "💪".repeat(80), email: aliceEmail, photoUrl: null },
      { id: "alice", name: aliceEmail, email: aliceEmail, photoUrl: "https://example.com/a.png" },
      {
        id: "alice",
        name: "Ana\tPérez\u0000",
        email: aliceEmail,
        photoUrl: "https://lh3.googleusercontent.com/a/x",
      },
    ]) {
      await assertSucceeds(write(directoryEntryFor(user), asAlice(), normalizeEmail(user.email)));
    }
  });

  it("refuses every query, filtered or limited (S11)", async () => {
    await seed(entryPath(aliceEmail), aliceEntry);
    const bob = signedIn("bob", "bob@example.com");
    for (const q of [
      query(collection(bob, "directory"), limit(1)),
      query(collection(bob, "directory"), where("uid", "==", "alice")),
      query(collection(bob, "directory"), where(documentId(), "==", aliceEmail)),
      query(collection(bob, "directory"), where(documentId(), "in", [aliceEmail]), limit(1)),
      query(collection(bob, "directory"), orderBy("name"), limit(1)),
    ]) {
      await assertFails(getDocs(q));
    }
  });

  it("refuses a document id that differs from the normalized email (S11)", async () => {
    for (const id of [
      " alice@example.com",
      "alice@example.com ",
      "alice@example.com\u00a0",
      "alice@example.co",
    ]) {
      await assertFails(write(aliceEntry, asAlice(), id));
    }
    await assertFails(write(aliceEntry, signedIn("alice", aliceEmail, "true" as never)));
  });

  it("refuses more photo look-alikes (S11, S5)", async () => {
    for (const photo of [
      "https://user:pw@googleusercontent.com/a",
      "https://lh3.googleusercontent.com:443/a",
      "https://LH3.googleusercontent.com/a",
      "HTTPS://lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com%2eevil.com/a",
      "https://lh3.googleusercontent.com./a",
      "https://evil.com\\@lh3.googleusercontent.com/a",
      "https://evil.com#.googleusercontent.com/a",
      "//lh3.googleusercontent.com/a",
      "https://\uff47oogleusercontent.com/a",
      "https://lh3.googleusercontent.com/a\u00a0",
      "data:image/png;base64,AAAA",
    ]) {
      await assertFails(write({ ...aliceEntry, photo }));
    }
  });

  it("never lets an update hand the entry to another uid or add a key (S11)", async () => {
    await seed(entryPath(aliceEmail), aliceEntry);
    const entry = (db = asAlice()) => doc(db, entryPath(aliceEmail));
    await assertFails(updateDoc(entry(), { uid: "bob" }));
    await assertFails(updateDoc(entry(), { extra: 1 }));
    await assertFails(updateDoc(entry(), { name: deleteField() }));
    await assertFails(updateDoc(entry(signedIn("bob", "bob@example.com")), { uid: "bob" }));
  });

  it("refuses deleting a missing entry, which the app resolves by asking the server (S11)", async () => {
    await assertFails(deleteDoc(doc(asAlice(), entryPath(aliceEmail))));
  });
});

describe("contacts (S11, S5)", () => {
  const bobEmail = "bob@example.com";
  const bobEntry = directoryEntryFor({
    id: "bob",
    name: "Bob Stone",
    email: bobEmail,
    photoUrl: "https://lh3.googleusercontent.com/a/bob=s96-c",
  });
  const bobContact = toStoredContact({ ...bobEntry, email: bobEmail });
  const contactPath = (owner: string, contactUid: string) =>
    `users/${owner}/contacts/${contactUid}`;
  const add = (data: object, db = asUser("alice"), id = "bob") =>
    setDoc(doc(db, contactPath("alice", id)), data);

  beforeEach(async () => {
    await seed(`directory/${bobEmail}`, bobEntry);
  });

  it("lets the owner add, read, list, resend and delete a contact who is listed", async () => {
    const db = asUser("alice");
    await assertSucceeds(add(bobContact));
    await assertSucceeds(add(bobContact));
    const read = await assertSucceeds(getDoc(doc(db, contactPath("alice", "bob"))));
    expect(read.data()).toEqual(bobContact);
    await assertSucceeds(getDocs(collection(db, "users/alice/contacts")));
    await assertSucceeds(deleteDoc(doc(db, contactPath("alice", "bob"))));
  });

  it("hides a user's contacts from everyone else, and refuses their writes", async () => {
    await seed(contactPath("alice", "bob"), bobContact);
    for (const db of [asUser("mallory"), asUser("bob"), asGuest()]) {
      await assertFails(getDoc(doc(db, contactPath("alice", "bob"))));
      await assertFails(getDocs(collection(db, "users/alice/contacts")));
      await assertFails(setDoc(doc(db, contactPath("alice", "bob")), bobContact));
      await assertFails(updateDoc(doc(db, contactPath("alice", "bob")), { name: "X" }));
      await assertFails(deleteDoc(doc(db, contactPath("alice", "bob"))));
    }
    await assertFails(getDocs(collectionGroup(asUser("mallory"), "contacts")));
  });

  it("refuses a document id that is not the contact's uid, and adding yourself", async () => {
    await assertFails(add(bobContact, asUser("alice"), "carol"));
    await seed("directory/alice@example.com", { uid: "alice", name: "Alice", photo: "" });
    await assertFails(
      add(
        { uid: "alice", name: "Alice", photo: "", email: "alice@example.com" },
        asUser("alice"),
        "alice",
      ),
    );
  });

  it("refuses someone not listed, or listed under that email by another account", async () => {
    await assertFails(add({ ...bobContact, email: "carol@example.com" }));
    await seed("directory/carol@example.com", { uid: "carol", name: "", photo: "" });
    await assertFails(add({ ...bobContact, email: "carol@example.com" }));
  });

  it("still lets the owner delete a contact who left the directory", async () => {
    await seed(contactPath("alice", "bob"), bobContact);
    await env.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), `directory/${bobEmail}`));
    });
    await assertSucceeds(getDoc(doc(asUser("alice"), contactPath("alice", "bob"))));
    await assertSucceeds(deleteDoc(doc(asUser("alice"), contactPath("alice", "bob"))));
  });

  it("refuses extra, missing, mistyped or oversized fields", async () => {
    const { photo: _photo, ...withoutPhoto } = bobContact;
    await assertFails(add({ ...bobContact, extra: 1 }));
    await assertFails(add(withoutPhoto));
    await assertFails(add({ ...bobContact, uid: 7 }));
    await assertFails(add({ ...bobContact, name: 7 }));
    await assertFails(add({ ...bobContact, name: "Bob\nStone" }));
    await assertFails(add({ ...bobContact, name: "a".repeat(DIRECTORY_LIMITS.nameLength + 1) }));
    await assertSucceeds(add({ ...bobContact, name: "a".repeat(DIRECTORY_LIMITS.nameLength) }));
    await assertSucceeds(add({ ...bobContact, name: "", photo: "" }));
    await assertFails(add({ ...bobContact, email: 7 }));
    const base = "https://lh3.googleusercontent.com/";
    const longest = base + "a".repeat(DIRECTORY_LIMITS.photoLength - base.length);
    await assertSucceeds(add({ ...bobContact, photo: longest }));
    await assertFails(add({ ...bobContact, photo: `${longest}a` }));
  });

  it("refuses an email that is too long or not an address, even when listed", async () => {
    const longest = `${"b".repeat(CONTACT_LIMITS.emailLength - "@x.io".length)}@x.io`;
    await seed(`directory/${longest}`, bobEntry);
    await assertSucceeds(add({ ...bobContact, email: longest }));
    for (const email of [`b${longest}`, "bob", "bob@@example.com", "bob example@x.io"]) {
      await seed(`directory/${email}`, bobEntry);
      await assertFails(add({ ...bobContact, email }));
    }
    await assertFails(add({ ...bobContact, email: "bob@example.com/../x" }));
  });

  it("refuses a photo that is not https on googleusercontent.com", async () => {
    for (const photo of [
      "http://lh3.googleusercontent.com/a",
      "https://evil.com/a.png",
      "https://lh3.googleusercontent.com.evil.com/a",
      "https://user@lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com:8080/a",
      "https://lh3.googleusercontent.com/a b",
      "javascript:alert(1)",
      7,
      null,
    ]) {
      await assertFails(add({ ...bobContact, photo }));
    }
  });

  it("never lets an update hand the contact to another uid or add a key", async () => {
    await seed(contactPath("alice", "bob"), bobContact);
    const contact = doc(asUser("alice"), contactPath("alice", "bob"));
    await assertFails(updateDoc(contact, { uid: "carol" }));
    await assertFails(updateDoc(contact, { extra: 1 }));
    await assertFails(updateDoc(contact, { name: deleteField() }));
    await assertSucceeds(updateDoc(contact, { name: "Bobby" }));
  });

  it("keeps every contact the app writes within the rules", async () => {
    for (const entry of [
      { uid: "bob", name: "💪".repeat(80), photo: "" },
      { uid: "bob", name: "Bob\tStone\u0000", photo: "https://example.com/a.png" },
      { uid: "bob", name: 7, photo: "https://lh3.googleusercontent.com/a/x" },
    ]) {
      const contact = contactFromEntry(bobEmail, entry);
      expect(contact).not.toBeNull();
      await assertSucceeds(add(toStoredContact(contact as NonNullable<typeof contact>)));
    }
  });
});

describe("contacts: verifier probes (S5, S11)", () => {
  const bobEmail = "bob@example.com";
  const bob = { uid: "bob", name: "Bob", photo: "", email: bobEmail };
  const path = (owner: string, id: string) => `users/${owner}/contacts/${id}`;
  const put = (
    data: unknown,
    { owner = "alice", id = "bob", as }: { owner?: string; id?: string; as?: string } = {},
  ) => setDoc(doc(asUser(as ?? owner), path(owner, id)), data as object);
  beforeEach(async () => {
    await seed(`directory/${bobEmail}`, { uid: "bob", name: "Bob", photo: "" });
  });

  it("refuses collection-group reads to everyone, the owner included", async () => {
    await seed(path("alice", "bob"), bob);
    for (const db of [asUser("alice"), asUser("mallory"), asGuest()]) {
      await assertFails(getDocs(collectionGroup(db, "contacts")));
      await assertFails(getDocs(query(collectionGroup(db, "contacts"), where("uid", "==", "bob"))));
    }
  });

  it("refuses writes below a contact or into someone else's list", async () => {
    await assertFails(setDoc(doc(asUser("alice"), `${path("alice", "bob")}/x/y`), { a: 1 }));
    await assertFails(put(bob, { as: "mallory" }));
    await assertSucceeds(put(bob, { owner: "mallory" }));
  });

  it("refuses another uid, an entry naming someone else, and yourself under any email", async () => {
    await seed("directory/carol@example.com", { uid: "carol", name: "", photo: "" });
    await assertFails(put({ ...bob, uid: "carol", email: "carol@example.com" }));
    await assertFails(put({ ...bob, email: "carol@example.com" }));
    await seed("directory/alias@example.com", { uid: "alice", name: "", photo: "" });
    await assertFails(put({ ...bob, uid: "alice", email: "alias@example.com" }, { id: "alice" }));
  });

  it("refuses emails that only look like the listed one", async () => {
    for (const email of [
      "Bob@example.com",
      " bob@example.com",
      "bob@example.com ",
      "bob@example.com\t",
      "bob@example.com\u200b",
      "bob@ex%61mple.com",
      "b\u043eb@example.com",
      "bob@example.com/..",
      "../bob@example.com",
      "bob%2F..%2Fbob@example.com",
      "__bob@example.com__",
      "x$(database)@y",
    ]) {
      await assertFails(put({ ...bob, email }));
    }
  });

  it("reads the email as one literal document id", async () => {
    const odd = "a#b?c[d]*%2F@x.io";
    expect(isContactEmail(odd)).toBe(true);
    await seed(`directory/${odd}`, { uid: "bob", name: "", photo: "" });
    await assertSucceeds(put({ ...bob, email: odd }));
  });

  it("refuses missing keys and values that are not text", async () => {
    for (const key of ["uid", "name", "photo", "email"] as const) {
      const { [key]: _gone, ...rest } = bob;
      await assertFails(put(rest));
    }
    for (const [key, value] of [
      ["email", null],
      ["email", [bobEmail]],
      ["photo", {}],
      ["photo", ["https://lh3.googleusercontent.com/a"]],
      ["name", null],
      ["uid", null],
    ] as const) {
      await assertFails(put({ ...bob, [key]: value }));
    }
  });

  it("refuses every photo look-alike, as the domain does", async () => {
    const long = "https://lh3.googleusercontent.com/" + "a".repeat(467);
    for (const photo of [
      "HTTPS://lh3.googleusercontent.com/a",
      "https://LH3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com",
      "https://lh3.googleusercontent.com?x=1",
      "https://lh3.googleusercontent.com#x",
      "https://lh3.googleusercontent.com./a",
      "https://lh3.googleusercontent.com\\@evil.com/a",
      "https://evilgoogleusercontent.com/a",
      "https://lh3.googleusercontent.co/a",
      "https://lh3.googleusercontent.com/a\u0000",
      "https://lh3.googleusercontent.com/a\n",
      "https://lh3.googleusercontent.com/a\u00a0",
      "https://lh3.googleusercontent.com/a\u2028",
      " https://lh3.googleusercontent.com/a",
      "//lh3.googleusercontent.com/a",
      "data:image/svg+xml,<svg/>",
      "https://lh3.googleusercontent\u3002com/a",
      "https:/lh3.googleusercontent.com/a",
      "ftp://lh3.googleusercontent.com/a",
      long,
    ]) {
      expect(isGooglePhoto(photo)).toBe(false);
      await assertFails(put({ ...bob, photo }));
    }
  });

  it("accepts the largest contact in one write", async () => {
    const base = "https://lh3.googleusercontent.com/";
    const email = `${"b".repeat(CONTACT_LIMITS.emailLength - 5)}@x.io`;
    await seed(`directory/${email}`, { uid: "bob", name: "", photo: "" });
    await assertSucceeds(
      put({
        uid: "bob",
        name: "a".repeat(100),
        photo: base + "a".repeat(DIRECTORY_LIMITS.photoLength - base.length),
        email,
      }),
    );
  });

  it("after the contact leaves the directory: resend and delete pass, edits do not", async () => {
    await seed(path("alice", "bob"), bob);
    await env.withSecurityRulesDisabled((c) =>
      deleteDoc(doc(c.firestore(), `directory/${bobEmail}`)),
    );
    await assertSucceeds(put(bob));
    await assertFails(updateDoc(doc(asUser("alice"), path("alice", "bob")), { name: "X" }));
    await assertSucceeds(deleteDoc(doc(asUser("alice"), path("alice", "bob"))));
    await assertSucceeds(deleteDoc(doc(asUser("alice"), path("alice", "bob"))));
  });

  it("moves to another email only when it lists the same uid", async () => {
    await seed(path("alice", "bob"), bob);
    await seed("directory/bob2@example.com", { uid: "bob", name: "", photo: "" });
    await seed("directory/carol@example.com", { uid: "carol", name: "", photo: "" });
    const ref = doc(asUser("alice"), path("alice", "bob"));
    await assertFails(updateDoc(ref, { email: "carol@example.com" }));
    await assertSucceeds(updateDoc(ref, { email: "bob2@example.com" }));
  });
});
