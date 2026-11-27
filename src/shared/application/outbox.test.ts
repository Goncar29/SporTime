// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { withOutbox, type DurableCollection, type OutboxStore, type Pending } from "./outbox";

interface Item {
  id: string;
  order: number;
}
type Draft = Omit<Item, "id">;

function memoryStore(initial: Pending<Draft>[] = []): OutboxStore<Draft> {
  let items = initial;
  return {
    load: () => items,
    save(next) {
      items = next;
    },
  };
}

function fakeCollection() {
  const stored = new Map<string, Draft>();
  let report: ((items: Item[]) => void) | undefined;
  const announce = () => {
    report?.([...stored].map(([id, draft]) => ({ id, ...draft })));
  };
  const collection: DurableCollection<Item, Draft> = {
    subscribe(onData) {
      report = onData;
      return () => {
        report = undefined;
      };
    },
    newId: () => `id-${stored.size}-${Math.random()}`,
    put: vi.fn((id: string, draft: Draft) => {
      stored.set(id, draft);
      announce();
      return Promise.resolve();
    }),
    has: (id) => Promise.resolve(stored.has(id)),
  };
  return { collection, stored, announce };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const parse = (id: string, draft: unknown): Item | null => {
  const order = (draft as Partial<Draft> | null)?.order;
  return typeof order === "number" ? { id, order } : null;
};

function setup({
  store = memoryStore(),
  whenReady = () => Promise.resolve(true),
  fake = fakeCollection(),
} = {}) {
  const outbox = withOutbox<Item, Draft>({
    collection: fake.collection,
    store,
    parse,
    newestFirst: (a, b) => b.order - a.order,
    whenReady,
  });
  return { outbox, store, fake };
}

const flushed = () => new Promise((resolve) => setTimeout(resolve));

describe("withOutbox", () => {
  it("keeps a write durable and visible while the account is not ready", async () => {
    const ready = deferred<boolean>();
    const { outbox, store, fake } = setup({ whenReady: () => ready.promise });
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn());

    void outbox.add({ order: 1 });

    expect(onData).toHaveBeenLastCalledWith([expect.objectContaining({ order: 1 })]);
    expect(store.load()).toHaveLength(1);
    await flushed();
    expect(fake.collection.put).not.toHaveBeenCalled();
  });

  it("writes once the account is ready, then empties the outbox", async () => {
    const { outbox, store, fake } = setup();
    await outbox.add({ order: 1 });
    await flushed();
    expect(fake.stored.size).toBe(1);
    expect(store.load()).toEqual([]);
  });

  it("writes under the id given, when the item has its own", async () => {
    const { outbox, fake } = setup();
    await outbox.add({ order: 1 }, "own-id");
    expect(fake.collection.put).toHaveBeenCalledWith("own-id", { order: 1 });
    expect([...fake.stored.keys()]).toEqual(["own-id"]);
  });

  it("asks the collection for every item when not asked for a number, as history and contacts do", () => {
    const { outbox, fake } = setup();
    const subscribe = vi.spyOn(fake.collection, "subscribe");
    outbox.subscribe(vi.fn(), vi.fn());
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), undefined);
  });

  it("passes on how many of the newest to read, and still shows every held write (T38)", () => {
    const ready = deferred<boolean>();
    const { outbox, fake } = setup({
      store: memoryStore([
        { id: "held-1", draft: { order: 10 } },
        { id: "held-2", draft: { order: 11 } },
      ]),
      whenReady: () => ready.promise,
    });
    const subscribe = vi.spyOn(fake.collection, "subscribe");
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn(), 1);
    expect(subscribe).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), 1);
    expect(onData).toHaveBeenLastCalledWith([
      { id: "held-2", order: 11 },
      { id: "held-1", order: 10 },
    ]);
  });

  it("does not show an item twice while it moves to the collection", async () => {
    const { outbox, fake } = setup();
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn());
    await outbox.add({ order: 1 });
    await flushed();
    fake.announce();
    expect(onData).toHaveBeenLastCalledWith([expect.objectContaining({ order: 1 })]);
  });

  it("sends what a previous page load left behind", async () => {
    const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
    const { fake } = setup({ store });
    await flushed();
    expect(fake.stored.get("left")).toEqual({ order: 1 });
    expect(store.load()).toEqual([]);
  });

  it("does not write again what already reached the collection before a reload", async () => {
    const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
    const fake = fakeCollection();
    fake.stored.set("left", { order: 1 });
    setup({ store, fake });
    await flushed();
    expect(fake.collection.put).not.toHaveBeenCalled();
    expect(store.load()).toEqual([]);
  });

  it("holds writes for a different account until that account is back", async () => {
    const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
    const { fake } = setup({ store, whenReady: () => Promise.resolve(false) });
    await flushed();
    expect(fake.collection.put).not.toHaveBeenCalled();
    expect(store.load()).toHaveLength(1);
  });

  it("keeps the write when the local cache fails, for the next load", async () => {
    const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
    const fake = fakeCollection();
    fake.collection.has = () => Promise.reject(new Error("cache broken"));
    setup({ store, fake });
    await flushed();
    expect(store.load()).toHaveLength(1);
  });

  it("rejects the write when the server refuses it, and forgets it", async () => {
    const fake = fakeCollection();
    fake.collection.put = () => Promise.reject(new Error("denied"));
    fake.collection.has = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const { outbox, store } = setup({ fake });
    await expect(outbox.add({ order: 1 })).rejects.toThrow("denied");
    await flushed();
    expect(store.load()).toEqual([]);
  });

  it("reports nothing until it knows something, so an empty list is never a guess", () => {
    const { outbox } = setup({ whenReady: () => new Promise(() => undefined) });
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn());
    expect(onData).not.toHaveBeenCalled();
  });

  it("ignores a stored draft it cannot read", () => {
    const store = memoryStore([{ id: "bad", draft: { nope: true } as unknown as Draft }]);
    const { outbox } = setup({ store, whenReady: () => new Promise(() => undefined) });
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn());
    expect(onData).not.toHaveBeenCalled();
  });

  it("does not send a write cancelled while waiting for the account", async () => {
    const ready = deferred<boolean>();
    const { outbox, store, fake } = setup({ whenReady: () => ready.promise });
    void outbox.add({ order: 1 });
    await flushed();
    outbox.cancel(store.load()[0]?.id ?? "");

    ready.resolve(true);
    await flushed();

    expect(fake.collection.put).not.toHaveBeenCalled();
    expect(fake.stored.size).toBe(0);
  });

  it("forgets a write that is cancelled before it was sent", async () => {
    const { outbox, store, fake } = setup({ whenReady: () => new Promise(() => undefined) });
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn());
    void outbox.add({ order: 1 });
    const id = store.load()[0]?.id ?? "";

    outbox.cancel(id);

    expect(store.load()).toEqual([]);
    expect(onData).toHaveBeenLastCalledWith([]);
    expect(fake.collection.put).not.toHaveBeenCalled();
  });

  it("sends the edited version of a write still waiting for the account", async () => {
    const ready = deferred<boolean>();
    const { outbox, store, fake } = setup({ whenReady: () => ready.promise });
    const onData = vi.fn();
    outbox.subscribe(onData, vi.fn());
    void outbox.add({ order: 1 });
    const id = store.load()[0]?.id ?? "";

    expect(outbox.revise(id, { order: 5 })).toBe(true);
    expect(onData).toHaveBeenLastCalledWith([{ id, order: 5 }]);

    ready.resolve(true);
    await flushed();
    expect(fake.stored.get(id)).toEqual({ order: 5 });
    expect(fake.collection.put).toHaveBeenCalledOnce();
  });

  it("leaves alone a write it does not hold", () => {
    const { outbox, store } = setup({ whenReady: () => new Promise(() => undefined) });
    void outbox.add({ order: 1 });
    expect(outbox.revise("someone-else", { order: 5 })).toBe(false);
    expect(store.load().map(({ draft }) => draft)).toEqual([{ order: 1 }]);
  });

  describe("flushNow", () => {
    it("hands every held write to the collection and reports none left", async () => {
      const store = memoryStore([
        { id: "a", draft: { order: 1 } },
        { id: "b", draft: { order: 2 } },
      ]);
      const { outbox, fake } = setup({ store });

      await expect(outbox.flushNow()).resolves.toBe(0);

      expect(fake.stored.get("a")).toEqual({ order: 1 });
      expect(fake.stored.get("b")).toEqual({ order: 2 });
      expect(store.load()).toEqual([]);
    });

    it("reports what it still holds when the account is not ready", async () => {
      const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
      const { outbox, fake } = setup({ store, whenReady: () => Promise.resolve(false) });

      await expect(outbox.flushNow()).resolves.toBe(1);

      expect(fake.collection.put).not.toHaveBeenCalled();
      expect(store.load()).toHaveLength(1);
    });

    it("reports a write the local cache could not take", async () => {
      const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
      const fake = fakeCollection();
      fake.collection.has = () => Promise.reject(new Error("cache broken"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { outbox } = setup({ store, fake });

      await expect(outbox.flushNow()).resolves.toBe(1);

      expect(store.load()).toHaveLength(1);
    });

    it("reports nothing held when there was nothing to send", async () => {
      const { outbox, fake } = setup();
      await expect(outbox.flushNow()).resolves.toBe(0);
      expect(fake.collection.put).not.toHaveBeenCalled();
    });
  });

  it("sends the edited version when the edit lands while the write is being checked", async () => {
    const fake = fakeCollection();
    const check = deferred<boolean>();
    const has = fake.collection.has;
    let held = true;
    fake.collection.has = (id) => (held ? ((held = false), check.promise) : has(id));
    const { outbox, store } = setup({ fake });
    void outbox.add({ order: 1 });
    await flushed();
    const id = store.load()[0]?.id ?? "";

    outbox.revise(id, { order: 5 });
    check.resolve(false);
    await flushed();

    expect(fake.collection.put).toHaveBeenCalledWith(id, { order: 5 });
    expect(fake.stored.get(id)).toEqual({ order: 5 });
  });

  /** A collection whose next check of the local cache waits until the test answers it. */
  function heldCheck(fake = fakeCollection()) {
    const check = deferred<boolean>();
    const has = fake.collection.has;
    let calls = 0;
    const holdOn = { call: 1 };
    fake.collection.has = (id) => (++calls === holdOn.call ? check.promise : has(id));
    return { fake, check, holdOn };
  }

  describe("a write removed while it is being checked", () => {
    it("is never written after it was deleted", async () => {
      const { fake, check } = heldCheck();
      const { outbox, store } = setup({ fake });
      void outbox.add({ order: 1 });
      await flushed();
      const id = store.load()[0]?.id ?? "";

      outbox.cancel(id);
      check.resolve(false);
      await flushed();

      expect(fake.collection.put).not.toHaveBeenCalled();
      expect(fake.stored.has(id)).toBe(false);
    });

    it("is never written after the account's pending writes were discarded", async () => {
      const { fake, check } = heldCheck();
      const store = memoryStore([{ id: "left", draft: { order: 1 } }]);
      setup({ store, fake });
      await flushed();

      store.save([]);
      check.resolve(false);
      await flushed();

      expect(fake.collection.put).not.toHaveBeenCalled();
      expect(fake.stored.has("left")).toBe(false);
    });

    it("still answers a save that another tab sent meanwhile", async () => {
      const { fake, check } = heldCheck();
      const { outbox, store } = setup({ fake });
      const saved = outbox.add({ order: 1 });
      await flushed();
      const id = store.load()[0]?.id ?? "";

      // Another tab sharing this storage sent it and dropped it.
      fake.stored.set(id, { order: 1 });
      store.save([]);
      check.resolve(false);

      await expect(saved).resolves.toBeUndefined();
      expect(fake.stored.get(id)).toEqual({ order: 1 });
    });
  });

  it("keeps an edit made while the older version is being confirmed, and sends it", async () => {
    const { fake, check, holdOn } = heldCheck();
    holdOn.call = 2;
    const { outbox, store } = setup({ fake });
    void outbox.add({ order: 1 });
    await flushed();
    const id = store.load()[0]?.id ?? "";
    expect(fake.collection.put).toHaveBeenCalledWith(id, { order: 1 });

    // Another tab revises it after the older version was handed over, before it was dropped.
    expect(outbox.revise(id, { order: 5 })).toBe(true);
    check.resolve(true);
    await flushed();

    expect(fake.stored.get(id)).toEqual({ order: 5 });
    expect(fake.collection.put).toHaveBeenLastCalledWith(id, { order: 5 });
    expect(store.load()).toEqual([]);
  });

  it("drops a write once the version sent is the one it holds", async () => {
    const { outbox, store, fake } = setup();
    await outbox.add({ order: 1 });
    await flushed();
    expect(fake.collection.put).toHaveBeenCalledOnce();
    expect(store.load()).toEqual([]);
  });
});
