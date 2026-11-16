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
}

interface Dependencies {
  lock: AccountLock;
  signedOut: SignOutSignal;
  signingOut: TabSignal;
  /** Starts afresh on the sign-in screen. */
  reload: () => void;
}

/**
 * The account's tabs in this browser share its outbox and Firestore's cache, and a sign-out in
 * one erases both, so a change made in another tab meanwhile must either reach the server first
 * or never be stored. The account's lock orders them: changes share it until they are stored on
 * this device, and signing out holds it alone. Without Web Locks nothing waits, as before.
 */
export function createOtherTabs({ lock, signedOut, signingOut, reload }: Dependencies): OtherTabs {
  let status: OtherTabsStatus = "idle";
  const listeners = new Set<() => void>();
  /** Changes asked for here and not yet stored or refused. */
  let waiting = 0;
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
      // Granted once that tab let go: it either reloads everything here, or it did not sign out.
      void lock
        .shared(() => Promise.resolve())
        .then(() => {
          if (status === "signingOut") set("idle");
        });
    });
  }

  signedOut.subscribe(() => {
    signedOutElsewhere = true;
    if (!lock.available) {
      reload();
      return;
    }
    // A waiting change is refused once it gets the lock, and it must not go unexplained.
    if (waiting > 0 || status === "lostChange") loseChange();
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
      try {
        return await lock.shared(() => {
          if (signedOutElsewhere || signedOut.signedOutSinceLoad()) {
            loseChange();
            return Promise.reject(new SignedOutElsewhere());
          }
          return write();
        });
      } finally {
        waiting -= 1;
      }
    },
    holdOff(work) {
      if (!lock.available) return work().then((value) => ({ value }));
      return lock.exclusive(() => {
        // Only once it holds the lock: every change started elsewhere before is stored by now.
        signingOut.announce();
        return work();
      }, HOLD_OFF_WAIT_MS);
    },
  };
}
