import type { OtherTabsActivity, OtherTabsGate, OtherTabsStatus } from "../application/ports";
import type { AccountLock } from "./accountLock";
import type { SignOutSignal, TabSignal } from "./signOutSignal";

/** How long another tab waits for this one's changes before it warns that they are unsent. */
const HOLD_OFF_WAIT_MS = 10_000;
/** Long enough to read why the change was not saved before the page goes to sign-in. */
const LOST_CHANGE_RELOAD_MS = 4_000;

/** A change refused because the account signed out in another tab while it waited. */
export class SignedOutElsewhere extends Error {
  readonly code = "signed-out-elsewhere";

  constructor() {
    super("The account signed out in another tab");
  }
}

export interface OtherTabs extends OtherTabsActivity, OtherTabsGate {
  /**
   * Runs a change while holding the account's lock with the other changes, so a sign-out in
   * another tab waits until the change is stored on this device. Refuses it with
   * `SignedOutElsewhere`, without running it, once the account signed out.
   */
  guard: <T>(write: () => Promise<T>) => Promise<T>;
  /**
   * Follows a change made here until the server answers it, which is what it returns. If the
   * account signs out in another tab before that, this tab says the change was lost.
   */
  confirming: <T>(change: Promise<T>) => Promise<T>;
}

interface Dependencies {
  lock: AccountLock;
  signedOut: SignOutSignal;
  signingOut: TabSignal;
  /** Starts afresh on the sign-in screen. */
  reload: () => void;
  /** Where the browser asks before closing or reloading the page; the window by default. */
  page?: EventTarget;
}

/** How the browser tells a holder that a forced sign-out took the lock from it. */
const lockTaken = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { name?: unknown }).name === "AbortError";

/**
 * The account's tabs in this browser share its outbox and Firestore's cache, and a sign-out in
 * one erases both, so a change made in another tab meanwhile must either reach the server first
 * or never be stored. The account's lock orders them: changes share it until they are stored on
 * this device, and signing out holds it alone. Without Web Locks nothing waits, as before.
 */
export function createOtherTabs({
  lock,
  signedOut,
  signingOut,
  reload,
  page = window,
}: Dependencies): OtherTabs {
  let status: OtherTabsStatus = "idle";
  const listeners = new Set<() => void>();
  /** Changes asked for here and not yet stored or refused. */
  let waiting = 0;
  /** Of those, the ones still waiting for the lock, which live only in this page's memory. */
  let queued = 0;
  /** A forced sign-out took the lock while a change here was being stored, so it may erase it. */
  let overruled = false;
  /**
   * Changes made here that the server has not answered. A forced sign-out elsewhere ("Sign out
   * anyway") drops them, for example when one was stored while that tab warned about unsent ones.
   */
  let unconfirmed = 0;
  let signedOutElsewhere = false;
  let leaving = false;

  const set = (next: OtherTabsStatus) => {
    if (status === next) return;
    status = next;
    listeners.forEach((listener) => {
      listener();
    });
  };

  const loseChange = () => {
    set("lostChange");
    if (leaving) return;
    leaving = true;
    setTimeout(reload, LOST_CHANGE_RELOAD_MS);
  };

  if (lock.available) {
    signingOut.subscribe(() => {
      if (status === "lostChange") return;
      set("signingOut");
      const ended = () => {
        overruled = false;
        if (status === "signingOut") set("idle");
      };
      // Granted once that tab let go: it either reloads everything here, or it did not sign out.
      // Refused only when yet another tab took the lock, which then tells this one again.
      void lock.shared(() => Promise.resolve()).then(ended, ended);
    });

    page.addEventListener("beforeunload", (event) => {
      // Once signed out, nothing waiting can be saved, and the app reloads on its own.
      if (queued === 0 || leaving || signedOutElsewhere || signedOut.signedOutSinceLoad()) return;
      // Closing or reloading now would lose the change without a word, so the browser asks.
      event.preventDefault();
      (event as BeforeUnloadEvent).returnValue = "unsent";
    });
  }

  signedOut.subscribe(() => {
    signedOutElsewhere = true;
    if (!lock.available) {
      reload();
      return;
    }
    // A waiting change is refused once it gets the lock, and one the server never confirmed was
    // erased with the account's copy; neither must go unexplained.
    if (waiting > 0 || unconfirmed > 0 || overruled || status === "lostChange") loseChange();
    else reload();
  });

  return {
    get: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    guard: async (write) => {
      if (!lock.available) return write();
      waiting += 1;
      queued += 1;
      let granted = false;
      let writing: ReturnType<typeof write> | undefined;
      const granting = () => {
        if (granted) return;
        granted = true;
        queued -= 1;
      };
      try {
        return await lock.shared(() => {
          granting();
          if (signedOutElsewhere || signedOut.signedOutSinceLoad()) {
            loseChange();
            return Promise.reject(new SignedOutElsewhere());
          }
          writing = write();
          return writing;
        });
      } catch (error) {
        if (!writing || !lockTaken(error)) throw error;
        // A forced sign-out elsewhere took the lock while this change was being stored. It still
        // ends, but that sign-out may erase it, and then this tab must say so.
        overruled = true;
        return await writing;
      } finally {
        granting();
        waiting -= 1;
      }
    },
    async holdOff(work, { force = false } = {}) {
      if (!lock.available) return { value: await work() };
      const signOutHere = () => {
        // Only once it holds the lock: every change started elsewhere before is stored by now,
        // or, when it was taken, reported lost there if this tab signs out.
        signingOut.announce();
        return work();
      };
      const held = await lock.exclusive(signOutHere, HOLD_OFF_WAIT_MS);
      if (held || !force) return held;
      // The user chose to lose what was not sent, so the tabs that did not let go are overruled
      // rather than the account signing out without the lock.
      return lock.takeOver(signOutHere);
    },
    changeWaitingHere: () => queued > 0,
    confirming(change) {
      // Without Web Locks a sign-out elsewhere reloads at once, as before.
      if (!lock.available) return change;
      unconfirmed += 1;
      const answered = () => {
        unconfirmed -= 1;
      };
      change.then(answered, answered);
      return change;
    },
  };
}
