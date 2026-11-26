import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import type { BlockedSender } from "../domain/blockedSender";
import { createFirestoreBlockedSenders } from "./firestoreBlockedSenders";

const firestore = vi.hoisted(() => ({
  /** The account's blocked senders as Firestore reports them, by id. */
  blocked: new Map<string, object>(),
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  /** How setDoc and deleteDoc answer; at once by default. */
  answer: () => Promise.resolve(),
  /** What happened, in order. */
  calls: [] as string[],
  listeners: new Set<() => void>(),
  /** Whether a snapshot comes only from this device's cache, the server not having answered. */
  fromCache: false,
}));

const report = () => {
  firestore.listeners.forEach((listener) => {
    listener();
  });
};

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path?: string }, ...segments: string[]) => ({
    path: [...(parent.path ? [parent.path] : []), ...segments].join("/"),
  }),
  getDocFromCache: ({ path }: { path: string }) => {
    firestore.calls.push(`cacheRead ${path}`);
    return Promise.resolve({ exists: () => firestore.cached.has(path) });
  },
  onSnapshot: (
    _query: unknown,
    optionsOrNext: unknown,
    maybeNext?: (snapshot: unknown) => void,
  ) => {
    const onNext = (typeof optionsOrNext === "function" ? optionsOrNext : maybeNext) as (
      snapshot: unknown,
    ) => void;
    const listener = () => {
      onNext({
        docs: [...firestore.blocked].map(([id, data]) => ({ id, data: () => data })),
        metadata: { fromCache: firestore.fromCache },
      });
    };
    firestore.listeners.add(listener);
    listener();
    return () => firestore.listeners.delete(listener);
  },
  setDoc: ({ path }: { path: string }, data: object) => {
    firestore.calls.push(`setDoc ${path} ${JSON.stringify(data)}`);
    firestore.cached.add(path);
    firestore.blocked.set(path.split("/").at(-1) ?? "", data);
    report();
    return firestore.answer();
  },
  deleteDoc: ({ path }: { path: string }) => {
    firestore.calls.push(`deleteDoc ${path}`);
    firestore.cached.delete(path);
    firestore.blocked.delete(path.split("/").at(-1) ?? "");
    report();
    return firestore.answer();
  },
}));

const alice: BlockedSender = { uid: "alice", name: "Alice Liddell", email: "alice@example.com" };

type Guard = <T>(write: () => Promise<T>) => Promise<T>;

function setup({
  guard,
  ready = () => Promise.resolve(true),
}: { guard?: Guard; ready?: () => Promise<boolean> } = {}) {
  let items: { id: string; draft: BlockedSender }[] = [];
  const store: OutboxStore<BlockedSender> = {
    load: () => items,
    save(next) {
      items = next;
    },
  };
  const blocked = createFirestoreBlockedSenders({} as never, "u1", {
    store,
    whenReady: ready,
    guard,
  });
  return { blocked, store };
}

function recordingGuard(): Guard {
  return async (write) => {
    firestore.calls.push("lock");
    const result = await write();
    firestore.calls.push("unlock");
    return result;
  };
}

const writes = () => firestore.calls.filter((call) => /^(setDoc|deleteDoc)/.test(call));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function listed(blocked: ReturnType<typeof setup>["blocked"]) {
  const seen: BlockedSender[][] = [];
  const stop = blocked.subscribe(
    (items) => seen.push(items),
    () => undefined,
  );
  return { latest: () => seen.at(-1), stop };
}

