import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import { toStoredRoutine, type Routine, type RoutineDraft } from "../domain/routine";
import { createFirestoreRoutineLibrary } from "./firestoreRoutineLibrary";

const firestore = vi.hoisted(() => ({
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  /** Paths whose document the server holds. */
  onServer: new Set<string>(),
  /** Paths whose document the server's answer shows with a change of this device still waiting. */
  pendingHere: new Set<string>(),
  serverReachable: true,
  /** The code the server's read fails with when it cannot be reached. */
  serverError: "unavailable",
  /** Cached paths whose routine was received from a contact (has `receivedFrom`). */
  receivedHere: new Set<string>(),
  /** Each committed batch, as the paths it deleted. */
  batches: [] as string[][],
  commit: vi.fn((_paths: string[]) => Promise.resolve()),
  updateDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  setDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  deleteDoc: vi.fn((_ref: { path: string }) => Promise.resolve()),
  /** Stands for Firestore's sentinel that removes a field on update. */
  deleted: { deleteField: true },
  /** What happened, in order, including cache reads. */
  calls: [] as string[],
  /** The options of every transaction run. */
  transactions: [] as unknown[],
  /** What committed transactions wrote, as [path, data]. */
  transactionWrites: [] as [string, unknown][],
  /** When set, a transaction's commit is refused with this code. */
  commitFailure: null as string | null,
  /** When set, the next commit is applied on the server but its answer is lost. */
  loseNextAnswer: false,
  /** The routines the server holds, newest first, as stored. */
  listedOnServer: [] as { id: string; data: unknown }[],
  /** Those this device's cache holds, which is all a listener reads offline. */
  listedHere: [] as { id: string; data: unknown }[],
  /** Each listened query's limit, or null when it has none. */
  limits: [] as (number | null)[],
  /** Errors passed to listeners, which offline must never happen. */
  listenErrors: [] as unknown[],
}));

const failed = (code: string) => Object.assign(new Error(code), { code });

/**
 * A server-side transaction: reads go to the server (never this device's cache), and its writes
 * are applied on the server when it commits, or not at all; nothing is kept on this device.
 */
async function runTransaction(
  _db: unknown,
  update: (transaction: {
    get: (ref: { path: string }) => Promise<{ exists: () => boolean }>;
    set: (ref: { path: string }, data: unknown) => void;
  }) => Promise<unknown>,
  options?: unknown,
) {
  firestore.transactions.push(options);
  if (!firestore.serverReachable) throw failed(firestore.serverError);
  const sets: [string, unknown][] = [];
  const result = await update({
    get: (ref) => Promise.resolve({ exists: () => firestore.onServer.has(ref.path) }),
    set(ref, data) {
      sets.push([ref.path, data]);
    },
  });
  if (firestore.commitFailure !== null) throw failed(firestore.commitFailure);
  for (const [path, data] of sets) {
    firestore.calls.push(`transaction set ${path}`);
    firestore.onServer.add(path);
    firestore.transactionWrites.push([path, data]);
  }
  if (firestore.loseNextAnswer) {
    firestore.loseNextAnswer = false;
    throw failed("unavailable");
  }
  return result;
}

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path: string }, id = "new-id") => ({ path: `${parent.path}/${id}` }),
  deleteField: () => firestore.deleted,
  getDocFromCache: (ref: { path: string }) => {
    firestore.calls.push(`cacheRead ${ref.path}`);
    return Promise.resolve({
      exists: () => firestore.cached.has(ref.path),
      data: () =>
        firestore.cached.has(ref.path)
          ? {
              name: "x",
              ...(firestore.receivedHere.has(ref.path) ? { receivedFrom: { uid: "a" } } : {}),
            }
          : undefined,
    });
  },
  writeBatch: () => {
    const paths: string[] = [];
    return {
      delete(ref: { path: string }) {
        paths.push(ref.path);
      },
      commit() {
        firestore.calls.push(`batch ${paths.join(" ")}`);
        firestore.batches.push(paths);
        return firestore.commit(paths);
      },
    };
  },
  getDocFromServer: (ref: { path: string }) =>
    firestore.serverReachable
      ? Promise.resolve({
          exists: () => firestore.onServer.has(ref.path) || firestore.pendingHere.has(ref.path),
          metadata: { hasPendingWrites: firestore.pendingHere.has(ref.path) },
        })
      : Promise.reject(Object.assign(new Error("offline"), { code: firestore.serverError })),
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
  runTransaction: (...args: Parameters<typeof runTransaction>) => runTransaction(...args),
  limit: (count: number) => ({ limit: count }),
  orderBy: () => ({}),
  query: (_ref: unknown, ...constraints: { limit?: number }[]) => ({
    limit: constraints.find((constraint) => constraint.limit !== undefined)?.limit ?? null,
  }),
  setDoc: firestore.setDoc,
  updateDoc: firestore.updateDoc,
  deleteDoc: firestore.deleteDoc,
}));

