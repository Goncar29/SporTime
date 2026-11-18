// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { AccountEnding } from "../application/ports";
import { createAccountLock, type Locks } from "./accountLock";
import { createFakeLockManager } from "./fakeLockManager";
import { SignedOutElsewhere, createOtherTabs } from "./otherTabs";

type Listener = (ending?: AccountEnding) => void;

interface Listeners {
  signedOut: Set<Listener>;
  signingOut: Set<Listener>;
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
    const toOthers = (pick: (tab: Listeners) => Set<Listener>, ending?: AccountEnding) => {
      tabs
        .filter((tab) => tab !== own)
        .forEach((tab) => {
          pick(tab).forEach((listener) => {
            listener(ending);
          });
        });
    };
    const subscribe = (set: Set<Listener>) => (listener: Listener) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    };
    const atLoad = signOuts;
    const signedOut = {
      announce(ending?: AccountEnding) {
        signOuts += 1;
        toOthers((tab) => tab.signedOut, ending);
      },
      subscribe: subscribe(own.signedOut),
      signedOutSinceLoad: () => signOuts !== atLoad,
    };
    const signingOut = {
      announce(ending?: AccountEnding) {
        toOthers((tab) => tab.signingOut, ending);
      },
      subscribe: subscribe(own.signingOut),
    };
    const reload = vi.fn();
    // Each tab is its own page, which the browser asks before it closes or reloads it.
    const page = new EventTarget();
    const otherTabs = createOtherTabs({
      lock: createAccountLock("u1", locks),
      signedOut,
      signingOut,
      reload,
      page,
    });
    return { otherTabs, reload, signedOut, page };
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

