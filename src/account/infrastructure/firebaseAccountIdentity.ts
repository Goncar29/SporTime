import {
  GoogleAuthProvider,
  deleteUser,
  getAuth,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
  signOut,
} from "firebase/auth";
import { AuthFailure } from "../../auth/domain/user";
import {
  currentSignInMethod,
  errorCode,
  toFailure,
} from "../../auth/infrastructure/firebaseAuthGateway";
import { firebaseApp } from "../../shared/firebase/firebaseApp";
import type { AccountIdentity } from "../application/ports";

/** Firebase refuses to remove an account after about five minutes; this leaves a margin. */
const RECENT_MS = 4 * 60 * 1_000;

/** Both times come from the provider, so a wrong device clock cannot make an old sign-in look recent. */
export function isRecentSignIn(authTime: string, tokenIssuedAt: string): boolean {
  // A time that cannot be read compares false, so it never counts as recent.
  return Date.parse(tokenIssuedAt) - Date.parse(authTime) < RECENT_MS;
}

/** The provider answers the same for a removed account and an expired session, so these prove neither. */
export function meansSessionEnded(code: string | undefined): boolean {
  return (
    code === "auth/user-token-expired" ||
    code === "auth/user-not-found" ||
    code === "auth/invalid-user-token" ||
    code === "auth/invalid-refresh-token"
  );
}

export function createFirebaseAccountIdentity(userId: string): AccountIdentity {
  const auth = getAuth(firebaseApp());
  // Kept across attempts, so one identity must serve every attempt for this account. Monotonic
  // time, so a wrong device clock cannot extend it, and a sign-in only ever gets more recent.
  let recentUntil = 0;

  /** Firebase signs out by itself for some of these codes, so the user always ends up signed out. */
  const endSession = async () => {
    if (auth.currentUser?.uid === userId) await signOut(auth);
    return new AuthFailure("sessionEnded");
  };

  const signedInUser = async () => {
    await auth.authStateReady();
    // Never act on whoever else may have signed in since this screen opened.
    if (auth.currentUser?.uid !== userId) throw new AuthFailure("unknown");
    return auth.currentUser;
  };

  return {
    async isRecentlyConfirmed() {
      const user = await signedInUser();
      if (
        import.meta.env.MODE === "emulator" &&
        localStorage.getItem("sportime.test.staleSignIn") === "true"
      ) {
        return false;
      }
      // Asking again would end the session of an account a lost answer already removed, and erasing still needs it.
      if (performance.now() < recentUntil) return true;
      try {
        // Forcing a new token is what makes its issue time the provider's current time.
        const { authTime, issuedAtTime } = await user.getIdTokenResult(true);
        if (!isRecentSignIn(authTime, issuedAtTime)) return false;
        recentUntil =
          performance.now() + RECENT_MS - (Date.parse(issuedAtTime) - Date.parse(authTime));
        return true;
      } catch (error) {
        if (!meansSessionEnded(errorCode(error))) throw toFailure(error);
        throw await endSession();
      }
    },
    async confirm() {
      const user = await signedInUser();
      const provider = new GoogleAuthProvider();
      try {
        if (currentSignInMethod() === "redirect") {
          await reauthenticateWithRedirect(user, provider);
        } else {
          await reauthenticateWithPopup(user, provider);
        }
      } catch (error) {
        if (errorCode(error) !== "auth/popup-blocked") throw toFailure(error);
        try {
          await reauthenticateWithRedirect(user, provider);
        } catch (redirectError) {
          throw toFailure(redirectError);
        }
      }
    },
    async remove() {
      const user = await signedInUser();
      try {
        await deleteUser(user);
      } catch (error) {
        if (!meansSessionEnded(errorCode(error))) throw toFailure(error);
        throw await endSession();
      }
    },
  };
}
