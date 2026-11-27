import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import type { SavedWorkoutDraft } from "../domain/savedWorkout";
import { defaultConfig, toStoredConfig } from "../domain/workout";
import { createFirestoreWorkoutLibrary } from "./firestoreWorkoutLibrary";

const firestore = vi.hoisted(() => ({
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  /** Paths whose document the server holds. */
  onServer: new Set<string>(),
  serverReachable: true,
  updateDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  setDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  deleteDoc: vi.fn((_ref: { path: string }) => Promise.resolve()),
  /** What happened, in order, including cache reads. */
  calls: [] as string[],
  /** The saved workouts the server holds, newest first, as stored. */
  listedOnServer: [] as { id: string; data: unknown }[],
  /** Those this device's cache holds, which is all a listener reads offline. */
  listedHere: [] as { id: string; data: unknown }[],
  /** Each listened query's limit, or null when it has none. */
  limits: [] as (number | null)[],
  /** Errors passed to listeners, which offline must never happen. */
  listenErrors: [] as unknown[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path: string }, id = "new-id") => ({ path: `${parent.path}/${id}` }),
  getDocFromCache: (ref: { path: string }) => {
    firestore.calls.push(`cacheRead ${ref.path}`);
    return Promise.resolve({ exists: () => firestore.cached.has(ref.path) });
  },
  getDocFromServer: (ref: { path: string }) =>
    firestore.serverReachable
      ? Promise.resolve({ exists: () => firestore.onServer.has(ref.path) })
      : Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" })),
  // Like Firestore's listener: the server's answer online, this device's cache offline; never an error.
  onSnapshot: (
    listened: { limit: number | null },
    onNext: (snapshot: { docs: { id: string; data: () => unknown }[] }) => void,
  ) => {
    firestore.limits.push(listened.limit);
    const listed = firestore.serverReachable ? firestore.listedOnServer : firestore.listedHere;
    const docs = listened.limit === null ? listed : listed.slice(0, listened.limit);
    onNext({ docs: docs.map(({ id, data }) => ({ id, data: () => data })) });
    return () => undefined;
  },
  limit: (count: number) => ({ limit: count }),
  orderBy: () => ({}),
  query: (_ref: unknown, ...constraints: { limit?: number }[]) => ({
    limit: constraints.find((constraint) => constraint.limit !== undefined)?.limit ?? null,
  }),
  setDoc: firestore.setDoc,
  updateDoc: firestore.updateDoc,
  deleteDoc: firestore.deleteDoc,
}));

const PATH = "users/u1/workouts/w1";
const workout = { id: "w1", name: "Leg day", config: defaultConfig("tabata"), createdAt: 1_000 };
const edited = { ...workout, name: "Leg day, harder", config: defaultConfig("emom") };

type Guard = <T>(write: () => Promise<T>) => Promise<T>;

function setup({
  pending = false,
  ready = true,
  guard,
}: { pending?: boolean; ready?: boolean; guard?: Guard } = {}) {
  let items = pending
    ? [{ id: "w1", draft: { name: "Leg day", config: workout.config, createdAt: 1_000 } }]
    : [];
  const store: OutboxStore<SavedWorkoutDraft> = {
    load: () => items,
    save(next) {
      items = next;
    },
  };
  const library = createFirestoreWorkoutLibrary({} as never, "u1", {
    store,
    // Not ready keeps a pending save in the outbox, as during a slow sign-in check.
    whenReady: () => (ready ? Promise.resolve(true) : new Promise(() => undefined)),
    guard,
  });
  return { library, store };
}

/** Records when the account's lock is taken and let go, around what the write does. */
function recordingGuard(): Guard {
  return async (write) => {
    firestore.calls.push("lock");
    const result = await write();
    firestore.calls.push("unlock");
    return result;
  };
}

