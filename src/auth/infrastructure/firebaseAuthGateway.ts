import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type UserCredential,
} from "firebase/auth";
import { firebaseApp } from "../../shared/firebase/firebaseApp";
import type { AuthGateway } from "../application/ports";
import { AuthFailure, type AuthFailureKind, type User } from "../domain/user";

interface FirebaseProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

/** The app's whole view of a Google account: nothing else is ever read or kept. */
export function toUser({ uid, displayName, email, photoURL }: FirebaseProfile): User {
  const safeEmail = email ?? "";
  return { id: uid, name: displayName?.trim() || safeEmail, email: safeEmail, photoUrl: photoURL };
}

export function signInMethodFor(context: {
  standalone: boolean;
  mobile: boolean;
}): "popup" | "redirect" {
  return context.standalone || context.mobile ? "redirect" : "popup";
}

export const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

export function failureKindFor(error: unknown, online = true): AuthFailureKind {
  switch (errorCode(error)) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
    case "auth/redirect-cancelled-by-user":
      return "cancelled";
    case "auth/network-request-failed":
      return "network";
    case "auth/requires-recent-login":
      return "staleSignIn";
    case "auth/user-mismatch":
      return "wrongAccount";
    default:
      // Offline, the SDK fails to load Google's script and reports an internal error instead.
      return online ? "unknown" : "network";
  }
}

export function toFailure(error: unknown): AuthFailure {
  const kind = failureKindFor(error, navigator.onLine);
  // The code is what tells a misconfigured project apart; it holds no personal data.
  if (kind === "unknown") console.error("Sign-in failed:", errorCode(error) ?? "no error code");
  return new AuthFailure(kind);
}

/** Set by the app just before it leaves for a redirect sign-in, and cleared once its result is read. */
const REDIRECT_SIGN_IN_KEY = "sportime.redirectSignIn";
/** Firebase's own mark, a private detail kept as a second signal (it also covers re-confirmations). */
const FIREBASE_PENDING_REDIRECT_PREFIX = "firebase:pendingRedirect:";

function markRedirectSignIn(pending: boolean) {
  try {
    if (pending) sessionStorage.setItem(REDIRECT_SIGN_IN_KEY, "true");
    else sessionStorage.removeItem(REDIRECT_SIGN_IN_KEY);
  } catch {
    // Without storage Firebase cannot redirect either.
  }
}

/** True when this page load is coming back from a redirect sign-in that Firebase still has to finish. */
export function firebaseRedirectPending(): boolean {
  try {
    return (
      sessionStorage.getItem(REDIRECT_SIGN_IN_KEY) !== null ||
      Object.keys(sessionStorage).some((key) => key.startsWith(FIREBASE_PENDING_REDIRECT_PREFIX))
    );
  } catch {
    return false;
  }
}

/** Leaves for Google's page; the mark tells the next page load to wait for the result. */
async function signInViaRedirect(auth: Auth, provider: GoogleAuthProvider) {
  markRedirectSignIn(true);
  try {
    await signInWithRedirect(auth, provider);
  } catch (error) {
    // Still on this page, so nothing will come back.
    markRedirectSignIn(false);
    throw error;
  }
}

export function currentSignInMethod() {
  return signInMethodFor({
    standalone: matchMedia("(display-mode: standalone)").matches,
    mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  });
}

let redirectOutcome: Promise<UserCredential | null> | undefined;

/** Firebase hands a redirect's result to its first reader only, so every reader shares that one read. */
function readRedirectResult(): Promise<UserCredential | null> {
  redirectOutcome ??= getRedirectResult(getAuth(firebaseApp()));
  return redirectOutcome;
}

/** The account Google re-confirmed in the redirect that loaded this page, if any. */
export async function redirectReauthenticatedUserId(): Promise<string | null> {
  try {
    const result = await readRedirectResult();
    return result?.operationType === "reauthenticate" ? result.user.uid : null;
  } catch {
    // A failed redirect proves nothing; the sign-in screen reports it.
    return null;
  }
}

export function createFirebaseAuthGateway(): AuthGateway {
  const auth = getAuth(firebaseApp());

  return {
    subscribe(listener) {
      return onAuthStateChanged(auth, (user) => {
        listener(user ? toUser(user) : null);
      });
    },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        if (currentSignInMethod() === "redirect") {
          await signInViaRedirect(auth, provider);
        } else {
          await signInWithPopup(auth, provider);
        }
      } catch (error) {
        if (errorCode(error) !== "auth/popup-blocked") throw toFailure(error);
        try {
          await signInViaRedirect(auth, provider);
        } catch (redirectError) {
          throw toFailure(redirectError);
        }
      }
    },
    async signOut() {
      await signOut(auth);
    },
    async completePendingSignIn() {
      try {
        await readRedirectResult();
      } catch (error) {
        throw toFailure(error);
      } finally {
        markRedirectSignIn(false);
      }
    },
  };
}
