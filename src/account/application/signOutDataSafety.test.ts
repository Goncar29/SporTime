import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { withOutbox, type Pending } from "../../shared/application/outbox";
import { createLocalAccountData } from "../infrastructure/localAccountData";
import { signOut } from "./signOut";

interface Item {
  id: string;
}

/**
 * A server that confirms writes only when the test says so, and a Firestore-like collection in
 * front of it: a write is cached at once, and settles when the server confirms it.
 */
function createServer() {
  const cached = new Set<string>();
  const confirmed = new Set<string>();
  const unconfirmed = new Map<string, () => void>();
  let waiters: { ids: string[]; resolve: () => void }[] = [];

  const settleWaiters = () => {
    const done = (ids: string[]) => ids.every((id) => confirmed.has(id));
    const ready = waiters.filter(({ ids }) => done(ids));
    waiters = waiters.filter(({ ids }) => !done(ids));
    ready.forEach(({ resolve }) => {
      resolve();
    });
  };

  let nextId = 0;
  const collection = {
    subscribe: () => () => undefined,
    newId: () => `w${String(++nextId)}`,
    put: (id: string) => {
      cached.add(id);
      return new Promise<void>((resolve) => {
        unconfirmed.set(id, resolve);
      });
    },
    has: (id: string) => Promise.resolve(cached.has(id)),
  };

  return {
    collection,
    confirmed,
    /** Like `waitForPendingWrites`: only the writes issued before the call. */
    serverHasWrites: () =>
      new Promise<void>((resolve) => {
        waiters.push({ ids: [...unconfirmed.keys()], resolve });
        settleWaiters();
      }),
    confirm(id: string) {
      unconfirmed.get(id)?.();
      unconfirmed.delete(id);
      confirmed.add(id);
      settleWaiters();
    },
    confirmAll() {
      [...unconfirmed.keys()].forEach((id) => {
        this.confirm(id);
      });
    },
  };
}

function setup() {
  const server = createServer();
  let held: Pending<object>[] = [];
  const store = {
    load: () => held,
    save: (items: Pending<object>[]) => {
      held = items;
    },
  };
  const outbox = withOutbox<Item, object>({
    collection: server.collection,
    store,
    parse: (id) => ({ id }),
    newestFirst: () => 0,
    whenReady: () => Promise.resolve(true),
  });
  // What the server held when the session ended: anything else on the device is erased then.
  const atSignOut: string[] = [];
  const auth = {
    signOut: vi.fn(() => {
      atSignOut.push(...server.confirmed);
      return Promise.resolve();
    }),
  };
  const local = createLocalAccountData({
    outboxes: [outbox],
    discardPendingWrites: () => {
      store.save([]);
    },
    serverHasWrites: server.serverHasWrites,
    clearCache: () => Promise.resolve(),
    forget: () => undefined,
  });
  return { server, outbox, store, auth, local, atSignOut };
}

/** Lets every queued promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("signing out never loses data", () => {
  beforeEach(() => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never erases a change made while signing out unless the server has it", async () => {
    const { server, outbox, auth, local, atSignOut } = setup();
    void outbox.add({});
    await settle();

    const result = signOut({ auth, local });
    await settle();
    // Made while "Signing out…" shows, after the send step started waiting for the server.
    void outbox.add({});
    await settle();
    server.confirm("w1");
    await settle();
    server.confirmAll();

    const outcome = await result;
    if (outcome === "signedOut") expect(atSignOut.sort()).toEqual(["w1", "w2"]);
    else expect(outcome).toBe("unsent");
  });

  it("does not sign out while a change made during the send is still unconfirmed", async () => {
    vi.useFakeTimers();
    try {
      const { server, outbox, store, auth, local } = setup();
      void outbox.add({});
      await vi.advanceTimersByTimeAsync(0);

      const result = signOut({ auth, local });
      await vi.advanceTimersByTimeAsync(0);
      void outbox.add({});
      await vi.advanceTimersByTimeAsync(0);
      server.confirm("w1");
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBe("unsent");
      expect(auth.signOut).not.toHaveBeenCalled();
      expect(server.confirmed.has("w2")).toBe(false);
      expect(store.load()).toEqual([]);
      await expect(server.collection.has("w2")).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the pending changes when the provider refuses a forced sign-out", async () => {
    const { store, auth, local } = setup();
    // After the outbox's own start-up send, so nothing hands this one to the collection.
    await settle();
    // Held on this device, as when offline or before the account is ready.
    store.save([{ id: "w9", draft: {} }]);
    auth.signOut.mockRejectedValueOnce(new Error("network"));

    await expect(signOut({ auth, local }, { force: true })).rejects.toThrow("network");
    expect(store.load()).toEqual([{ id: "w9", draft: {} }]);
  });
});
