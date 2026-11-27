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

  it("leaves a malformed copy untouched, reports it, and still receives the others", async () => {
    const fake = server();
    fake.add(
      { id: "newer", data: { ...(inboxCopy("x").data as object), version: 2 } },
      { id: "broken", data: "not a copy" },
      inboxCopy("good"),
    );
    const stop = createInboxReceiver({ inbox: fake.inbox, routines: fake.store }).start();
    await settle();
    fake.report();
    await settle();

    expect([...fake.routines.keys()]).toEqual(["good"]);
    expect([...fake.copies.keys()].sort()).toEqual(["broken", "newer"]);
    expect(fake.events).toEqual(["receive good", "stored good", "remove good"]);
    // Reported once each, by id only: the developer's log never holds what the copy says.
    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("cannot be received"), "newer");
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("cannot be received"), "broken");
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