/** A server that never answers, as offline: only this device's cache has the write. */
const neverAnswered = () => new Promise<void>(() => undefined);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("writes while another tab may be signing out", () => {
  afterEach(() => {
    firestore.setDoc.mockReset().mockResolvedValue(undefined);
    firestore.updateDoc.mockReset().mockResolvedValue(undefined);
    firestore.deleteDoc.mockReset().mockResolvedValue(undefined);
  });

  beforeEach(() => {
    firestore.cached.clear();
    firestore.onServer.clear();
    firestore.calls.length = 0;
    firestore.setDoc.mockReset();
    firestore.updateDoc.mockReset();
    firestore.deleteDoc.mockReset();
    firestore.setDoc.mockImplementation((ref: { path: string }) => {
      firestore.calls.push(`setDoc ${ref.path}`);
      firestore.cached.add(ref.path);
      return neverAnswered();
    });
    firestore.updateDoc.mockImplementation((ref: { path: string }) => {
      firestore.calls.push(`updateDoc ${ref.path}`);
      return neverAnswered();
    });
    firestore.deleteDoc.mockImplementation((ref: { path: string }) => {
      firestore.calls.push(`deleteDoc ${ref.path}`);
      return neverAnswered();
    });
  });

  it("saves while holding the account's lock, until Firestore's cache has it, but not the server's answer", async () => {
    const { library, store } = setup({ guard: recordingGuard() });
    void library.save({ name: "Leg day", config: workout.config, createdAt: 1_000 });
    await settle();
    const unlock = firestore.calls.indexOf("unlock");
    expect(firestore.calls[0]).toBe("lock");
    expect(unlock).toBeGreaterThan(firestore.calls.indexOf("setDoc users/u1/workouts/new-id"));
    expect(firestore.calls.lastIndexOf("cacheRead users/u1/workouts/new-id")).toBeLessThan(unlock);
    expect(store.load()).toEqual([]);
  });

  it("updates while holding the lock, until Firestore's cache has the change", async () => {
    firestore.cached.add(PATH);
    const { library } = setup({ guard: recordingGuard() });
    void library.update(edited);
    await settle();
    expect(firestore.calls).toEqual(["lock", `updateDoc ${PATH}`, `cacheRead ${PATH}`, "unlock"]);
  });

  it("removes while holding the lock, until Firestore's cache has the change", async () => {
    const { library } = setup({ guard: recordingGuard() });
    void library.remove("w1");
    await settle();
    expect(firestore.calls).toEqual(["lock", `deleteDoc ${PATH}`, `cacheRead ${PATH}`, "unlock"]);
  });

  it("writes nothing when the lock refuses, and passes the refusal on", async () => {
    const refusal = new Error("signed out in another tab");
    const { library, store } = setup({ guard: () => Promise.reject(refusal) });
    await expect(
      library.save({ name: "Leg day", config: workout.config, createdAt: 1_000 }),
    ).rejects.toBe(refusal);
    firestore.cached.add(PATH);
    await expect(library.update(edited)).rejects.toBe(refusal);
    await expect(library.remove("w1")).rejects.toBe(refusal);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([]);
  });

  it("without a lock, saves and removes as before, settling when the server answers", async () => {
    firestore.setDoc.mockImplementation((ref) => {
      firestore.cached.add(ref.path);
      return Promise.resolve();
    });
    firestore.deleteDoc.mockResolvedValue(undefined);
    const { library } = setup();
    await expect(
      library.save({ name: "Leg day", config: workout.config, createdAt: 1_000 }),
    ).resolves.toBeUndefined();
    expect(firestore.setDoc).toHaveBeenCalledOnce();
    await expect(library.remove("w1")).resolves.toBeUndefined();
    expect(firestore.deleteDoc).toHaveBeenCalledWith({ path: PATH });
  });

  it("passes on the server's refusal of an update made while holding the lock", async () => {
    firestore.cached.add(PATH);
    firestore.onServer.add(PATH);
    firestore.updateDoc.mockRejectedValue(
      Object.assign(new Error("refused"), { code: "permission-denied" }),
    );
    const { library } = setup({ guard: recordingGuard() });
    await expect(library.update(edited)).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("after the writes made while another tab may be signing out", () => {
  it("starts with Firestore answering every write at once, whatever those tests set", async () => {
    await expect(firestore.setDoc({ path: PATH })).resolves.toBeUndefined();
    await expect(firestore.updateDoc({ path: PATH })).resolves.toBeUndefined();
    await expect(firestore.deleteDoc({ path: PATH })).resolves.toBeUndefined();
  });
});

describe("update", () => {
  beforeEach(() => {
    firestore.cached.clear();
    firestore.onServer.clear();
    firestore.serverReachable = true;
    firestore.updateDoc.mockReset();
    firestore.updateDoc.mockResolvedValue(undefined);
    firestore.setDoc.mockClear();
  });

  it("updates the stored document, which fails rather than recreating one deleted elsewhere", async () => {
    firestore.cached.add(PATH);
    const { library } = setup();
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { path: PATH },
      { name: edited.name, config: toStoredConfig(edited.config), createdAt: 1_000 },
    );
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it("only revises a save still waiting in the outbox, writing nothing twice", async () => {
    const { library, store } = setup({ pending: true, ready: false });
    await library.update(edited);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([
      { id: "w1", draft: { name: edited.name, config: edited.config, createdAt: 1_000 } },
    ]);
  });

  it("updates Firestore once the outbox has already handed it over", async () => {
    firestore.cached.add(PATH);
    const { library } = setup({ pending: true, ready: false });
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
  });

  it("asks Firestore about a workout it knows nothing of, so a deleted one is refused", async () => {
    const { library } = setup();
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
  });

  describe("when the server refuses it", () => {
    const denied = () => Object.assign(new Error("refused"), { code: "permission-denied" });

    it("reports a workout deleted elsewhere as not found, since the rules refuse before checking", async () => {
      firestore.cached.add(PATH);
      firestore.updateDoc.mockRejectedValue(denied());
      const { library } = setup();
      await expect(library.update(edited)).rejects.toMatchObject({ code: "not-found" });
    });

    it("keeps the refusal when the workout is still there", async () => {
      firestore.cached.add(PATH);
      firestore.onServer.add(PATH);
      firestore.updateDoc.mockRejectedValue(denied());
      const { library } = setup();
      await expect(library.update(edited)).rejects.toMatchObject({ code: "permission-denied" });
    });

    it("keeps the refusal when the server cannot be asked", async () => {
      firestore.cached.add(PATH);
      firestore.serverReachable = false;
      firestore.updateDoc.mockRejectedValue(denied());
      const { library } = setup();
      await expect(library.update(edited)).rejects.toMatchObject({ code: "permission-denied" });
    });
  });
});

describe("reading the newest saved workouts (T38)", () => {
  /** `count` stored workouts, newest first, named W1, W2… */
  const storedWorkouts = (count: number, newestAt = 100_000) =>
    Array.from({ length: count }, (_, index) => ({
      id: `stored-${index + 1}`,
      data: {
        name: `W${index + 1}`,
        config: toStoredConfig(defaultConfig("tabata")),
        createdAt: newestAt - index,
      },
    }));
  const namesRead = (library: ReturnType<typeof setup>["library"], newest?: number) => {
    let names: string[] = [];
    library.subscribe(
      (items) => {
        names = items.map(({ name }) => name);
      },
      (error) => firestore.listenErrors.push(error),
      newest,
    );
    return names;
  };

  beforeEach(() => {
    firestore.serverReachable = true;
    firestore.listedOnServer = storedWorkouts(25);
    firestore.listedHere = [];
    firestore.limits.length = 0;
    firestore.listenErrors.length = 0;
  });

  it("asks the server for only the newest it is asked for", () => {
    const { library } = setup();
    expect(namesRead(library, 21)).toEqual(storedWorkouts(21).map(({ data }) => data.name));
    expect(firestore.limits).toEqual([21]);
  });

  it("reads every saved workout when not asked for a number, as before", () => {
    const { library } = setup();
    expect(namesRead(library)).toHaveLength(25);
    expect(firestore.limits).toEqual([null]);
  });

  it("shows a save still held on this device at the top, besides the newest read", () => {
    // The held save was made at 1,000, after every stored one.
    firestore.listedOnServer = storedWorkouts(25, 900);
    const { library } = setup({ pending: true, ready: false });
    const names = namesRead(library, 21);
    expect(names[0]).toBe("Leg day");
    expect(names).toHaveLength(22);
  });

  it("offline, reads more from this device's cache and never fails", () => {
    firestore.serverReachable = false;
    firestore.listedHere = storedWorkouts(30);
    const { library } = setup();
    expect(namesRead(library, 21)).toHaveLength(21);
    expect(namesRead(library, 41)).toHaveLength(30);
    expect(firestore.limits).toEqual([21, 41]);
    expect(firestore.listenErrors).toEqual([]);
  });
});
