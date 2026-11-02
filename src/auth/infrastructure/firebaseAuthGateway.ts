import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
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

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

export function failureKindFor(error: unknown): AuthFailureKind {
  switch (errorCode(error)) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "cancelled";
    case "auth/network-request-failed":
      return "network";
    default:
      return "unknown";
  }
}

function toFailure(error: unknown): AuthFailure {
  const kind = failureKindFor(error);
  // The code is what tells a misconfigured project apart; it holds no personal data.
  if (kind === "unknown") console.error("Sign-in failed:", errorCode(error) ?? "no error code");
  return new AuthFailure(kind);
}

function currentSignInMethod() {
  return signInMethodFor({
    standalone: matchMedia("(display-mode: standalone)").matches,
    mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  });
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
          await signInWithRedirect(auth, provider);
        } else {
          await signInWithPopup(auth, provider);
        }
      } catch (error) {
        if (errorCode(error) === "auth/popup-blocked") {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw toFailure(error);
      }
    },
    async signOut() {
      await signOut(auth);
    },
    async completePendingSignIn() {
      try {
        await getRedirectResult(auth);
      } catch (error) {
        throw toFailure(error);
      }
    },
  };
}
