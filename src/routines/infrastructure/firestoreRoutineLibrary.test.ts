import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import { toStoredRoutine, type Routine, type RoutineDraft } from "../domain/routine";
import { createFirestoreRoutineLibrary } from "./firestoreRoutineLibrary";

const firestore = vi.hoisted(() => ({
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  /** Paths whose document the server holds. */
  onServer: new Set<string>(),
  serverReachable: true,
  updateDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  setDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  deleteDoc: vi.fn((_ref: { path: string }) => Promise.resolve()),
  /** Stands for Firestore's sentinel that removes a field on update. */
  deleted: { deleteField: true },
  /** What happened, in order, including cache reads. */
  calls: [] as string[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path: string }, id = "new-id") => ({ path: `${parent.path}/${id}` }),
  deleteField: () => firestore.deleted,
  getDocFromCache: (ref: { path: string }) => {
    firestore.calls.push(`cacheRead ${ref.path}`);
    return Promise.resolve({ exists: () => firestore.cached.has(ref.path) });
  },
  getDocFromServer: (ref: { path: string }) =>
    firestore.serverReachable
      ? Promise.resolve({ exists: () => firestore.onServer.has(ref.path) })
      : Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" })),
  onSnapshot: () => () => undefined,
  orderBy: () => ({}),
  query: () => ({}),
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

function setup({
  pending = false,
  ready = true,
  guard,
}: { pending?: boolean; ready?: boolean; guard?: Guard } = {}) {
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
    const { library } = setup({ guard: recordingGuard() });
    void library.remove("r1");
    await settle();
    expect(firestore.calls).toEqual(["lock", `deleteDoc ${PATH}`, `cacheRead ${PATH}`, "unlock"]);
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
