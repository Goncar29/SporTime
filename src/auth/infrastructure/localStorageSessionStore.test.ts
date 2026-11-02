import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { localStorageSessionStore as store } from "./localStorageSessionStore";

const carlos = { id: "u1", name: "Carlos", email: "c@example.com", photoUrl: null };

describe("localStorageSessionStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns what it saved, until cleared", () => {
    store.set(carlos);
    expect(store.get()).toEqual(carlos);
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("ignores corrupted data", () => {
    localStorage.setItem("sportime.session", "{not json");
    expect(store.get()).toBeNull();
    localStorage.setItem("sportime.session", JSON.stringify({ id: 1, name: "x" }));
    expect(store.get()).toBeNull();
    localStorage.setItem("sportime.session", "null");
    expect(store.get()).toBeNull();
  });

  it("keeps working when storage is blocked", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const spies = [
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked),
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked),
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked),
    ];
    expect(store.get()).toBeNull();
    expect(() => {
      store.set(carlos);
      store.clear();
    }).not.toThrow();
    spies.forEach((spy) => {
      spy.mockRestore();
    });
  });
});
