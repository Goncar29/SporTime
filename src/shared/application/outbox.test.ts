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
});
