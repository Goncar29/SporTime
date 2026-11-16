import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createAccountLock, type Locks } from "./accountLock";
import { createFakeLockManager } from "./fakeLockManager";
import { SignedOutElsewhere, createOtherTabs } from "./otherTabs";

interface Listeners {
  signedOut: Set<() => void>;
  signingOut: Set<() => void>;
}

/**
 * Tabs of one browser: they share the Web Locks and the storage, and a storage change reaches
 * every tab but the one that made it.
 */
function createBrowser(
  { locks }: { locks: Locks | undefined } = { locks: createFakeLockManager() },
) {
  const tabs: Listeners[] = [];
  let signOuts = 0;

  return function openTab() {
    const own: Listeners = { signedOut: new Set(), signingOut: new Set() };
    tabs.push(own);
    const toOthers = (pick: (tab: Listeners) => Set<() => void>) => {
      tabs
        .filter((tab) => tab !== own)
        .forEach((tab) => {
          pick(tab).forEach((listener) => {
            listener();
          });
        });
    };
    const subscribe = (set: Set<() => void>) => (listener: () => void) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
    const atLoad = signOuts;
    const signedOut = {
      announce() {
        signOuts += 1;
        toOthers((tab) => tab.signedOut);
      },
      subscribe: subscribe(own.signedOut),
      signedOutSinceLoad: () => signOuts !== atLoad,
    };
    const signingOut = {
      announce() {
        toOthers((tab) => tab.signingOut);
      },
      subscribe: subscribe(own.signingOut),
    };
    const reload = vi.fn();
    const otherTabs = createOtherTabs({
      lock: createAccountLock("u1", locks),
      signedOut,
      signingOut,
      reload,
    });
    return { otherTabs, reload, signedOut };
  };
}

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Lets every queued promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("other tabs of the account", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the other tabs that one is signing out, and frees them when it ends without signing out", async () => {
    const openTab = createBrowser();
    const a = openTab();
    const b = openTab();
    const changed = vi.fn();
    b.otherTabs.subscribe(changed);
    const ending = deferred<string>();

    const result = a.otherTabs.holdOff(() => ending.promise);
    await settle();
    expect(b.otherTabs.get()).toBe("signingOut");
    expect(changed).toHaveBeenCalled();
    // The tab signing out shows its own progress instead.
    expect(a.otherTabs.get()).toBe("idle");

    ending.resolve("unsent");
    await expect(result).resolves.toEqual({ value: "unsent" });
    await settle();
    expect(b.otherTabs.get()).toBe("idle");
    expect(b.reload).not.toHaveBeenCalled();
  });

  it("holds a change made in another tab meanwhile, and saves it when the tab did not sign out", async () => {
    const openTab = createBrowser();
    const a = openTab();
    const b = openTab();
    const ending = deferred<string>();
    const result = a.otherTabs.holdOff(() => ending.promise);
    await settle();

    const write = vi.fn(() => Promise.resolve("stored"));
    const saving = b.otherTabs.guard(write);
    await settle();
    expect(write).not.toHaveBeenCalled();

    ending.resolve("unsent");
    await result;
    await expect(saving).resolves.toBe("stored");
    expect(write).toHaveBeenCalledOnce();
    expect(b.otherTabs.get()).toBe("idle");
  });

  it("refuses that change when the tab signed out, says so, and reloads a moment later", async () => {
    vi.useFakeTimers();
    const openTab = createBrowser();
    const a = openTab();
    const b = openTab();
    const ending = deferred();
    void a.otherTabs.holdOff(async () => {
      await ending.promise;
      a.signedOut.announce();
      return "signedOut";
    });
    await vi.advanceTimersByTimeAsync(0);

    const write = vi.fn(() => Promise.resolve("stored"));
    const saving = b.otherTabs.guard(write);
    const refused = expect(saving).rejects.toBeInstanceOf(SignedOutElsewhere);
    await vi.advanceTimersByTimeAsync(0);
    ending.resolve();
    await vi.advanceTimersByTimeAsync(0);

    await refused;
    expect(write).not.toHaveBeenCalled();
    expect(b.otherTabs.get()).toBe("lostChange");
    expect(b.reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(b.reload).toHaveBeenCalledOnce();
  });

  it("reloads at once when another tab signs out and nothing was waiting", async () => {
    const openTab = createBrowser();
    const a = openTab();
    const b = openTab();
    await a.otherTabs.holdOff(() => {
      a.signedOut.announce();
      return Promise.resolve("signedOut");
    });
    expect(b.reload).toHaveBeenCalledOnce();
    expect(b.otherTabs.get()).not.toBe("lostChange");
  });

  it("refuses a change made once another tab signed out", async () => {
    const openTab = createBrowser();
    const a = openTab();
    const b = openTab();
    a.signedOut.announce();
    const write = vi.fn(() => Promise.resolve());
    await expect(b.otherTabs.guard(write)).rejects.toBeInstanceOf(SignedOutElsewhere);
    expect(write).not.toHaveBeenCalled();
    expect(b.otherTabs.get()).toBe("lostChange");
  });

  it("gives up signing out when another tab's change does not finish within 10 seconds", async () => {
    vi.useFakeTimers();
    const openTab = createBrowser();
    const a = openTab();
    const b = openTab();
    void b.otherTabs.guard(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(0);

    const work = vi.fn(() => Promise.resolve("signedOut"));
    const result = a.otherTabs.holdOff(work);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
    expect(work).not.toHaveBeenCalled();
    expect(b.otherTabs.get()).toBe("idle");
  });

  describe("in a browser without Web Locks", () => {
    it("keeps the earlier behavior: no waiting, no notice, and a reload at once", async () => {
      const openTab = createBrowser({ locks: undefined });
      const a = openTab();
      const b = openTab();
      const writing = deferred();
      const write = vi.fn(() => writing.promise);
      void b.otherTabs.guard(write);
      expect(write).toHaveBeenCalledOnce();

      const work = vi.fn(() => {
        a.signedOut.announce();
        return Promise.resolve("signedOut");
      });
      await expect(a.otherTabs.holdOff(work)).resolves.toEqual({ value: "signedOut" });
      expect(work).toHaveBeenCalledOnce();
      expect(b.otherTabs.get()).toBe("idle");
      expect(b.reload).toHaveBeenCalledOnce();
    });
  });
});