/** True when the page asked the browser to confirm leaving, as closing or reloading it would. */
function asksBeforeLeaving(page: EventTarget): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  page.dispatchEvent(event);
  return event.defaultPrevented;
}

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

  describe("when another tab deletes the account", () => {
    it("shows the other tabs that the account is being deleted, not signed out", async () => {
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      const ending = deferred<string>();
      const result = a.otherTabs.holdOff(() => ending.promise, { ending: "deletion" });
      await settle();
      expect(b.otherTabs.get()).toBe("deletingAccount");

      ending.resolve("kept");
      await result;
      await settle();
      expect(b.otherTabs.get()).toBe("idle");
    });

    it("says a change waiting there was lost because the account was deleted", async () => {
      vi.useFakeTimers();
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      const ending = deferred();
      void a.otherTabs.holdOff(
        async () => {
          await ending.promise;
          a.signedOut.announce("deletion");
        },
        { ending: "deletion" },
      );
      await vi.advanceTimersByTimeAsync(0);
      const saving = b.otherTabs.guard(() => Promise.resolve("stored"));
      const refused = expect(saving).rejects.toBeInstanceOf(SignedOutElsewhere);
      await vi.advanceTimersByTimeAsync(0);
      ending.resolve();
      await vi.advanceTimersByTimeAsync(0);

      await refused;
      expect(b.otherTabs.get()).toBe("lostChangeAccountDeleted");
      expect(b.reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(b.reload).toHaveBeenCalledOnce();
    });
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

  describe("when another tab signs out after a change stored here", () => {
    it("says the change was lost when the server never confirmed it, then reloads a moment later", async () => {
      vi.useFakeTimers();
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      // Stored here, say while the other tab warned about unsent changes; the server never answers.
      void b.otherTabs.confirming(new Promise<void>(() => undefined));
      await vi.advanceTimersByTimeAsync(0);

      // "Sign out anyway" in the other tab, which drops what the server did not confirm.
      await a.otherTabs.holdOff(
        () => {
          a.signedOut.announce();
          return Promise.resolve("signedOut");
        },
        { force: true },
      );
      expect(b.otherTabs.get()).toBe("lostChange");
      expect(b.reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(b.reload).toHaveBeenCalledOnce();
    });

    it("reloads at once, as before, when the server confirmed every change made here", async () => {
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      await b.otherTabs.confirming(b.otherTabs.guard(() => Promise.resolve("stored")));
      await expect(b.otherTabs.confirming(Promise.reject(new Error("refused")))).rejects.toThrow(
        "refused",
      );

      await a.otherTabs.holdOff(() => {
        a.signedOut.announce();
        return Promise.resolve("signedOut");
      });
      expect(b.reload).toHaveBeenCalledOnce();
      expect(b.otherTabs.get()).not.toBe("lostChange");
    });

    it("changes nothing for the tab that signs out itself", async () => {
      const openTab = createBrowser();
      const a = openTab();
      openTab();
      void a.otherTabs.confirming(new Promise<void>(() => undefined));
      await expect(
        a.otherTabs.holdOff(() => {
          a.signedOut.announce();
          return Promise.resolve("signedOut");
        }),
      ).resolves.toEqual({ value: "signedOut" });
      expect(a.otherTabs.get()).toBe("idle");
      expect(a.reload).not.toHaveBeenCalled();
    });
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

  describe("when a forced sign-out takes the lock from a change that does not let go", () => {
    it("reports that change lost when the account then signs out, never silently", async () => {
      vi.useFakeTimers();
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      const storing = deferred();
      const saving = b.otherTabs.guard(async () => {
        await storing.promise;
        return "stored";
      });
      await vi.advanceTimersByTimeAsync(0);

      const work = vi.fn(async () => {
        // That change is stored only now, while this tab signs out.
        storing.resolve();
        await vi.advanceTimersByTimeAsync(0);
        a.signedOut.announce();
        return "signedOut";
      });
      const result = a.otherTabs.holdOff(work, { force: true });
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toEqual({ value: "signedOut" });
      await expect(saving).resolves.toBe("stored");
      expect(b.otherTabs.get()).toBe("lostChange");
      expect(b.reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_000);
      expect(b.reload).toHaveBeenCalledOnce();
    });

    it("holds the changes asked for meanwhile, and refuses them once it signed out", async () => {
      vi.useFakeTimers();
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      void b.otherTabs.guard(() => new Promise(() => undefined));
      await vi.advanceTimersByTimeAsync(0);

      const later = vi.fn(() => Promise.resolve("stored"));
      const ending = deferred();
      let refused: Promise<void> | undefined;
      const result = a.otherTabs.holdOff(
        async () => {
          refused = expect(b.otherTabs.guard(later)).rejects.toBeInstanceOf(SignedOutElsewhere);
          await ending.promise;
          a.signedOut.announce();
          return "signedOut";
        },
        { force: true },
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(refused).toBeDefined();
      expect(later).not.toHaveBeenCalled();

      ending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await expect(result).resolves.toEqual({ value: "signedOut" });
      await refused;
      expect(later).not.toHaveBeenCalled();
      expect(b.otherTabs.get()).toBe("lostChange");
    });

    it("waits for them first, and does not take over when not forced", async () => {
      vi.useFakeTimers();
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      const storing = deferred();
      void b.otherTabs.guard(() => storing.promise);
      await vi.advanceTimersByTimeAsync(0);

      const work = vi.fn(() => Promise.resolve("signedOut"));
      const forced = a.otherTabs.holdOff(work, { force: true });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(work).not.toHaveBeenCalled();
      storing.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await expect(forced).resolves.toEqual({ value: "signedOut" });
      expect(b.otherTabs.get()).not.toBe("lostChange");
    });
  });

  describe("leaving the page", () => {
    it("asks before leaving while a change waits for another tab's sign-out", async () => {
      const openTab = createBrowser();
      const a = openTab();
      const b = openTab();
      const ending = deferred<string>();
      const result = a.otherTabs.holdOff(() => ending.promise);
      await settle();

      const saving = b.otherTabs.guard(() => Promise.resolve("stored"));
      await settle();
      expect(asksBeforeLeaving(b.page)).toBe(true);

      ending.resolve("unsent");
      await result;
      await saving;
      expect(asksBeforeLeaving(b.page)).toBe(false);
    });

    it("does not ask when nothing waits", () => {
      const openTab = createBrowser();
      const a = openTab();
      expect(asksBeforeLeaving(a.page)).toBe(false);
    });

    it("does not ask when the app itself reloads after the account signed out", async () => {
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
      const saving = b.otherTabs.guard(() => Promise.resolve("stored"));
      saving.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(asksBeforeLeaving(b.page)).toBe(true);

      ending.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(b.otherTabs.get()).toBe("lostChange");
      expect(asksBeforeLeaving(b.page)).toBe(false);
      // Nor the tab that signed out, which reloads at once.
      expect(asksBeforeLeaving(a.page)).toBe(false);
    });
  });

  it("knows when a change asked for here waits for this tab's own sign-out", async () => {
    const openTab = createBrowser();
    const a = openTab();
    const ending = deferred<string>();
    let waitingDuringSignOut: boolean | undefined;
    const result = a.otherTabs.holdOff(async () => {
      expect(a.otherTabs.changeWaitingHere()).toBe(false);
      void a.otherTabs.guard(() => Promise.resolve("stored"));
      await settle();
      waitingDuringSignOut = a.otherTabs.changeWaitingHere();
      return ending.promise;
    });
    await settle();
    ending.resolve("unsent");
    await result;
    await settle();
    expect(waitingDuringSignOut).toBe(true);
    expect(a.otherTabs.changeWaitingHere()).toBe(false);
  });

  it("frees the tab when its wait for the end of another tab's sign-out fails", async () => {
    const failing: Locks = {
      request(_name, { mode }, callback) {
        if (mode === "shared") {
          return Promise.reject(new DOMException("The lock was taken", "AbortError"));
        }
        return callback();
      },
    };
    const openTab = createBrowser({ locks: failing });
    const a = openTab();
    const b = openTab();
    await a.otherTabs.holdOff(() => Promise.resolve("unsent"));
    await settle();
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
