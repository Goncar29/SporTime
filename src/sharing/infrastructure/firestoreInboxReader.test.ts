import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { InboxCopy } from "../application/ports";
import { createFirestoreInboxReader } from "./firestoreInboxReader";

const firestore = vi.hoisted(() => ({
  calls: [] as unknown[][],
  /** The listener the adapter registered, to send it snapshots. */
  listener: null as null | ((snapshot: unknown) => void),
  onError: null as null | ((error: Error) => void),
  options: null as unknown,
  unsubscribed: 0,
  deleteDoc: (ref: { path: string }) => {
    firestore.calls.push(["deleteDoc", ref.path]);
    return Promise.resolve();
  },
}));

vi.mock("firebase/firestore", () => {
  class Timestamp {
    constructor(private readonly ms: number) {}
    toMillis() {
      return this.ms;
    }
  }
  return {
    Timestamp,
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
    doc: (parent: { path: string }, id: string) => ({ path: `${parent.path}/${id}` }),
    deleteDoc: (ref: { path: string }) => firestore.deleteDoc(ref),
    onSnapshot: (
      ref: { path: string },
      options: unknown,
      onNext: (snapshot: unknown) => void,
      onError: (error: Error) => void,
    ) => {
      firestore.calls.push(["onSnapshot", ref.path]);
      firestore.options = options;
      firestore.listener = onNext;
      firestore.onError = onError;
      return () => {
        firestore.unsubscribed++;
      };
    },
  };
});

const { Timestamp } = (await import("firebase/firestore")) as unknown as {
  Timestamp: new (ms: number) => unknown;
};

const snapshot = (fromCache: boolean, docs: { id: string; data: Record<string, unknown> }[]) => ({
  metadata: { fromCache },
  docs: docs.map(({ id, data }) => ({ id, data: () => data })),
});

beforeEach(() => {
  firestore.calls.length = 0;
  firestore.listener = null;
  firestore.unsubscribed = 0;
  firestore.deleteDoc = (ref) => {
    firestore.calls.push(["deleteDoc", ref.path]);
    return Promise.resolve();
  };
});

it("listens to the user's own inbox and reports what the server holds, with sentAt in milliseconds", () => {
  const reader = createFirestoreInboxReader({} as never, "bob");
  const reports: InboxCopy[][] = [];
  const stop = reader.subscribe(
    (copies) => reports.push(copies),
    () => undefined,
  );
  expect(firestore.calls).toEqual([["onSnapshot", "users/bob/inbox"]]);
  // Told when an answer from the cache becomes the server's.
  expect(firestore.options).toEqual({ includeMetadataChanges: true });

  firestore.listener!(
    snapshot(false, [{ id: "c1", data: { name: "Piernas", sentAt: new Timestamp(1_750) } }]),
  );
  expect(reports).toEqual([[{ id: "c1", data: { name: "Piernas", sentAt: 1_750 } }]]);
  stop();
  expect(firestore.unsubscribed).toBe(1);
});

it("ignores a list read only from this device's cache, which may hold copies received elsewhere", () => {
  const reader = createFirestoreInboxReader({} as never, "bob");
  const reports: InboxCopy[][] = [];
  reader.subscribe(
    (copies) => reports.push(copies),
    () => undefined,
  );
  firestore.listener!(snapshot(true, [{ id: "stale", data: { sentAt: new Timestamp(1) } }]));
  expect(reports).toEqual([]);
  firestore.listener!(snapshot(false, []));
  expect(reports).toEqual([[]]);
});

it("passes any other sentAt on as it is, for the domain to refuse", () => {
  const reader = createFirestoreInboxReader({} as never, "bob");
  const reports: InboxCopy[][] = [];
  reader.subscribe(
    (copies) => reports.push(copies),
    () => undefined,
  );
  firestore.listener!(snapshot(false, [{ id: "c1", data: { sentAt: "yesterday" } }]));
  expect(reports).toEqual([[{ id: "c1", data: { sentAt: "yesterday" } }]]);
});

it("reports a listener failure", () => {
  const reader = createFirestoreInboxReader({} as never, "bob");
  const onError = vi.fn();
  reader.subscribe(() => undefined, onError);
  const error = new Error("denied");
  firestore.onError!(error);
  expect(onError).toHaveBeenCalledWith(error);
});

it("deletes a copy while holding the account's lock, settling when the server answers", async () => {
  let answer!: () => void;
  firestore.deleteDoc = (ref) => {
    firestore.calls.push(["deleteDoc", ref.path]);
    return new Promise<void>((resolve) => {
      answer = resolve;
    });
  };
  const guard = async <T>(write: () => Promise<T>): Promise<T> => {
    firestore.calls.push(["lock"]);
    const result = await write();
    firestore.calls.push(["unlock"]);
    return result;
  };
  const reader = createFirestoreInboxReader({} as never, "bob", { guard });
  let settled = false;
  const removed = reader.remove("c1").then(() => {
    settled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // The lock is let go once the delete is handed to Firestore, not when the server answers.
  expect(firestore.calls).toEqual([["lock"], ["deleteDoc", "users/bob/inbox/c1"], ["unlock"]]);
  expect(settled).toBe(false);
  answer();
  await removed;
  expect(settled).toBe(true);
});

it("passes a refused delete on", async () => {
  firestore.deleteDoc = () =>
    Promise.reject(Object.assign(new Error("refused"), { code: "permission-denied" }));
  const reader = createFirestoreInboxReader({} as never, "bob");
  await expect(reader.remove("c1")).rejects.toMatchObject({ code: "permission-denied" });
});