const PATH = "users/u1/routines/r1";
const draft: RoutineDraft = {
  name: "Push day",
  notes: "Warm up first",
  stages: [
    {
      name: "Main",
      exercises: [
        {
          name: "Bench press",
          repsMin: 8,
          repsMax: 10,
          restSeconds: 90,
          weight: 60,
          weightUnit: "kg",
        },
      ],
    },
  ],
  createdAt: 1_000,
};
const routine: Routine = { id: "r1", ...draft };
const edited: Routine = {
  ...routine,
  name: "Push day, harder",
  notes: "Slower negatives",
  stages: [{ exercises: [{ name: "Dips", repsMin: 12 }] }],
};
const { notes: _dropped, ...withoutNotes } = edited;

type Guard = <T>(write: () => Promise<T>) => Promise<T>;

/** Whether the browser says it is online, which the test switches, as the 'online' event would. */
function fakeConnectivity(online = true) {
  const waiting: (() => void)[] = [];
  return {
    isOnline: () => online,
    whenOnline: () =>
      online ? Promise.resolve() : new Promise<void>((resolve) => waiting.push(resolve)),
    goOffline() {
      online = false;
    },
    goOnline() {
      online = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
  };
}

function setup({
  pending = false,
  ready = true,
  guard,
  wait,
  connectivity,
}: {
  pending?: boolean;
  ready?: boolean;
  guard?: Guard;
  wait?: (ms: number) => Promise<void>;
  connectivity?: ReturnType<typeof fakeConnectivity>;
} = {}) {
  let items = pending ? [{ id: "r1", draft }] : [];
  const store: OutboxStore<RoutineDraft> = {
    load: () => items,
    save(next) {
      items = next;
    },
  };
  const library = createFirestoreRoutineLibrary({} as never, "u1", {
    store,
    // Not ready keeps a pending save in the outbox, as during a slow sign-in check.
    whenReady: () => (ready ? Promise.resolve(true) : new Promise(() => undefined)),
    guard,
    wait,
    connectivity,
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
    void library.save(draft);
    await settle();
    const unlock = firestore.calls.indexOf("unlock");
    expect(firestore.calls[0]).toBe("lock");
    expect(unlock).toBeGreaterThan(firestore.calls.indexOf("setDoc users/u1/routines/new-id"));
    expect(firestore.calls.lastIndexOf("cacheRead users/u1/routines/new-id")).toBeLessThan(unlock);
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
    // The user's own routine: the cache shows it was not received from anyone.
    firestore.cached.add(PATH);
    const { library } = setup({ guard: recordingGuard() });
    void library.remove("r1");
    await settle();
    expect(firestore.calls).toEqual([
      "lock",
      `cacheRead ${PATH}`,
      `deleteDoc ${PATH}`,
      `cacheRead ${PATH}`,
      "unlock",
    ]);
  });

  it("writes nothing when the lock refuses, and passes the refusal on", async () => {
    const refusal = new Error("signed out in another tab");
    const { library, store } = setup({ guard: () => Promise.reject(refusal) });
    await expect(library.save(draft)).rejects.toBe(refusal);
    firestore.cached.add(PATH);
    await expect(library.update(edited)).rejects.toBe(refusal);
    await expect(library.remove("r1")).rejects.toBe(refusal);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([]);
  });

  it("without a lock, saves the stored shape and removes, settling when the server answers", async () => {
    firestore.setDoc.mockImplementation((ref) => {
      firestore.cached.add(ref.path);
      return Promise.resolve();
    });
    firestore.deleteDoc.mockResolvedValue(undefined);
    const { library } = setup();
    await expect(library.save(draft)).resolves.toBeUndefined();
    expect(firestore.setDoc).toHaveBeenCalledOnce();
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { path: "users/u1/routines/new-id" },
      toStoredRoutine(draft),
    );
    firestore.cached.add(PATH);
    await expect(library.remove("r1")).resolves.toBeUndefined();
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
    const { id: _id, ...editedDraft } = edited;
    expect(firestore.updateDoc).toHaveBeenCalledWith({ path: PATH }, toStoredRoutine(editedDraft));
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it("removes the stored notes when the edited routine has none", async () => {
    firestore.cached.add(PATH);
    const { library } = setup();
    await library.update(withoutNotes);
    const { id: _id, ...editedDraft } = withoutNotes;
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { path: PATH },
      { ...toStoredRoutine(editedDraft), notes: firestore.deleted },
    );
  });

  it("only revises a save still waiting in the outbox, writing nothing twice", async () => {
    const { library, store } = setup({ pending: true, ready: false });
    await library.update(edited);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    const { id: _id, ...editedDraft } = edited;
    expect(store.load()).toEqual([{ id: "r1", draft: editedDraft }]);
  });

  it("updates Firestore once the outbox has already handed it over", async () => {
    firestore.cached.add(PATH);
    const { library } = setup({ pending: true, ready: false });
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
  });

  it("asks Firestore about a routine it knows nothing of, so a deleted one is refused", async () => {
    const { library } = setup();
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
  });

  describe("when the server refuses it", () => {
    const denied = () => Object.assign(new Error("refused"), { code: "permission-denied" });

    it("reports a routine deleted elsewhere as not found, since the rules refuse before checking", async () => {
      firestore.cached.add(PATH);
      firestore.updateDoc.mockRejectedValue(denied());
      const { library } = setup();
      await expect(library.update(edited)).rejects.toMatchObject({ code: "not-found" });
    });

    it("keeps the refusal when the routine is still there", async () => {
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

describe("receive (T26, S12; T29 W2)", () => {
  const COPY_PATH = "users/u1/routines/copy-1";
  const received: Routine = {
    ...routine,
    id: "copy-1",
    createdAt: 1_750_000_000_000,
    receivedFrom: { uid: "alice", name: "Alice", email: "alice@example.com" },
  };
  const { id: _copyId, ...receivedDraft } = received;

  beforeEach(() => {
    firestore.cached.clear();
    firestore.onServer.clear();
    firestore.pendingHere.clear();
    firestore.serverReachable = true;
    firestore.serverError = "unavailable";
    firestore.calls.length = 0;
    firestore.transactions.length = 0;
    firestore.transactionWrites.length = 0;
    firestore.commitFailure = null;
    firestore.loseNextAnswer = false;
    firestore.setDoc.mockReset();
    firestore.setDoc.mockImplementation((ref: { path: string }) => {
      firestore.calls.push(`setDoc ${ref.path}`);
      firestore.cached.add(ref.path);
      firestore.onServer.add(ref.path);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    firestore.setDoc.mockReset().mockResolvedValue(undefined);
    firestore.serverReachable = true;
    firestore.serverError = "unavailable";
    firestore.commitFailure = null;
    firestore.loseNextAnswer = false;
    firestore.pendingHere.clear();
  });

  it("stores the routine under the copy's id with a create-only server transaction, never setDoc or the outbox (W2)", async () => {
    const { library, store } = setup({ guard: recordingGuard() });
    await expect(library.receive(received)).resolves.toBeUndefined();
    expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
    expect(toStoredRoutine(receivedDraft).receivedFrom).toEqual(received.receivedFrom);
    // Nothing that Firestore could hold on this device and send later.
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([]);
    // One attempt per try: a retried commit is decided here, after reading the server again.
    expect(firestore.transactions).toEqual([{ maxAttempts: 1 }]);
    // Under the account's lock, like any other write.
    expect(firestore.calls[0]).toBe("lock");
    expect(firestore.calls.indexOf(`transaction set ${COPY_PATH}`)).toBeLessThan(
      firestore.calls.indexOf("unlock"),
    );
  });

  it("leaves a routine the server already holds as it is: received before, maybe edited since", async () => {
    firestore.onServer.add(COPY_PATH);
    const { library } = setup();
    await expect(library.receive(received)).resolves.toBeUndefined();
    expect(firestore.transactionWrites).toEqual([]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it("reads only the server: a write held on this device alone does not count as stored", async () => {
    firestore.cached.add(COPY_PATH);
    firestore.pendingHere.add(COPY_PATH);
    const { library } = setup();
    await expect(library.receive(received)).resolves.toBeUndefined();
    expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
  });

  it("passes the server's refusal on, having written nothing", async () => {
    firestore.commitFailure = "permission-denied";
    const { library } = setup();
    await expect(library.receive(received)).rejects.toMatchObject({ code: "permission-denied" });
    expect(firestore.onServer.has(COPY_PATH)).toBe(false);
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  /** A wait the test ends, recording how long the library asked to wait. */
  function manualWait() {
    const waits: { ms: number; end: () => void }[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        waits.push({ ms, end: resolve });
      });
    return { waits, wait };
  }

  it("writes nothing while the server cannot be reached, never settling, and stores it once it can (W2)", async () => {
    firestore.serverReachable = false;
    const { waits, wait } = manualWait();
    const { library, store } = setup({ wait });
    let settled = false;
    void library.receive(received).finally(() => {
      settled = true;
    });
    await settle();
    waits[0]!.end();
    await settle();
    expect(firestore.transactionWrites).toEqual([]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([]);
    expect(settled).toBe(false);
    // It asks again later, waiting longer each time.
    expect(waits.map(({ ms }) => ms)).toEqual([1_000, 2_000]);

    firestore.serverReachable = true;
    waits[1]!.end();
    await settle();
    await settle();
    expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
    expect(settled).toBe(true);
  });

  it("never overwrites a routine edited elsewhere that only the server holds (L64 A2)", async () => {
    firestore.serverReachable = false;
    firestore.onServer.add(COPY_PATH);
    const { waits, wait } = manualWait();
    const { library } = setup({ wait });
    const receiving = library.receive(received);
    await settle();
    expect(firestore.transactionWrites).toEqual([]);
    firestore.serverReachable = true;
    waits[0]!.end();
    await expect(receiving).resolves.toBeUndefined();
    expect(firestore.transactionWrites).toEqual([]);
  });

  it("settles once a commit whose answer was lost is found on the server, writing it once (W2)", async () => {
    firestore.loseNextAnswer = true;
    const { waits, wait } = manualWait();
    const { library } = setup({ wait });
    const receiving = library.receive(received);
    await settle();
    waits[0]!.end();
    await expect(receiving).resolves.toBeUndefined();
    expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
    expect(firestore.transactions).toHaveLength(2);
  });

  describe("while the browser says it is offline (T36)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("asks the server nothing more until the browser is back online, then asks at once and stores it once", async () => {
      firestore.serverReachable = false;
      const connectivity = fakeConnectivity(false);
      const { library } = setup({ connectivity });
      let settled = false;
      void library.receive(received).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(firestore.transactions).toHaveLength(1);

      // An hour offline: no further try, so no read is spent.
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(firestore.transactions).toHaveLength(1);
      expect(settled).toBe(false);

      firestore.serverReachable = true;
      connectivity.goOnline();
      await vi.advanceTimersByTimeAsync(0);
      expect(firestore.transactions).toHaveLength(2);
      expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
      expect(settled).toBe(true);
    });

    it("pauses when the browser goes offline during a wait, and keeps the backoff while online", async () => {
      firestore.serverReachable = false;
      const connectivity = fakeConnectivity(true);
      const { library } = setup({ connectivity });
      void library.receive(received);
      await vi.advanceTimersByTimeAsync(0);
      expect(firestore.transactions).toHaveLength(1);
      // Online: tried again after 1 s, then after 2 s more.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(firestore.transactions).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(firestore.transactions).toHaveLength(3);

      // Offline during the 4 s wait: no try when it ends, nor long after.
      connectivity.goOffline();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(firestore.transactions).toHaveLength(3);

      firestore.serverReachable = true;
      connectivity.goOnline();
      await vi.advanceTimersByTimeAsync(0);
      expect(firestore.transactions).toHaveLength(4);
      expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
    });
  });

  describe("errors that are not about the network (T36, L99)", () => {
    for (const code of ["failed-precondition", "aborted", "already-exists"]) {
      it(`gives up after 5 tries in total on ${code}, writing nothing, and passes it on`, async () => {
        firestore.commitFailure = code;
        const { waits, wait } = manualWait();
        const { library } = setup({ wait, connectivity: fakeConnectivity(true) });
        let outcome: unknown = "pending";
        library.receive(received).then(
          () => {
            outcome = "stored";
          },
          (error: unknown) => {
            outcome = error;
          },
        );
        for (let ended = 0; ended < 4; ended += 1) {
          await settle();
          waits[ended]!.end();
        }
        await settle();
        await settle();
        expect(firestore.transactions).toHaveLength(5);
        // Still waiting with backoff between tries; no sixth wait or try.
        expect(waits.map(({ ms }) => ms)).toEqual([1_000, 2_000, 4_000, 8_000]);
        expect(outcome).toMatchObject({ code });
        expect(firestore.transactionWrites).toEqual([]);
      });
    }

    it("keeps trying, unbounded, while the server cannot be reached", async () => {
      firestore.serverReachable = false;
      const { waits, wait } = manualWait();
      const { library } = setup({ wait, connectivity: fakeConnectivity(true) });
      void library.receive(received);
      for (let ended = 0; ended < 8; ended += 1) {
        await settle();
        waits[ended]!.end();
      }
      await settle();
      expect(firestore.transactions).toHaveLength(9);
      firestore.serverReachable = true;
      waits[8]!.end();
      await settle();
      await settle();
      expect(firestore.transactionWrites).toEqual([[COPY_PATH, toStoredRoutine(receivedDraft)]]);
    });
  });

  it("writes nothing, and passes it on, when the server refuses to answer", async () => {
    firestore.serverReachable = false;
    firestore.serverError = "permission-denied";
    const { library } = setup();
    await expect(library.receive(received)).rejects.toMatchObject({ code: "permission-denied" });
    expect(firestore.transactionWrites).toEqual([]);
  });

  it("writes nothing when the lock refuses, and passes the refusal on", async () => {
    const refusal = new Error("signed out in another tab");
    const { library, store } = setup({ guard: () => Promise.reject(refusal) });
    await expect(library.receive(received)).rejects.toBe(refusal);
    expect(firestore.transactions).toEqual([]);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([]);
  });
});

describe("removing a received routine (L64 A1)", () => {
  const COPY = "users/u1/routines/copy-1";
  const INBOX_COPY = "users/u1/inbox/copy-1";

  beforeEach(() => {
    firestore.cached.clear();
    firestore.receivedHere.clear();
    firestore.batches.length = 0;
    firestore.calls.length = 0;
    firestore.commit.mockReset().mockResolvedValue(undefined);
    firestore.deleteDoc.mockReset().mockResolvedValue(undefined);
  });

  it("deletes its copy in the inbox with it, in one write, so it cannot come back", async () => {
    firestore.cached.add(COPY);
    firestore.receivedHere.add(COPY);
    const { library } = setup({ guard: recordingGuard() });
    await expect(library.remove("copy-1")).resolves.toBeUndefined();
    expect(firestore.batches).toEqual([[COPY, INBOX_COPY]]);
    expect(firestore.deleteDoc).not.toHaveBeenCalled();
    // Under the account's lock, like any removal.
    expect(firestore.calls[0]).toBe("lock");
    expect(firestore.calls.indexOf(`batch ${COPY} ${INBOX_COPY}`)).toBeLessThan(
      firestore.calls.indexOf("unlock"),
    );
  });

  it("deletes the inbox copy too when this device cannot tell whether it was received", async () => {
    const { library } = setup();
    await expect(library.remove("copy-1")).resolves.toBeUndefined();
    expect(firestore.batches).toEqual([[COPY, INBOX_COPY]]);
  });

  it("touches no inbox for the user's own routine", async () => {
    firestore.cached.add(COPY);
    const { library } = setup();
    await expect(library.remove("copy-1")).resolves.toBeUndefined();
    expect(firestore.batches).toEqual([]);
    expect(firestore.deleteDoc).toHaveBeenCalledWith({ path: COPY });
  });

  it("passes the server's refusal on", async () => {
    firestore.cached.add(COPY);
    firestore.receivedHere.add(COPY);
    firestore.commit.mockRejectedValue(
      Object.assign(new Error("refused"), { code: "permission-denied" }),
    );
    const { library } = setup();
    await expect(library.remove("copy-1")).rejects.toMatchObject({ code: "permission-denied" });
  });
});

describe("reading the newest routines (T38)", () => {
  /** `count` stored routines, newest first, named R1, R2… */
  const storedRoutines = (count: number, newestAt = 100_000) =>
    Array.from({ length: count }, (_, index) => ({
      id: `stored-${index + 1}`,
      data: toStoredRoutine({ ...draft, name: `R${index + 1}`, createdAt: newestAt - index }),
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
    firestore.listedOnServer = storedRoutines(25);
    firestore.listedHere = [];
    firestore.limits.length = 0;
    firestore.listenErrors.length = 0;
  });

  it("asks the server for only the newest it is asked for", () => {
    const { library } = setup();
    expect(namesRead(library, 21)).toEqual(
      Array.from({ length: 21 }, (_, index) => `R${index + 1}`),
    );
    expect(firestore.limits).toEqual([21]);
  });

  it("reads every routine when not asked for a number, as before", () => {
    const { library } = setup();
    expect(namesRead(library)).toHaveLength(25);
    expect(firestore.limits).toEqual([null]);
  });

  it("shows a save still held on this device at the top, besides the newest read", () => {
    // The held save was made at 1,000, after every stored one.
    firestore.listedOnServer = storedRoutines(25, 900);
    const { library } = setup({ pending: true, ready: false });
    const names = namesRead(library, 21);
    expect(names[0]).toBe("Push day");
    expect(names).toHaveLength(22);
  });

  it("offline, reads more from this device's cache and never fails", () => {
    firestore.serverReachable = false;
    firestore.listedHere = storedRoutines(30);
    const { library } = setup();
    expect(namesRead(library, 21)).toHaveLength(21);
    expect(namesRead(library, 41)).toHaveLength(30);
    expect(firestore.limits).toEqual([21, 41]);
    expect(firestore.listenErrors).toEqual([]);
  });
});
