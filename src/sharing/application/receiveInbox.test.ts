// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Routine, RoutineDraft } from "../../routines/domain/routine";
import { buildSharedCopy, type SharedCopy } from "../domain/sharedCopy";
import type { InboxCopy, InboxReader, ReceivedRoutineStore } from "./ports";
import { createInboxReceiver } from "./receiveInbox";

const piernas: RoutineDraft = {
  name: "Piernas",
  createdAt: 1,
  stages: [{ name: "A", exercises: [{ name: "Sentadilla", repsMin: 8, repsMax: 10 }] }],
};

function copyOf(name: string): SharedCopy {
  const result = buildSharedCopy(
    { ...piernas, name },
    { uid: "alice", email: "alice@example.com", emailVerified: true, name: "Alice" },
  );
  if (!("copy" in result)) throw new Error("refused");
  return result.copy;
}

const inboxCopy = (id: string, name = `Rutina ${id}`): InboxCopy => ({
  id,
  data: { ...copyOf(name), sentAt: 1_750_000_000_000 },
});

const failure = (code: string) => Object.assign(new Error(code), { code });

/** Settles when the test says so. */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The server's inbox and the user's routines. The inbox reports its copies to every listener
 * whenever it changes, and when `report()` is called (as a listener reconnecting would).
 */
