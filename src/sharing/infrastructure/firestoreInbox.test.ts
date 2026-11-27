import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { SharedCopy } from "../domain/sharedCopy";
import { createFirestoreInbox } from "./firestoreInbox";

const firestore = vi.hoisted(() => ({
  calls: [] as unknown[][],
  /** How the transaction's commit answers. */
  commit: () => Promise.resolve(),
}));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  serverTimestamp: () => "SERVER_TIME",
  setDoc: (...args: unknown[]) => {
    firestore.calls.push(["setDoc", ...args]);
    return Promise.resolve();
  },
  runTransaction: async (
    _db: unknown,
    update: (transaction: unknown) => Promise<unknown>,
    options: unknown,
  ) => {
    firestore.calls.push(["runTransaction", options]);
    await update({
      set: (ref: { path: string }, data: unknown) => {
        firestore.calls.push(["set", ref.path, data]);
      },
      get: () => {
        firestore.calls.push(["get"]);
        return Promise.resolve();
      },
    });
    return firestore.commit();
  },
}));

const copy: SharedCopy = {
  fromUid: "alice",
  fromEmail: "alice@example.com",
  fromName: "Alice",
  name: "Piernas",
  stages: [{ exercises: "Remo\t10\t\t\t\t" }],
};

beforeEach(() => {
  firestore.calls = [];
  firestore.commit = () => Promise.resolve();
});

it("writes the copy once, with the server's time, in a transaction that needs the server", async () => {
  await createFirestoreInbox({} as never).create("bob", "c1", copy);
  expect(firestore.calls).toEqual([
    // One attempt: the SDK must not resend a commit whose answer was lost (L56 A4).
    ["runTransaction", { maxAttempts: 1 }],
    ["set", "users/bob/inbox/c1", { ...copy, sentAt: "SERVER_TIME" }],
  ]);
});

it("passes on the server's refusal or a lost answer, never queuing the write", async () => {
  firestore.commit = () =>
    Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" }));
  await expect(createFirestoreInbox({} as never).create("bob", "c1", copy)).rejects.toMatchObject({
    code: "unavailable",
  });
  expect(firestore.calls.some(([name]) => name === "setDoc")).toBe(false);
});