describe("createFirestoreBlockedSenders (T27)", () => {
  beforeEach(() => {
    firestore.blocked.clear();
    firestore.cached.clear();
    firestore.listeners.clear();
    firestore.calls.length = 0;
    firestore.answer = () => Promise.resolve();
    firestore.fromCache = false;
  });

  it("blocks under the sender's uid with exactly the name and email, settling when the server answers", async () => {
    const { blocked } = setup();
    await expect(blocked.block(alice)).resolves.toBeUndefined();
    expect(writes()).toEqual([
      'setDoc users/u1/blocked/alice {"name":"Alice Liddell","email":"alice@example.com"}',
    ]);
  });

  it("holds a block on this device until Firestore's cache has it, listed meanwhile, so it is never lost", async () => {
    // Firestore not ready, as during Auth's start-up lookup: nothing can be written yet.
    const { blocked, store } = setup({ ready: () => new Promise(() => undefined) });
    const list = listed(blocked);
    void blocked.block(alice);
    await settle();
    expect(writes()).toEqual([]);
    expect(store.load()).toEqual([{ id: "alice", draft: alice }]);
    expect(list.latest()).toEqual([alice]);
    list.stop();
  });

  it("holds the account's lock until Firestore's cache has the block, not the server's answer", async () => {
    firestore.answer = () => new Promise(() => undefined);
    const { blocked, store } = setup({ guard: recordingGuard() });
    void blocked.block(alice);
    await settle();
    const set = firestore.calls.findIndex((call) => call.startsWith("setDoc"));
    expect(firestore.calls.indexOf("lock")).toBeLessThan(set);
    expect(firestore.calls.indexOf("unlock")).toBeGreaterThan(set);
    expect(store.load()).toEqual([]);
  });

  it("writes nothing when the lock refuses, and passes the refusal on", async () => {
    const refusal = new Error("signed out in another tab");
    const { blocked, store } = setup({ guard: () => Promise.reject(refusal) });
    await expect(blocked.block(alice)).rejects.toBe(refusal);
    await expect(blocked.unblock("alice")).rejects.toBe(refusal);
    expect(writes()).toEqual([]);
    expect(store.load()).toEqual([]);
  });

  it("passes on the server's refusal of a block", async () => {
    const denied = Object.assign(new Error("denied"), { code: "permission-denied" });
    firestore.answer = () => Promise.reject(denied);
    const { blocked } = setup();
    await expect(blocked.block(alice)).rejects.toBe(denied);
  });

  it("unblocks, settling when the server answers, and drops a block still held here", async () => {
    firestore.blocked.set("alice", { name: alice.name, email: alice.email });
    firestore.cached.add("users/u1/blocked/alice");
    const { blocked } = setup({ guard: recordingGuard() });
    await expect(blocked.unblock("alice")).resolves.toBeUndefined();
    expect(firestore.calls).toEqual([
      "lock",
      "deleteDoc users/u1/blocked/alice",
      "cacheRead users/u1/blocked/alice",
      "unlock",
    ]);
    expect(firestore.blocked.has("alice")).toBe(false);

    const held = setup({ ready: () => new Promise(() => undefined) });
    void held.blocked.block(alice);
    await settle();
    await held.blocked.unblock("alice");
    expect(held.store.load()).toEqual([]);
  });

  describe("as the receiver reads them (L69 A1)", () => {
    function answered(blocked: ReturnType<typeof setup>["blocked"]) {
      const seen: string[][] = [];
      const stop = blocked.subscribeAnswered(
        (items) => seen.push(items.map(({ uid }) => uid)),
        () => undefined,
      );
      return { seen, stop };
    }

    it("reports nothing while only this device's cache and outbox answered", async () => {
      firestore.fromCache = true;
      firestore.blocked.set("zoe", { name: "Zoe", email: "zoe@example.com" });
      // A block still held here, before Firestore can take it.
      const { blocked } = setup({ ready: () => new Promise(() => undefined) });
      void blocked.block(alice);
      const list = answered(blocked);
      await settle();
      expect(list.seen).toEqual([]);
      list.stop();
    });

    it("reports once the server answered, with blocks still held here on top", async () => {
      firestore.fromCache = true;
      const { blocked } = setup({ ready: () => new Promise(() => undefined) });
      void blocked.block(alice);
      const list = answered(blocked);
      await settle();
      // Blocked on another device: only the server knows.
      firestore.blocked.set("mallory", { name: "Mallory", email: "mallory@example.com" });
      firestore.fromCache = false;
      report();
      await settle();
      expect(list.seen.at(-1)).toEqual(["alice", "mallory"]);
      list.stop();
      expect(firestore.listeners.size).toBe(0);
    });
  });

  it("lists blocked senders by the name shown, leaving out any it cannot read", async () => {
    firestore.blocked.set("zoe", { name: "Zoe", email: "zoe@example.com" });
    firestore.blocked.set("alice", { name: alice.name, email: alice.email });
    firestore.blocked.set("ana", { name: "", email: "ana@example.com" });
    firestore.blocked.set("bad", { name: "X" });
    const { blocked } = setup();
    const list = listed(blocked);
    await settle();
    list.stop();
    expect(list.latest()?.map(({ uid }) => uid)).toEqual(["alice", "ana", "zoe"]);
  });
});