function server() {
  const copies = new Map<string, InboxCopy>();
  const routines = new Map<string, Routine>();
  const listeners = new Set<(copies: InboxCopy[]) => void>();
  const events: string[] = [];
  /** When set, each routine write waits for the test to settle it. */
  let holdWrites = false;
  const heldWrites = new Map<string, ReturnType<typeof deferred>>();
  const refuseWrites = new Set<string>();
  const refuseRemoves = new Set<string>();

  const report = () => {
    const list = [...copies.values()];
    listeners.forEach((listener) => {
      listener(list);
    });
  };

  const inbox: InboxReader = {
    subscribe(onCopies) {
      listeners.add(onCopies);
      onCopies([...copies.values()]);
      return () => {
        listeners.delete(onCopies);
      };
    },
    remove(copyId) {
      events.push(`remove ${copyId}`);
      if (refuseRemoves.has(copyId)) return Promise.reject(failure("permission-denied"));
      copies.delete(copyId);
      report();
      return Promise.resolve();
    },
  };

  const store: ReceivedRoutineStore = {
    async receive(routine) {
      events.push(`receive ${routine.id}`);
      if (holdWrites) {
        const held = deferred();
        heldWrites.set(routine.id, held);
        await held.promise;
      }
      if (refuseWrites.has(routine.id)) throw failure("permission-denied");
      if (!routines.has(routine.id)) routines.set(routine.id, routine);
      events.push(`stored ${routine.id}`);
    },
  };

  return {
    copies,
    routines,
    events,
    inbox,
    store,
    report,
    listenerCount: () => listeners.size,
    add(...items: InboxCopy[]) {
      items.forEach((item) => copies.set(item.id, item));
      report();
    },
    holdWrites() {
      holdWrites = true;
    },
    heldWrite: (id: string) => heldWrites.get(id),
    refuseWrite: (id: string) => refuseWrites.add(id),
    refuseRemove: (id: string) => refuseRemoves.add(id),
  };
}

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("receiving the inbox (T26, S12)", () => {
  it("turns every copy into one routine under its id, then empties the inbox", async () => {
    const fake = server();
    fake.add(inboxCopy("c1"), inboxCopy("c2"));
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    await settle();

    expect([...fake.routines.keys()].sort()).toEqual(["c1", "c2"]);
    expect(fake.routines.get("c1")).toMatchObject({
      id: "c1",
      name: "Rutina c1",
      receivedFrom: { uid: "alice", name: "Alice", email: "alice@example.com" },
    });
    expect(fake.copies.size).toBe(0);
    expect(fake.events.filter((event) => event.startsWith("receive"))).toHaveLength(2);
    stop();
  });

  it("receives copies that arrive later, while it listens", async () => {
    const fake = server();
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    fake.add(inboxCopy("late"));
    await settle();
    expect([...fake.routines.keys()]).toEqual(["late"]);
    expect(fake.copies.size).toBe(0);
    stop();
  });

  it("deletes a copy only after its routine is stored, never before", async () => {
    const fake = server();
    fake.holdWrites();
    fake.add(inboxCopy("c1"));
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    await settle();

    // The routine is not confirmed yet: the copy stays.
    expect(fake.events).toEqual(["receive c1"]);
    expect(fake.copies.has("c1")).toBe(true);

    fake.heldWrite("c1")!.resolve();
    await settle();
    expect(fake.events).toEqual(["receive c1", "stored c1", "remove c1"]);
    expect(fake.copies.has("c1")).toBe(false);
    stop();
  });

  it("receives the same copy once, however often the inbox reports it meanwhile", async () => {
    const fake = server();
    fake.holdWrites();
    fake.add(inboxCopy("c1"));
    const receiver = createInboxReceiver({ inbox: fake.inbox, routines: fake.store });
    const stop = receiver.start();
    fake.report();
    fake.report();
    // Stopped and started again, as React does with an effect.
    stop();
    const again = receiver.start();
    fake.report();
    await settle();
    expect(fake.events).toEqual(["receive c1"]);

    fake.heldWrite("c1")!.resolve();
    await settle();
    expect(fake.events).toEqual(["receive c1", "stored c1", "remove c1"]);
    expect(fake.routines.size).toBe(1);
    again();
  });

  it("writes one routine when two receivers (two tabs) take the same copy", async () => {
    const fake = server();
    fake.add(inboxCopy("c1"));
    // Each tab has its own receiver; both see the copy before either deletes it.
    const a = createInboxReceiver({ inbox: fake.inbox, routines: fake.store });
    const b = createInboxReceiver({ inbox: fake.inbox, routines: fake.store });
    const stopA = a.start();
    const stopB = b.start();
    await settle();
    expect(fake.events.filter((event) => event === "receive c1")).toHaveLength(2);
    // Both use the copy's id, so the second finds the routine there and adds nothing.
    expect([...fake.routines.keys()]).toEqual(["c1"]);
    expect(fake.copies.size).toBe(0);
    stopA();
    stopB();
  });

  it("leaves a copy whose routine the server refused, and does not try it again", async () => {
    const fake = server();
    fake.refuseWrite("bad");
    fake.add(inboxCopy("bad"), inboxCopy("good"));
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    await settle();

    expect(fake.copies.has("bad")).toBe(true);
    expect(fake.routines.has("bad")).toBe(false);
    expect(fake.routines.has("good")).toBe(true);
    expect(fake.events).not.toContain("remove bad");

    // Reported again, it is not written again: no loop of refused writes.
    fake.report();
    fake.report();
    await settle();
    expect(fake.events.filter((event) => event === "receive bad")).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("could not be stored"),
      "bad",
      expect.objectContaining({ code: "permission-denied" }),
    );
    stop();
  });

  it("keeps a copy whose routine was given up after repeated conflicts, and receives it once on the next page load (T36, L99)", async () => {
    const fake = server();
    fake.add(inboxCopy("c1"));
    // The routine store gave up (5 conflicts) and passed the failure on.
    const givingUp: ReceivedRoutineStore = {
      receive(routine) {
        fake.events.push(`receive ${routine.id}`);
        return Promise.reject(failure("failed-precondition"));
      },
    };
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: givingUp }).start();
    await settle();
    fake.report();
    await settle();
    expect(fake.copies.has("c1")).toBe(true);
    expect(fake.events).toEqual(["receive c1"]);
    stop();

    // The next page load has a new receiver, which tries it again.
    const next = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    await settle();
    expect(fake.events).toEqual(["receive c1", "receive c1", "stored c1", "remove c1"]);
    expect([...fake.routines.keys()]).toEqual(["c1"]);
    expect(fake.copies.size).toBe(0);
    next();
  });

  it("shows a copy it cannot open by its sender, deletes one nobody can be named for, and receives the others (T29 W5)", async () => {
    const fake = server();
    fake.add(
      { id: "newer", data: { ...(inboxCopy("x").data as object), version: 2 } },
      { id: "broken", data: "not a copy" },
      inboxCopy("good"),
    );
    const shown: string[][] = [];
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start(
      (copies) => {
        shown.push(copies.map(({ id, sender }) => `${id} ${sender.uid} ${sender.email}`));
      },
    );
    await settle();
    fake.report();
    await settle();

    expect([...fake.routines.keys()]).toEqual(["good"]);
    // The copy from Alice stays, shown to the user; the one with no sender is gone.
    expect([...fake.copies.keys()]).toEqual(["newer"]);
    expect(shown.at(-1)).toEqual(["newer alice alice@example.com"]);
    expect(fake.events.filter((event) => event.startsWith("receive"))).toEqual(["receive good"]);
    expect(fake.events).toContain("remove broken");
    expect(fake.events).not.toContain("remove newer");
    // Reported once each, by id only: the developer's log never holds what the copy says.
    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("cannot be opened"), "newer");
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("no sender it can name; it is deleted"),
      "broken",
    );
    stop();
  });

  it("keeps the routine and reports a copy it could not delete, without trying again", async () => {
    const fake = server();
    fake.refuseRemove("c1");
    fake.add(inboxCopy("c1"));
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    await settle();
    fake.report();
    await settle();

    expect(fake.routines.has("c1")).toBe(true);
    expect(fake.copies.has("c1")).toBe(true);
    expect(fake.events).toEqual(["receive c1", "stored c1", "remove c1"]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("could not be deleted"),
      "c1",
      expect.objectContaining({ code: "permission-denied" }),
    );
    stop();
  });

  it("stops listening when stopped, and reports a failed listener", () => {
    const fake = server();
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    expect(fake.listenerCount()).toBe(1);
    stop();
    expect(fake.listenerCount()).toBe(0);

    const failing: InboxReader = {
      subscribe: (_onCopies, onError) => {
        onError(failure("permission-denied"));
        return () => undefined;
      },
      remove: () => Promise.resolve(),
    };
    createInboxReceiver({ inbox: failing, routines: fake.store }).start()();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("inbox could not be read"),
      expect.objectContaining({ code: "permission-denied" }),
    );
  });
});

