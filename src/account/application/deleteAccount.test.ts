// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthFailure } from "../../auth/domain/user";
import { createAccountLock } from "../infrastructure/accountLock";
import { createFakeLockManager } from "../infrastructure/fakeLockManager";
import { SignedOutElsewhere, createOtherTabs } from "../infrastructure/otherTabs";
import { ChangeInAnotherTab, deleteAccount } from "./deleteAccount";
import type { AccountEnding, OtherTabsGate } from "./ports";

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
    confirmedByRedirect: vi.fn(() => Promise.resolve(false)),
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
    await expect(deleteAccount({ identity, data })).rejects.toMatchObject({ kind: "dataErased" });
    expect(identity.confirm).toHaveBeenCalledOnce();
    expect(identity.remove).toHaveBeenCalledTimes(2);
  });

  it.each(["cancelled", "wrongAccount"] as const)(
    "says the data is already erased when the confirmation after erasing ends as %s",
    async (kind) => {
      const { identity, data } = setup();
      identity.remove.mockRejectedValueOnce(new AuthFailure("staleSignIn"));
      identity.confirm.mockRejectedValueOnce(new AuthFailure(kind));
      await expect(deleteAccount({ identity, data })).rejects.toMatchObject({ kind: "dataErased" });
      expect(data.erase).toHaveBeenCalledOnce();
      expect(identity.remove).toHaveBeenCalledOnce();
    },
  );

  it("keeps a connection failure during the confirmation after erasing as it is", async () => {
    const { identity, data } = setup();
    identity.remove.mockRejectedValueOnce(new AuthFailure("staleSignIn"));
    identity.confirm.mockRejectedValueOnce(new AuthFailure("network"));
    await expect(deleteAccount({ identity, data })).rejects.toMatchObject({ kind: "network" });
  });

  describe("with other tabs of the account open", () => {
    /** Holds the other tabs' changes while the work runs, or gives up when they never let go. */
    const holdingOff = (calls: string[], granted = true): OtherTabsGate => ({
      holdOff<T>(work: () => Promise<T>) {
        if (!granted) return Promise.resolve(null);
        calls.push("holdOff");
        return work().then(
          (value) => {
            calls.push("letGo");
            return { value };
          },
          (error: unknown) => {
            calls.push("letGo");
            throw error;
          },
        );
      },
      changeWaitingHere: () => false,
    });

    it("holds every change off from erasing until the account is removed", async () => {
      const { identity, data, calls } = setup();
      await deleteAccount({ identity, data, otherTabs: holdingOff(calls) });
      expect(calls).toEqual(["holdOff", "erase", "remove", "letGo"]);
    });

    it("confirms an old sign-in before holding anything off", async () => {
      const { identity, data, calls } = setup({ recent: false });
      await deleteAccount({ identity, data, otherTabs: holdingOff(calls) });
      expect(calls).toEqual(["confirm", "holdOff", "erase", "remove", "letGo"]);
    });

    it("also lets them go when erasing fails", async () => {
      const { identity, data, calls } = setup();
      data.erase.mockRejectedValueOnce(new AuthFailure("network"));
      await expect(
        deleteAccount({ identity, data, otherTabs: holdingOff(calls) }),
      ).rejects.toMatchObject({ kind: "network" });
      expect(calls).toEqual(["holdOff", "letGo"]);
    });

    it("touches nothing, and says so, when a change elsewhere does not finish in time", async () => {
      const { identity, data, calls } = setup();
      await expect(
        deleteAccount({ identity, data, otherTabs: holdingOff(calls, false) }),
      ).rejects.toBeInstanceOf(ChangeInAnotherTab);
      expect(data.erase).not.toHaveBeenCalled();
      expect(identity.remove).not.toHaveBeenCalled();
    });
  });
});

/**
 * Two tabs of the account in one browser, wired as the app wires them: shared Web Locks and
 * storage, a storage change that reaches the other tab only, and a removal of the account that
 * tells the other tabs, as a sign-out does.
 */
