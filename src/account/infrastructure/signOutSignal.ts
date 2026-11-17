import type { AccountEnding } from "../application/ports";

const SIGNED_OUT = "sportime.signedOut";
const SIGNING_OUT = "sportime.signingOut";
/** Marks a value written for a deletion; any other value, older ones included, is a sign-out. */
const DELETION = "deletion:";

export interface TabSignal {
  /** Tells the app's other tabs, for a sign-out unless `ending` says otherwise. */
  announce: (ending?: AccountEnding) => void;
  /**
   * Calls `listener` when another tab announces, with what it announced. Returns the unsubscribe
   * function.
   */
  subscribe: (listener: (ending?: AccountEnding) => void) => () => void;
}

export interface SignOutSignal extends TabSignal {
  /**
   * True once any tab signed out after this page loaded. Read from the shared storage, so it
   * can be true before the change reaches this tab.
   */
  signedOutSinceLoad: () => boolean;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The browser sends a storage change only to the other tabs, never to the one that made it, so
 * this reaches exactly the tabs that must react.
 */
function createTabSignal(key: string, what: string): TabSignal {
  return {
    announce(ending = "signOut") {
      try {
        // Always a new value: an unchanged one would not reach the other tabs.
        const prefix = ending === "deletion" ? DELETION : "";
        localStorage.setItem(key, `${prefix}${Date.now()}-${Math.random()}`);
      } catch (error) {
        console.warn(`Other tabs could not be told about the ${what}:`, error);
      }
    },
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === key && event.newValue !== null) {
          listener(event.newValue.startsWith(DELETION) ? "deletion" : "signOut");
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/**
 * Tabs share the session but each runs its own Firestore, which a sign-out elsewhere stops and
 * erases. Only the other tabs must reload, which leaves a session ended by the provider (an
 * expired session, a deleted account) to the tab that shows why.
 */
export function createSignOutSignal(): SignOutSignal {
  const atLoad = read(SIGNED_OUT);
  return {
    ...createTabSignal(SIGNED_OUT, "sign-out"),
    signedOutSinceLoad: () => read(SIGNED_OUT) !== atLoad,
  };
}

/** Tells the other tabs that one started signing out, so they hold their changes meanwhile. */
export function createSigningOutSignal(): TabSignal {
  return createTabSignal(SIGNING_OUT, "start of the sign-out");
}
