import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { browserConnectivity } from "./browserConnectivity";

describe("browserConnectivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is online, and settles at once, while the browser says so", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(browserConnectivity.isOnline()).toBe(true);
    await expect(browserConnectivity.whenOnline()).resolves.toBeUndefined();
  });

  it("while offline, settles only on the browser's 'online' event", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(browserConnectivity.isOnline()).toBe(false);
    let settled = false;
    void browserConnectivity.whenOnline().then(() => {
      settled = true;
    });
    await Promise.resolve();
    window.dispatchEvent(new Event("offline"));
    await Promise.resolve();
    expect(settled).toBe(false);
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(settled).toBe(true);
  });
});
