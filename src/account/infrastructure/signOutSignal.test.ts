import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createSignOutSignal } from "./signOutSignal";

/** What another tab receives when this one writes to the shared storage. */
function deliverToOtherTabs(changedKey: string | null = localStorage.key(0)) {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: changedKey,
      newValue: changedKey === null ? null : localStorage.getItem(changedKey),
    }),
  );
}

describe("sign-out signal", () => {
  const unsubscribes: (() => void)[] = [];
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
  });

  const listen = () => {
    const listener = vi.fn();
    unsubscribes.push(createSignOutSignal().subscribe(listener));
    return listener;
  };

  it("tells other tabs once when this one signs out, but not this tab itself", () => {
    const listener = listen();
    createSignOutSignal().announce();
    // The browser never sends a tab its own storage changes.
    expect(listener).not.toHaveBeenCalled();
    deliverToOtherTabs();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("makes every sign-out a change, so a second one also reaches other tabs", () => {
    const signal = createSignOutSignal();
    signal.announce();
    const first = localStorage.getItem(localStorage.key(0) ?? "");
    signal.announce();
    expect(localStorage.getItem(localStorage.key(0) ?? "")).not.toBe(first);
  });

  it("ignores other storage changes, and the whole storage being cleared", () => {
    const listener = listen();
    localStorage.setItem("sportime.language", "es");
    deliverToOtherTabs("sportime.language");
    deliverToOtherTabs(null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops telling once unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = createSignOutSignal().subscribe(listener);
    createSignOutSignal().announce();
    unsubscribe();
    deliverToOtherTabs();
    expect(listener).not.toHaveBeenCalled();
  });
});
