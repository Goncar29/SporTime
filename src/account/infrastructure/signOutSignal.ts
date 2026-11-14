const KEY = "sportime.signedOut";

export interface SignOutSignal {
  /** Tells the app's other tabs that this one signed out. */
  announce: () => void;
  /** Calls `listener` when another tab signs out. Returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * Tabs share the session but each runs its own Firestore, which a sign-out elsewhere stops and
 * erases. The browser sends a storage change only to the other tabs, never to the one that made
 * it, so this tells exactly the tabs that must reload, and leaves a session ended by the provider
 * (an expired session, a deleted account) to the tab that shows why.
 */
export function createSignOutSignal(): SignOutSignal {
  return {
    announce() {
      try {
        // Always a new value: an unchanged one would not reach the other tabs.
        localStorage.setItem(KEY, `${Date.now()}-${Math.random()}`);
      } catch (error) {
        console.warn("Other tabs could not be told about the sign-out:", error);
      }
    },
    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === KEY && event.newValue !== null) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}
