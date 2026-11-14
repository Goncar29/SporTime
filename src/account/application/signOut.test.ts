import { describe, expect, it, vi } from "vite-plus/test";
import type { SendResult } from "./ports";
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

  it("when forced, drops the pending changes without sending them, then signs out and erases", async () => {
    const { auth, local, calls } = setup({ sent: "unsent" });
    await expect(signOut({ auth, local }, { force: true })).resolves.toBe("signedOut");
    expect(calls).toEqual(["discardPending", "signOut", "erase"]);
    expect(local.sendPending).not.toHaveBeenCalled();
  });

  it("erases nothing when the provider refuses to sign out", async () => {
    const { auth, local } = setup();
    auth.signOut.mockRejectedValueOnce(new Error("network"));
    await expect(signOut({ auth, local })).rejects.toThrow("network");
    expect(local.erase).not.toHaveBeenCalled();
  });
});
