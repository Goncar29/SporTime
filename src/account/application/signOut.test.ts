import { describe, expect, it, vi } from "vite-plus/test";
import type { OtherTabsGate, SendResult } from "./ports";
import { signOut } from "./signOut";

function setup({ sent = "sent" as SendResult } = {}) {
  const calls: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      calls.push(name);
      return Promise.resolve();
    });
  const auth = { signOut: step("signOut") };
  const local = {
    sendPending: vi.fn(() => {
      calls.push("sendPending");
      return Promise.resolve(sent);
    }),
    discardPending: vi.fn(() => {
      calls.push("discardPending");
    }),
    erase: step("erase"),
  };
  return { auth, local, calls };
}

describe("signOut", () => {
  it("sends what is pending, then signs out, then erases this device's copy", async () => {
    const { auth, local, calls } = setup();
    await expect(signOut({ auth, local })).resolves.toBe("signedOut");
    expect(calls).toEqual(["sendPending", "signOut", "erase"]);
  });

  it("keeps the session and the pending changes when they could not be sent", async () => {
    const { auth, local, calls } = setup({ sent: "unsent" });
    await expect(signOut({ auth, local })).resolves.toBe("unsent");
    expect(calls).toEqual(["sendPending"]);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(local.discardPending).not.toHaveBeenCalled();
    expect(local.erase).not.toHaveBeenCalled();
  });

  it("when forced, signs out without sending, then drops the pending changes and erases", async () => {
    const { auth, local, calls } = setup({ sent: "unsent" });
    await expect(signOut({ auth, local }, { force: true })).resolves.toBe("signedOut");
    expect(calls).toEqual(["signOut", "discardPending", "erase"]);
    expect(local.sendPending).not.toHaveBeenCalled();
  });

  it("when forced and the provider refuses, keeps the pending changes", async () => {
    const { auth, local } = setup({ sent: "unsent" });
    auth.signOut.mockRejectedValueOnce(new Error("network"));
    await expect(signOut({ auth, local }, { force: true })).rejects.toThrow("network");
    expect(local.discardPending).not.toHaveBeenCalled();
    expect(local.erase).not.toHaveBeenCalled();
  });

  it("still reports signed out when erasing fails, since the session is already gone", async () => {
    const { auth, local } = setup();
    local.erase.mockRejectedValueOnce(new Error("another tab holds the cache"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(signOut({ auth, local })).resolves.toBe("signedOut");
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(local.erase).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  describe("with other tabs of the account open", () => {
    /** Holds the other tabs' changes while the work runs, or gives up when they never let go. */
    const holdingOff = (calls: string[], granted = true): OtherTabsGate => ({
      holdOff<T>(work: () => Promise<T>) {
        if (!granted) return Promise.resolve(null);
        calls.push("holdOff");
        return work().then((value) => {
          calls.push("letGo");
          return { value };
        });
      },
    });

    it("holds their changes off from sending until erasing ends", async () => {
      const { auth, local, calls } = setup();
      const otherTabs = holdingOff(calls);
      await expect(signOut({ auth, local, otherTabs })).resolves.toBe("signedOut");
      expect(calls).toEqual(["holdOff", "sendPending", "signOut", "erase", "letGo"]);
    });

    it("also lets them go when the changes could not be sent", async () => {
      const { auth, local, calls } = setup({ sent: "unsent" });
      const otherTabs = holdingOff(calls);
      await expect(signOut({ auth, local, otherTabs })).resolves.toBe("unsent");
      expect(calls).toEqual(["holdOff", "sendPending", "letGo"]);
    });

    it("reports unsent and touches nothing when a change in another tab does not finish in time", async () => {
      const { auth, local, calls } = setup();
      const otherTabs = holdingOff(calls, false);
      await expect(signOut({ auth, local, otherTabs })).resolves.toBe("unsent");
      expect(calls).toEqual([]);
    });

    it("when forced, signs out anyway even if another tab does not let go", async () => {
      const { auth, local, calls } = setup({ sent: "unsent" });
      const otherTabs = holdingOff(calls, false);
      await expect(signOut({ auth, local, otherTabs }, { force: true })).resolves.toBe("signedOut");
      expect(calls).toEqual(["signOut", "discardPending", "erase"]);
    });
  });

  it("erases nothing when the provider refuses to sign out", async () => {
    const { auth, local } = setup();
    auth.signOut.mockRejectedValueOnce(new Error("network"));
    await expect(signOut({ auth, local })).rejects.toThrow("network");
    expect(local.erase).not.toHaveBeenCalled();
  });
});
