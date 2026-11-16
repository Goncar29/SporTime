import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import { defaultConfig } from "../../workouts/domain/workout";
import type { HistoryDraft } from "../domain/historyEntry";
import { createFirestoreHistoryLog } from "./firestoreHistoryLog";

const firestore = vi.hoisted(() => ({
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  /** What happened, in order, including cache reads. */
  calls: [] as string[],
  setDoc: vi.fn((_ref: { path: string }, _data?: unknown) => Promise.resolve()),
  deleteDoc: vi.fn((_ref: { path: string }) => Promise.resolve()),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path: string }, id = "new-id") => ({ path: `${parent.path}/${id}` }),
  getDocFromCache: (ref: { path: string }) => {
    firestore.calls.push(`cacheRead ${ref.path}`);
    return Promise.resolve({ exists: () => firestore.cached.has(ref.path) });
  },
  limit: () => ({}),
  onSnapshot: () => () => undefined,
  orderBy: () => ({}),
  query: () => ({}),
  setDoc: firestore.setDoc,
  deleteDoc: firestore.deleteDoc,
}));

const NEW = "users/u1/history/new-id";
const OLD = "users/u1/history/h1";
const draft: HistoryDraft = {
  config: defaultConfig("stopwatch"),
  finishedAt: 1_700_000_000_000,
  activeMs: 60_000,
  marks: 0,
};

type Guard = <T>(write: () => Promise<T>) => Promise<T>;

function setup(guard?: Guard) {
  let items: { id: string; draft: HistoryDraft }[] = [];
  const store: OutboxStore<HistoryDraft> = {
    load: () => items,
    save(next) {
      items = next;
    },
  };
  const log = createFirestoreHistoryLog({} as never, "u1", {
    store,
    whenReady: () => Promise.resolve(true),
    guard,
  });
  return { log, store };
}

function recordingGuard(): Guard {
  return async (write) => {
    firestore.calls.push("lock");
    const result = await write();
    firestore.calls.push("unlock");
    return result;
  };
}

const neverAnswered = () => new Promise<void>(() => undefined);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("history writes", () => {
  beforeEach(() => {
    firestore.cached.clear();
    firestore.calls.length = 0;
    firestore.setDoc.mockReset();
    firestore.deleteDoc.mockReset();
  });

  describe("while another tab may be signing out", () => {
    beforeEach(() => {
      firestore.setDoc.mockImplementation((ref) => {
        firestore.calls.push(`setDoc ${ref.path}`);
        firestore.cached.add(ref.path);
        return neverAnswered();
      });
      firestore.deleteDoc.mockImplementation((ref) => {
        firestore.calls.push(`deleteDoc ${ref.path}`);
        return neverAnswered();
      });
    });

    it("adds while holding the account's lock, until Firestore's cache has it, but not the server's answer", async () => {
      const { log, store } = setup(recordingGuard());
      void log.add(draft);
      await settle();
      const unlock = firestore.calls.indexOf("unlock");
      expect(firestore.calls[0]).toBe("lock");
      expect(unlock).toBeGreaterThan(firestore.calls.indexOf(`setDoc ${NEW}`));
      expect(firestore.calls.lastIndexOf(`cacheRead ${NEW}`)).toBeLessThan(unlock);
      expect(store.load()).toEqual([]);
    });

    it("removes while holding the lock, until Firestore's cache has the change", async () => {
      const { log } = setup(recordingGuard());
      void log.remove("h1");
      await settle();
      expect(firestore.calls).toEqual(["lock", `deleteDoc ${OLD}`, `cacheRead ${OLD}`, "unlock"]);
    });

    it("writes nothing when the lock refuses, and passes the refusal on", async () => {
      const refusal = new Error("signed out in another tab");
      const { log, store } = setup(() => Promise.reject(refusal));
      await expect(log.add(draft)).rejects.toBe(refusal);
      await expect(log.remove("h1")).rejects.toBe(refusal);
      expect(firestore.setDoc).not.toHaveBeenCalled();
      expect(firestore.deleteDoc).not.toHaveBeenCalled();
      expect(store.load()).toEqual([]);
    });
  });

  it("without a lock, adds and removes as before, settling when the server answers", async () => {
    firestore.setDoc.mockImplementation((ref) => {
      firestore.cached.add(ref.path);
      return Promise.resolve();
    });
    firestore.deleteDoc.mockResolvedValue(undefined);
    const { log } = setup();
    await expect(log.add(draft)).resolves.toBeUndefined();
    expect(firestore.setDoc).toHaveBeenCalledOnce();
    await expect(log.remove("h1")).resolves.toBeUndefined();
    expect(firestore.deleteDoc).toHaveBeenCalledWith({ path: OLD });
  });
});
