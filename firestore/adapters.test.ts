import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createFirestoreHistoryLog } from "../src/history/infrastructure/firestoreHistoryLog";
import { createFirestoreWorkoutLibrary } from "../src/workouts/infrastructure/firestoreWorkoutLibrary";
import { MODES, defaultConfig } from "../src/workouts/domain/workout";

let env: RulesTestEnvironment;

const dbFor = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

/** Resolves with the first server-backed value the subscription reports. */
function nextValue<T>(
  subscribe: (onData: (items: T[]) => void, onError: (error: Error) => void) => () => void,
  ready: (items: T[]) => boolean,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const stop = subscribe(
      (items) => {
        if (ready(items)) {
          setTimeout(() => {
            stop();
          });
          resolve(items);
        }
      },
      (error) => {
        reject(error);
      },
    );
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

describe("Firestore workout library", () => {
  it("saves every mode through the real rules and lists the newest first", async () => {
    const library = createFirestoreWorkoutLibrary(dbFor("alice"), "alice");
    for (const [index, { id }] of MODES.entries()) {
      await library.save({ name: `Workout ${id}`, config: defaultConfig(id), createdAt: index });
    }
    const workouts = await nextValue(library.subscribe, (items) => items.length === MODES.length);
    expect(workouts.map(({ config }) => config.mode)).toEqual(MODES.map(({ id }) => id).reverse());
    expect(workouts[0]?.config).toEqual(defaultConfig(MODES.at(-1)?.id ?? "stopwatch"));
  });

  it("removes a workout", async () => {
    const library = createFirestoreWorkoutLibrary(dbFor("alice"), "alice");
    await library.save({ name: "Leg day", config: defaultConfig("emom"), createdAt: 1 });
    const [saved] = await nextValue(library.subscribe, (items) => items.length === 1);
    await library.remove(saved?.id ?? "");
    await nextValue(library.subscribe, (items) => items.length === 0);
  });

  it("skips a stored document it cannot read", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/alice/workouts/bad"), { createdAt: 9 });
    });
    const library = createFirestoreWorkoutLibrary(dbFor("alice"), "alice");
    await library.save({ name: "Leg day", config: defaultConfig("emom"), createdAt: 1 });
    const workouts = await nextValue(library.subscribe, (items) => items.length > 0);
    expect(workouts.map(({ name }) => name)).toEqual(["Leg day"]);
  });

  it("reports an error instead of another user's workouts", async () => {
    await createFirestoreWorkoutLibrary(dbFor("alice"), "alice").save({
      name: "Leg day",
      config: defaultConfig("emom"),
      createdAt: 1,
    });
    const library = createFirestoreWorkoutLibrary(dbFor("mallory"), "alice");
    const onData = vi.fn();
    await new Promise<void>((resolve) => {
      library.subscribe(onData, () => {
        resolve();
      });
    });
    expect(onData).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
  });

  it("rejects a save the rules deny", async () => {
    const library = createFirestoreWorkoutLibrary(dbFor("mallory"), "alice");
    await expect(
      library.save({ name: "Leg day", config: defaultConfig("emom"), createdAt: 1 }),
    ).rejects.toThrow();
  });
});

describe("Firestore history log", () => {
  it("adds every mode through the real rules and lists the newest first", async () => {
    const log = createFirestoreHistoryLog(dbFor("alice"), "alice");
    for (const [index, { id }] of MODES.entries()) {
      await log.add({ config: defaultConfig(id), finishedAt: index, activeMs: 1_000, marks: 0 });
    }
    const entries = await nextValue(log.subscribe, (items) => items.length === MODES.length);
    expect(entries.map(({ finishedAt }) => finishedAt)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(entries[0]).toMatchObject({ activeMs: 1_000, marks: 0 });
  });

  it("keeps each user's history apart", async () => {
    const config = defaultConfig("tabata");
    await createFirestoreHistoryLog(dbFor("alice"), "alice").add({
      config,
      finishedAt: 1,
      activeMs: 1,
      marks: 0,
    });
    const bob = createFirestoreHistoryLog(dbFor("bob"), "bob");
    expect(await nextValue(bob.subscribe, () => true)).toEqual([]);
  });
});