describe("copies the app cannot open (T29 W5)", () => {
  const newer = (id: string, fromUid = "alice"): InboxCopy => ({
    id,
    data: { ...(inboxCopy(id).data as object), fromUid, version: 2 },
  });

  function listen(receiver: ReturnType<typeof createInboxReceiver>) {
    const shown: string[][] = [];
    const stop = receiver.start((copies) => {
      shown.push(copies.map(({ id }) => id));
    });
    return { shown, stop, last: () => shown.at(-1) };
  }

  it("are deleted when the user asks, and no longer shown", async () => {
    const fake = server();
    fake.add(newer("n1"), newer("n2"));
    const receiver = createInboxReceiver({ inbox: fake.inbox, routines: fake.store });
    const { stop, last } = listen(receiver);
    await settle();
    expect(last()).toEqual(["n1", "n2"]);

    await receiver.discard("n1");
    await settle();
    expect(last()).toEqual(["n2"]);
    expect([...fake.copies.keys()]).toEqual(["n2"]);
    expect(fake.routines.size).toBe(0);
    stop();
  });

  it("stop being shown at once while the delete waits, and come back when it is refused", async () => {
    const fake = server();
    fake.refuseRemove("n1");
    fake.add(newer("n1"));
    const receiver = createInboxReceiver({ inbox: fake.inbox, routines: fake.store });
    const { stop, shown, last } = listen(receiver);
    await settle();
    const deleting = receiver.discard("n1");
    expect(last()).toEqual([]);
    await expect(deleting).rejects.toMatchObject({ code: "permission-denied" });
    expect(last()).toEqual(["n1"]);
    expect(shown).toContainEqual([]);
    expect(fake.copies.has("n1")).toBe(true);
    stop();
  });

  it("are deleted, and no longer shown, once their sender is blocked", async () => {
    const fake = server();
    fake.add(newer("n1", "mallory"), newer("n2", "alice"));
    const blocked = blockedList([]);
    const receiver = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked });
    const { stop, last } = listen(receiver);
    await settle();
    expect(last()).toEqual(["n1", "n2"]);

    blocked.set(["mallory"]);
    await settle();
    expect([...fake.copies.keys()]).toEqual(["n2"]);
    expect(last()).toEqual(["n2"]);
    expect(fake.events.filter((event) => event === "remove n1")).toHaveLength(1);
    stop();
  });

  it("are shown again after receiving stops and starts, as after a sign-out elsewhere ends", async () => {
    const fake = server();
    fake.add(newer("n1"));
    const receiver = createInboxReceiver({ inbox: fake.inbox, routines: fake.store });
    listen(receiver).stop();
    const again = listen(receiver);
    await settle();
    expect(again.last()).toEqual(["n1"]);
    again.stop();
  });

  it("are shown with the sender's name and photo when the copy has them", async () => {
    const fake = server();
    const photo = "https://lh3.googleusercontent.com/a/alice";
    fake.add({
      id: "n1",
      data: { fromUid: "alice", fromEmail: "a@b.co", fromName: "Alice", fromPhoto: photo },
    });
    let senders: unknown[] = [];
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start(
      (copies) => {
        senders = copies.map(({ sender }) => sender);
      },
    );
    await settle();
    expect(senders).toEqual([{ uid: "alice", name: "Alice", email: "a@b.co", photo }]);
    stop();
  });
});

