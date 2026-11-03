import { describe, expect, it, vi } from "vite-plus/test";
import { AuthFailure } from "../../auth/domain/user";
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
  const data = { erase: step("erase") };
  return { identity, data, calls };
}

describe("deleteAccount", () => {
  it("erases the data, then the account", async () => {
    const { identity, data, calls } = setup();
    await deleteAccount({ identity, data });
    expect(calls).toEqual(["erase", "remove"]);
  });

  it("confirms an old sign-in before touching anything", async () => {
    const { identity, data, calls } = setup({ recent: false });
    await deleteAccount({ identity, data });
    expect(calls).toEqual(["confirm", "erase", "remove"]);
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
  });

  it("reports a failed account removal", async () => {
    const { identity, data } = setup();
    identity.remove.mockRejectedValueOnce(new Error("denied"));
    await expect(deleteAccount({ identity, data })).rejects.toThrow("denied");
    expect(identity.confirm).not.toHaveBeenCalled();
  });

  it("asks again when the provider says the sign-in is too old, then finishes", async () => {
    const { identity, data, calls } = setup();
    identity.remove.mockRejectedValueOnce(new AuthFailure("staleSignIn"));
    await deleteAccount({ identity, data });
    expect(calls).toEqual(["erase", "confirm", "remove"]);
    expect(identity.remove).toHaveBeenCalledTimes(2);
  });

  it("gives up when the provider refuses again after asking", async () => {
    const { identity, data } = setup();
    identity.remove.mockRejectedValue(new AuthFailure("staleSignIn"));
    await expect(deleteAccount({ identity, data })).rejects.toThrow();
    expect(identity.confirm).toHaveBeenCalledOnce();
    expect(identity.remove).toHaveBeenCalledTimes(2);
  });
});
