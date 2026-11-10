import { readFileSync } from "node:fs";
import { initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, type Firestore } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createFirestoreHistoryLog } from "../src/history/infrastructure/firestoreHistoryLog";
import { createFirestoreWorkoutLibrary } from "../src/workouts/infrastructure/firestoreWorkoutLibrary";
import type { HistoryDraft } from "../src/history/domain/historyEntry";
import type { OutboxStore, Pending } from "../src/shared/application/outbox";
import { MODES, defaultConfig } from "../src/workouts/domain/workout";

let env: RulesTestEnvironment;

const dbFor = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;

function memoryStore<Draft>(): OutboxStore<Draft> {
  let items: Pending<Draft>[] = [];
  return {
    load: () => items,
    save(next) {
      items = next;
    },
  };
}

const ready = () => Promise.resolve(true);
const libraryFor = (uid: string, owner = uid) =>
  createFirestoreWorkoutLibrary(dbFor(uid), owner, { store: memoryStore(), whenReady: ready });
const logFor = (uid: string) =>
  createFirestoreHistoryLog(dbFor(uid), uid, { store: memoryStore(), whenReady: ready });

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
    const library = libraryFor("alice");
    for (const [index, { id }] of MODES.entries()) {
      await library.save({ name: `Workout ${id}`, config: defaultConfig(id), createdAt: index });
    }
    const workouts = await nextValue(library.subscribe, (items) => items.length === MODES.length);
    expect(workouts.map(({ config }) => config.mode)).toEqual(MODES.map(({ id }) => id).reverse());
    expect(workouts[0]?.config).toEqual(defaultConfig(MODES.at(-1)?.id ?? "stopwatch"));
  });

  it("saves and reads back the round names through the real rules", async () => {
    const library = libraryFor("alice");
    const config = { ...defaultConfig("tabata"), roundNames: ["Burpees", "", "Sentadillas"] };
    await library.save({ name: "Leg day", config, createdAt: 1 });
    const [saved] = await nextValue(library.subscribe, (items) => items.length === 1);
    expect(saved?.config).toEqual(config);
    await env.withSecurityRulesDisabled(async (context) => {
      const stored = await getDoc(doc(context.firestore(), `users/alice/workouts/${saved?.id}`));
      expect(stored.get("config.roundNames")).toBe("Burpees\n\nSentadillas");
    });
  });

  it("stores a workout without names exactly as before", async () => {
    const library = libraryFor("alice");
    await library.save({ name: "Leg day", config: defaultConfig("tabata"), createdAt: 1 });
    const [saved] = await nextValue(library.subscribe, (items) => items.length === 1);
    await env.withSecurityRulesDisabled(async (context) => {
      const stored = await getDoc(doc(context.firestore(), `users/alice/workouts/${saved?.id}`));
      expect(stored.get("config")).toEqual(defaultConfig("tabata"));
    });
  });

  it("removes a workout", async () => {
    const library = libraryFor("alice");
    await library.save({ name: "Leg day", config: defaultConfig("emom"), createdAt: 1 });
    const [saved] = await nextValue(library.subscribe, (items) => items.length === 1);
    await library.remove(saved?.id ?? "");
    await nextValue(library.subscribe, (items) => items.length === 0);
  });

  it("skips a stored document it cannot read", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/alice/workouts/bad"), { createdAt: 9 });
    });
    const library = libraryFor("alice");
    await library.save({ name: "Leg day", config: defaultConfig("emom"), createdAt: 1 });
    const workouts = await nextValue(library.subscribe, (items) => items.length > 0);
    expect(workouts.map(({ name }) => name)).toEqual(["Leg day"]);
  });

  it("reports an error instead of another user's workouts", async () => {
    await libraryFor("alice").save({
      name: "Leg day",
      config: defaultConfig("emom"),
      createdAt: 1,
    });
    const library = libraryFor("mallory", "alice");
    const onData = vi.fn();
    await new Promise<void>((resolve) => {
      library.subscribe(onData, () => {
        resolve();
      });
    });
    expect(onData).not.toHaveBeenCalledWith(expect.arrayContaining([expect.anything()]));
  });

  it("rejects a save the rules deny", async () => {
    const library = libraryFor("mallory", "alice");
    await expect(
      library.save({ name: "Leg day", config: defaultConfig("emom"), createdAt: 1 }),
    ).rejects.toThrow();
  });
});

describe("Firestore history log", () => {
  it("adds every mode through the real rules and lists the newest first", async () => {
    const log = logFor("alice");
    for (const [index, { id }] of MODES.entries()) {
      await log.add({ config: defaultConfig(id), finishedAt: index, activeMs: 1_000, marks: 0 });
    }
    const entries = await nextValue(log.subscribe, (items) => items.length === MODES.length);
    expect(entries.map(({ finishedAt }) => finishedAt)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(entries[0]).toMatchObject({ activeMs: 1_000, marks: 0 });
  });

  it("adds an entry with round names through the real rules and reads them back", async () => {
    const log = logFor("alice");
    const config = { ...defaultConfig("intervals"), roundNames: ["", "Squats"] };
    await log.add({ config, finishedAt: 1, activeMs: 1_000, marks: 0 });
    const [entry] = await nextValue(log.subscribe, (items) => items.length === 1);
    expect(entry?.config).toEqual(config);
  });

  it("keeps each user's history apart", async () => {
    const config = defaultConfig("tabata");
    await logFor("alice").add({
      config,
      finishedAt: 1,
      activeMs: 1,
      marks: 0,
    });
    const bob = logFor("bob");
    expect(await nextValue(bob.subscribe, () => true)).toEqual([]);
  });
});

describe("a session finished while the account is not ready", () => {
  const draft: HistoryDraft = {
    config: defaultConfig("stopwatch"),
    finishedAt: 7,
    activeMs: 1_000,
    marks: 0,
  };

  it("reaches the server once, after the page reloads and the account is ready", async () => {
    const store = memoryStore<HistoryDraft>();
    const stalled = createFirestoreHistoryLog(dbFor("alice"), "alice", {
      store,
      whenReady: () => new Promise(() => undefined),
    });
    void stalled.add(draft);
    expect(store.load()).toHaveLength(1);

    const reloaded = createFirestoreHistoryLog(dbFor("alice"), "alice", {
      store,
      whenReady: ready,
    });
    const entries = await nextValue(reloaded.subscribe, (items) => items.length === 1);
    expect(entries[0]).toMatchObject({ finishedAt: 7 });
    await vi.waitFor(() => {
      expect(store.load()).toEqual([]);
    });
  });

  it("is not written twice when a reload finds it already in the local cache", async () => {
    const store = memoryStore<HistoryDraft>();
    const db = dbFor("alice");
    const log = createFirestoreHistoryLog(db, "alice", { store, whenReady: ready });
    await log.add(draft);
    const [entry] = await nextValue(log.subscribe, (items) => items.length === 1);

    store.save([{ id: entry?.id ?? "", draft }]);
    const reloaded = createFirestoreHistoryLog(db, "alice", { store, whenReady: ready });
    await vi.waitFor(() => {
      expect(store.load()).toEqual([]);
    });
    expect(await nextValue(reloaded.subscribe, () => true)).toHaveLength(1);
  });
});