describe("a copy listed twice in one answer (L64)", () => {
  it("is received once", async () => {
    const fake = server();
    const copy = inboxCopy("c1");
    const inbox: InboxReader = {
      subscribe(onCopies) {
        onCopies([copy, copy]);
        return () => undefined;
      },
      remove: (copyId) => fake.inbox.remove(copyId),
    };
    const stop = createInboxReceiver({ inbox, routines: fake.store }).start();
    await settle();
    expect(fake.events.filter((event) => event === "receive c1")).toHaveLength(1);
    expect([...fake.routines.keys()]).toEqual(["c1"]);
    stop();
  });
});

/** A blocked list the test changes, as the server answers the user's blocked senders. */
function blockedList(initial: string[] | null = []) {
  let current = initial;
  let failure: Error | null = null;
  const listeners = new Set<{
    onData: (items: { uid: string }[]) => void;
    onError: (error: Error) => void;
  }>();
  return {
    subscribeAnswered(onData: (items: { uid: string }[]) => void, onError: (error: Error) => void) {
      const listener = { onData, onError };
      listeners.add(listener);
      if (failure) onError(failure);
      else if (current) onData(current.map((uid) => ({ uid })));
      return () => {
        listeners.delete(listener);
      };
    },
    set(uids: string[]) {
      current = uids;
      listeners.forEach(({ onData }) => {
        onData(uids.map((uid) => ({ uid })));
      });
    },
    fail(error: Error) {
      failure = error;
      listeners.forEach(({ onError }) => {
        onError(error);
      });
    },
    listenerCount: () => listeners.size,
  };
}

const copyFrom = (id: string, fromUid: string): InboxCopy => ({
  id,
  data: { ...(inboxCopy(id).data as object), fromUid },
});