function twoTabs() {
  const locks = createFakeLockManager();
  type Listener = (ending?: AccountEnding) => void;
  const listeners = { a: new Set<Listener>(), b: new Set<Listener>() };
  const signing = { a: new Set<Listener>(), b: new Set<Listener>() };
  let signOuts = 0;
  const subscribe = (set: Set<Listener>) => (listener: Listener) => {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };
  const open = (own: "a" | "b", other: "a" | "b") => {
    const atLoad = signOuts;
    const signedOut = {
      announce(ending?: AccountEnding) {
        signOuts += 1;
        listeners[other].forEach((listener) => {
          listener(ending);
        });
      },
      subscribe: subscribe(listeners[own]),
      signedOutSinceLoad: () => signOuts !== atLoad,
    };
    const reload = vi.fn();
    const otherTabs = createOtherTabs({
      lock: createAccountLock("u1", locks),
      signedOut,
      signingOut: {
        announce(ending?: AccountEnding) {
          signing[other].forEach((listener) => {
            listener(ending);
          });
        },
        subscribe: subscribe(signing[own]),
      },
      reload,
      page: new EventTarget(),
    });
    return { otherTabs, signedOut, reload };
  };
  return { a: open("a", "b"), b: open("b", "a") };
}

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("deleting the account while another tab of it is open", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function deleting() {
    const { a, b } = twoTabs();
    const erasing = deferred();
    const removing = deferred();
    const data = { erase: vi.fn(() => erasing.promise) };
    const identity = {
      isRecentlyConfirmed: () => Promise.resolve(true),
      confirm: () => Promise.resolve(),
      confirmedByRedirect: () => Promise.resolve(false),
      // As the app wires it: once the account is gone, its other tabs are told.
      remove: vi.fn(async () => {
        await removing.promise;
        a.signedOut.announce("deletion");
      }),
    };
    const deletion = deleteAccount({ identity, data, otherTabs: a.otherTabs });
    return { a, b, erasing, removing, data, identity, deletion };
  }

  it("blocks the other tab, refuses its change with the message, and never stores it", async () => {
    vi.useFakeTimers();
    const { b, erasing, removing, deletion } = deleting();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.otherTabs.get()).toBe("deletingAccount");

    const write = vi.fn(() => Promise.resolve("stored"));
    const saving = b.otherTabs.guard(write);
    const refused = expect(saving).rejects.toBeInstanceOf(SignedOutElsewhere);
    await vi.advanceTimersByTimeAsync(0);
    expect(write).not.toHaveBeenCalled();

    erasing.resolve();
    removing.resolve();
    await deletion;
    await vi.advanceTimersByTimeAsync(0);
    await refused;
    expect(write).not.toHaveBeenCalled();
    expect(b.otherTabs.get()).toBe("lostChangeAccountDeleted");
    expect(b.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(b.reload).toHaveBeenCalledOnce();
  });

  it("refuses a change asked for in the deleting tab itself meanwhile", async () => {
    vi.useFakeTimers();
    const { a, erasing, removing, deletion } = deleting();
    await vi.advanceTimersByTimeAsync(0);
    const write = vi.fn(() => Promise.resolve("stored"));
    const saving = a.otherTabs.guard(write);
    const refused = expect(saving).rejects.toBeInstanceOf(SignedOutElsewhere);
    await vi.advanceTimersByTimeAsync(0);
    expect(write).not.toHaveBeenCalled();

    erasing.resolve();
    removing.resolve();
    await deletion;
    await vi.advanceTimersByTimeAsync(0);
    await refused;
    expect(write).not.toHaveBeenCalled();
  });

  it("sends the other tab to sign-in at once when nothing of it was waiting", async () => {
    const { b, erasing, removing, deletion } = deleting();
    erasing.resolve();
    removing.resolve();
    await deletion;
    expect(b.reload).toHaveBeenCalledOnce();
    expect(["lostChange", "lostChangeAccountDeleted"]).not.toContain(b.otherTabs.get());
  });

  it("saves the other tab's change after all when erasing fails and the account stays", async () => {
    const { b, erasing, data, identity, deletion } = deleting();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const write = vi.fn(() => Promise.resolve("stored"));
    const saving = b.otherTabs.guard(write);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(write).not.toHaveBeenCalled();

    erasing.reject(new AuthFailure("network"));
    await expect(deletion).rejects.toMatchObject({ kind: "network" });
    await expect(saving).resolves.toBe("stored");
    expect(data.erase).toHaveBeenCalledOnce();
    expect(identity.remove).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(b.otherTabs.get()).toBe("idle");
    expect(b.reload).not.toHaveBeenCalled();
  });
});
