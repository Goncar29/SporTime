import { useRef, useState } from "react";
import type { SignOutOptions, SignOutResult } from "../application/signOut";

interface SignOutDependencies {
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>;
  /** Starts a fresh page, with a fresh Firestore, once this device's copy is erased. */
  reload: () => void;
}

export interface AccountSignOut {
  /** Sending what is pending, then signing out; a second press must not start another. */
  signingOut: boolean;
  /** Some changes could not be sent: the user stays, or signs out and loses them. */
  unsent: boolean;
  /** The provider refused to sign out, so the session and its data are as they were. */
  failed: boolean;
  start: () => void;
  stay: () => void;
  signOutAnyway: () => void;
}

/**
 * The state of signing out of the account. Sending can take seconds, so it shows; it reloads
 * when signed out, since this tab's Firestore is stopped by then.
 */
export function useSignOut({ signOut, reload }: SignOutDependencies): AccountSignOut {
  const [signingOut, setSigningOut] = useState(false);
  const [unsent, setUnsent] = useState(false);
  const [failed, setFailed] = useState(false);
  // State updates land after the click, so a quick second click would still see the old one.
  const busy = useRef(false);

  const run = (options?: SignOutOptions) => {
    if (busy.current) return;
    busy.current = true;
    setSigningOut(true);
    setUnsent(false);
    setFailed(false);
    signOut(options).then(
      (result) => {
        // Stays busy: the page is about to go.
        if (result === "signedOut") {
          reload();
          return;
        }
        busy.current = false;
        setSigningOut(false);
        setUnsent(true);
      },
      (error: unknown) => {
        console.error("Signing out failed:", error);
        busy.current = false;
        setSigningOut(false);
        setFailed(true);
      },
    );
  };

  return {
    signingOut,
    unsent,
    failed,
    start: () => {
      run();
    },
    stay: () => {
      setUnsent(false);
    },
    signOutAnyway: () => {
      run({ force: true });
    },
  };
}
