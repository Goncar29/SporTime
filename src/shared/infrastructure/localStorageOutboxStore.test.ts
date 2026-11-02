import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
});
