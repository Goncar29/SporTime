import { describe, expect, it, vi } from "vite-plus/test";
import { deleteAccount } from "./deleteAccount";

function setup({ recent = true } = {}) {
  const calls: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      calls.push(name);
      return Promise.resolve();
    });
  const identity = {
    isRecentlyConfirmed: vi.fn(() => Promise.resolve(recent)),
    confirm: step("confirm"),
    remove: step("remove"),
  };
  const data = { erase: step("erase"), clearDevice: step("clearDevice") };
  return { identity, data, calls };
}

describe("deleteAccount", () => {
  it("erases the data, then the account, then this device's copy", async () => {
    const { identity, data, calls } = setup();
    await deleteAccount({ identity, data });
    expect(calls).toEqual(["erase", "remove", "clearDevice"]);
  });

  it("confirms an old sign-in before touching anything", async () => {
    const { identity, data, calls } = setup({ recent: false });
    await deleteAccount({ identity, data });
    expect(calls).toEqual(["confirm", "erase", "remove", "clearDevice"]);
  });

  it("erases nothing when the confirmation fails or is cancelled", async () => {
    const { identity, data } = setup({ recent: false });
    identity.confirm.mockRejectedValueOnce(new Error("cancelled"));
    await expect(deleteAccount({ identity, data })).rejects.toThrow("cancelled");
    expect(data.erase).not.toHaveBeenCalled();
    expect(identity.remove).not.toHaveBeenCalled();
  });

  it("keeps the account when erasing fails, so the user can retry", async () => {
    const { identity, data } = setup();
    data.erase.mockRejectedValueOnce(new Error("offline"));
    await expect(deleteAccount({ identity, data })).rejects.toThrow("offline");
    expect(identity.remove).not.toHaveBeenCalled();
    expect(data.clearDevice).not.toHaveBeenCalled();
  });

  it("reports a failed account removal and keeps this device's copy", async () => {
    const { identity, data } = setup();
    identity.remove.mockRejectedValueOnce(new Error("denied"));
    await expect(deleteAccount({ identity, data })).rejects.toThrow("denied");
    expect(data.clearDevice).not.toHaveBeenCalled();
  });

  it("still succeeds when clearing this device fails: the account is already gone", async () => {
    const { identity, data } = setup();
    data.clearDevice.mockRejectedValueOnce(new Error("another tab is open"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(deleteAccount({ identity, data })).resolves.toBeUndefined();
    consoleError.mockRestore();
  });
});
