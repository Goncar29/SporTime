import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { withOutbox, type Pending } from "../application/outbox";
import { createLocalStorageOutboxStore } from "./localStorageOutboxStore";

describe("createLocalStorageOutboxStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const item = { id: "a", draft: { order: 1 } };

  it("survives a new page load", () => {
    createLocalStorageOutboxStore("key").save([item]);
    expect(createLocalStorageOutboxStore("key").load()).toEqual([item]);
  });

  it("keeps each key apart", () => {
    createLocalStorageOutboxStore("alice").save([item]);
    expect(createLocalStorageOutboxStore("bob").load()).toEqual([]);
  });

  it("removes the key when nothing is pending", () => {
    const store = createLocalStorageOutboxStore("key");
    store.save([item]);
    store.save([]);
    expect(localStorage.getItem("key")).toBeNull();
  });

  it("treats corrupted data as empty", () => {
    localStorage.setItem("key", "{nope");
    expect(createLocalStorageOutboxStore("key").load()).toEqual([]);
    localStorage.setItem("key", JSON.stringify([{ id: 7 }, "x", item]));
    expect(createLocalStorageOutboxStore("key").load()).toEqual([item]);
  });

  it("still works for this page when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createLocalStorageOutboxStore("key");
    store.save([item]);
    expect(store.load()).toEqual([item]);
  });

  it("still works for this page when storage is blocked, one write at a time", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createLocalStorageOutboxStore("key");
    store.put?.(item);
    store.put?.({ id: "b", draft: { order: 2 } });
    store.remove?.("a");
    expect(store.load()).toEqual([{ id: "b", draft: { order: 2 } }]);
  });

  const key = "sportime.outbox.workouts.u1";
  const sorted = (items: Pending<unknown>[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));

  it("reads what the previous version stored, and changes it one write at a time", () => {
    localStorage.setItem(key, JSON.stringify([item, { id: "b", draft: { order: 2 } }]));
    const store = createLocalStorageOutboxStore(key);

    store.put?.({ id: "b", draft: { order: 5 } });
    store.put?.({ id: "c", draft: { order: 3 } });
    store.remove?.("a");

    expect(sorted(createLocalStorageOutboxStore(key).load())).toEqual([
      { id: "b", draft: { order: 5 } },
      { id: "c", draft: { order: 3 } },
    ]);
  });

  it("discards everything the account holds, however it was stored", () => {
    localStorage.setItem(key, JSON.stringify([item]));
    localStorage.setItem("sportime.language", "en");
    const store = createLocalStorageOutboxStore(key);
    store.put?.({ id: "b", draft: { order: 2 } });

    store.save([]);

    expect(createLocalStorageOutboxStore(key).load()).toEqual([]);
    expect(Object.keys(localStorage)).toEqual(["sportime.language"]);
  });

  it("still replaces everything it holds when saving a whole list", () => {
    const store = createLocalStorageOutboxStore(key);
    store.put?.({ id: "b", draft: { order: 2 } });
    store.save([item]);
    expect(createLocalStorageOutboxStore(key).load()).toEqual([item]);
  });

  it("keeps every key of an account findable by the account's id", () => {
    const store = createLocalStorageOutboxStore(key);
    store.save([item]);
    store.put?.({ id: "b", draft: { order: 2 } });
    const keys = Object.keys(localStorage);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((name) => name.startsWith("sportime.outbox.") && name.endsWith(".u1"))).toBe(
      true,
    );
  });

  it("keeps apart accounts whose ids start alike", () => {
    createLocalStorageOutboxStore("sportime.outbox.workouts.u1").put?.(item);
    expect(createLocalStorageOutboxStore("sportime.outbox.workouts.u12").load()).toEqual([]);
    createLocalStorageOutboxStore("sportime.outbox.workouts.u12").save([]);
    expect(createLocalStorageOutboxStore("sportime.outbox.workouts.u1").load()).toEqual([item]);
  });

  describe("two tabs changing it at once", () => {
    /** What a tab reads from storage at this moment. */
    function storageNow() {
      const names = Array.from(
        { length: localStorage.length },
        (_, index) => localStorage.key(index) ?? "",
      );
      return new Map(names.map((name) => [name, localStorage.getItem(name)]));
    }

    /**
     * A browser hands one tab's storage changes to its other tabs a moment later, so a tab can
     * still read storage as it was. Until the returned function is called, reads answer from `seen`.
     */
    function readAsBefore(seen: Map<string, string | null>) {
      const names = [...seen.keys()];
      const spies = [
        vi.spyOn(Storage.prototype, "getItem").mockImplementation((name) => seen.get(name) ?? null),
        vi.spyOn(Storage.prototype, "key").mockImplementation((index) => names[index] ?? null),
        vi.spyOn(Storage.prototype, "length", "get").mockReturnValue(names.length),
      ];
      return () => {
        spies.forEach((spy) => {
          spy.mockRestore();
        });
      };
    }

    interface Item {
      id: string;
      order: number;
    }
    type Draft = Omit<Item, "id">;

    let ids = 0;
    function openTab(whenReady: () => Promise<boolean> = () => new Promise(() => undefined)) {
      const stored = new Map<string, Draft>();
      const outbox = withOutbox<Item, Draft>({
        collection: {
          subscribe: () => () => undefined,
          newId: () => `id-${++ids}`,
          put: (id, draft) => {
            stored.set(id, draft);
            return Promise.resolve();
          },
          has: (id) => Promise.resolve(stored.has(id)),
        },
        store: createLocalStorageOutboxStore<Draft>(key),
        parse: (id, draft) => ({ id, ...(draft as Draft) }),
        newestFirst: (a, b) => b.order - a.order,
        whenReady,
      });
      return { outbox, stored };
    }

    const pendingOrders = () =>
      createLocalStorageOutboxStore<Draft>(key)
        .load()
        .map(({ draft }) => draft.order)
        .sort((a, b) => a - b);

    it("still keeps, revises and forgets a tab's writes across a page load", () => {
      const { outbox } = openTab();
      void outbox.add({ order: 1 });
      void outbox.add({ order: 2 });
      const [first, second] = createLocalStorageOutboxStore<Draft>(key).load();
      outbox.revise(first?.id ?? "", { order: 5 });
      outbox.cancel(second?.id ?? "");
      expect(pendingOrders()).toEqual([5]);
    });

    it("keeps both writes when both tabs add one", () => {
      const tabA = openTab();
      const tabB = openTab();
      const seenByB = storageNow();
      void tabA.outbox.add({ order: 1 });

      const caughtUp = readAsBefore(seenByB);
      void tabB.outbox.add({ order: 2 });
      caughtUp();

      expect(pendingOrders()).toEqual([1, 2]);
    });

    it("keeps an edit in one tab while the other adds a write", () => {
      const tabA = openTab();
      const tabB = openTab();
      void tabA.outbox.add({ order: 1 });
      const id = createLocalStorageOutboxStore(key).load()[0]?.id ?? "";
      const seenByA = storageNow();
      void tabB.outbox.add({ order: 2 });

      const caughtUp = readAsBefore(seenByA);
      expect(tabA.outbox.revise(id, { order: 5 })).toBe(true);
      caughtUp();

      expect(pendingOrders()).toEqual([2, 5]);
    });

    it("keeps a write added in one tab while the other finishes sending its own", async () => {
      let ready: (value: boolean) => void = () => undefined;
      const tabA = openTab(() => new Promise((resolve) => (ready = resolve)));
      const tabB = openTab();
      void tabA.outbox.add({ order: 1 });
      // Tab A now waits for its account before sending.
      await new Promise((resolve) => setTimeout(resolve));
      const seenByA = storageNow();
      void tabB.outbox.add({ order: 2 });

      const caughtUp = readAsBefore(seenByA);
      ready(true);
      await new Promise((resolve) => setTimeout(resolve));
      caughtUp();

      expect([...tabA.stored.values()]).toEqual([{ order: 1 }]);
      expect(pendingOrders()).toEqual([2]);
    });
  });
});
