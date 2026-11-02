import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vite-plus/test";
import { MODES, LIMITS, defaultConfig, type NumericField } from "../src/workouts/domain/workout";

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

      it("keeps a saved document immutable", async () => {
        await seed(path("alice"), data);
        await assertFails(updateDoc(doc(asUser("alice"), path("alice")), { config }));
      });
    });
  }

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

  it("rejects a createdAt that is not an integer", async () => {
    await assertFails(save({ ...workout, createdAt: "today" }));
    await assertFails(save({ ...workout, createdAt: 1.5 }));
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