describe("copies from a blocked sender (T27, S7)", () => {
  it("are never received, and are deleted from the inbox; the others are received", async () => {
    const fake = server();
    fake.add(copyFrom("blocked-1", "mallory"), inboxCopy("c1"));
    const blocked = blockedList(["mallory"]);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    await settle();

    expect([...fake.routines.keys()]).toEqual(["c1"]);
    expect(fake.copies.size).toBe(0);
    expect(fake.events).not.toContain("receive blocked-1");
    expect(fake.events).toContain("remove blocked-1");
    stop();
  });

  it("receive nothing until the blocked list is known", async () => {
    const fake = server();
    fake.add(copyFrom("blocked-1", "mallory"), inboxCopy("c1"));
    const blocked = blockedList(null);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    await settle();
    expect(fake.events).toEqual([]);
    expect(fake.copies.size).toBe(2);

    blocked.set(["mallory"]);
    await settle();
    expect([...fake.routines.keys()]).toEqual(["c1"]);
    expect(fake.events).not.toContain("receive blocked-1");
    expect(fake.copies.size).toBe(0);
    stop();
  });

  it("follow the list: a sender blocked later is skipped, one unblocked is received again", async () => {
    const fake = server();
    const blocked = blockedList(["mallory"]);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    blocked.set(["mallory", "alice"]);
    fake.add(copyFrom("from-alice", "alice"));
    await settle();
    expect(fake.routines.size).toBe(0);
    expect(fake.copies.size).toBe(0);

    blocked.set([]);
    fake.add(copyFrom("from-mallory", "mallory"));
    await settle();
    expect([...fake.routines.keys()]).toEqual(["from-mallory"]);
    stop();
  });

  it("stay in the inbox, untouched, when they cannot be deleted, and are not tried again", async () => {
    const fake = server();
    fake.refuseRemove("blocked-1");
    fake.add(copyFrom("blocked-1", "mallory"));
    const blocked = blockedList(["mallory"]);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    await settle();
    fake.report();
    await settle();
    expect(fake.routines.size).toBe(0);
    expect(fake.copies.has("blocked-1")).toBe(true);
    expect(fake.events).toEqual(["remove blocked-1"]);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("blocked sender"),
      "blocked-1",
      expect.objectContaining({ code: "permission-denied" }),
    );
    stop();
  });

  it("hold every copy back when the blocked list cannot be read, and report it", async () => {
    const fake = server();
    fake.add(inboxCopy("c1"));
    const blocked = blockedList(null);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    blocked.fail(failure("permission-denied"));
    await settle();
    fake.report();
    await settle();
    expect(fake.events).toEqual([]);
    expect(fake.copies.has("c1")).toBe(true);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("blocked senders could not be read"),
      expect.objectContaining({ code: "permission-denied" }),
    );
    stop();
  });

  it("stops listening to both lists when stopped", () => {
    const fake = server();
    const blocked = blockedList([]);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    expect(fake.listenerCount()).toBe(1);
    expect(blocked.listenerCount()).toBe(1);
    stop();
    expect(fake.listenerCount()).toBe(0);
    expect(blocked.listenerCount()).toBe(0);
  });
});

describe("which blocked list counts (L69)", () => {
  it("blocks by exact uid only; a copy with an unreadable sender is deleted as unattributable (T29 W5), never as blocked", async () => {
    const fake = server();
    const unreadable: InboxCopy = {
      id: "from-7",
      data: { ...(inboxCopy("x").data as object), fromUid: 7 },
    };
    fake.add(copyFrom("from-alice", "alice"), unreadable);
    const blocked = blockedList(["Alice", "alice ", "7"]);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    await settle();
    fake.report();
    await settle();

    expect([...fake.routines.keys()]).toEqual(["from-alice"]);
    expect(fake.copies.has("from-alice")).toBe(false);
    expect(fake.copies.has("from-7")).toBe(false);
    expect(fake.events.filter((event) => event === "remove from-7")).toHaveLength(1);
    expect(fake.events).not.toContain("receive from-7");
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining("no sender it can name; it is deleted"),
      "from-7",
    );
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining("blocked"), "from-7");
    stop();
  });

  it("receives nothing after the blocked list fails, even after a first answer", async () => {
    const fake = server();
    const blocked = blockedList([]);
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    blocked.fail(failure("unavailable"));
    fake.add(inboxCopy("c1"), copyFrom("from-mallory", "mallory"));
    await settle();
    blocked.set(["mallory"]);
    fake.report();
    await settle();

    expect(fake.events).toEqual([]);
    expect(fake.copies.size).toBe(2);
    stop();
  });

  it("waits for a list the server answered: one only from this device's outbox or cache never starts receiving (A1)", async () => {
    const fake = server();
    fake.add(copyFrom("from-mallory", "mallory"), inboxCopy("c1"));
    // Blocked on another device: the server knows; this device's outbox and cache do not yet.
    const answered = blockedList(null);
    const local = blockedList([]);
    type Subscribe = ReturnType<typeof blockedList>["subscribeAnswered"];
    const blocked = {
      subscribe: (...args: Parameters<Subscribe>) => local.subscribeAnswered(...args),
      subscribeAnswered: (...args: Parameters<Subscribe>) => answered.subscribeAnswered(...args),
    };
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store, blocked }).start();
    await settle();
    expect(fake.events).toEqual([]);
    expect(fake.copies.size).toBe(2);

    answered.set(["mallory"]);
    await settle();
    expect([...fake.routines.keys()]).toEqual(["c1"]);
    expect(fake.events).not.toContain("receive from-mallory");
    expect(fake.copies.size).toBe(0);
    stop();
  });
});
