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
  redirectReauthenticatedUserId,
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

/** A deletion the user accepted before leaving for Google; the page that comes back finishes it. */
const PENDING_KEY = "sportime.pendingDeletion";

function rememberPendingDeletion(userId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ userId, at: Date.now() }));
  } catch {
    // Without storage the user presses the button again on return, as before.
  }
}

/** Reads and forgets it, so one acceptance can never delete twice. */
function takePendingDeletion(): { userId: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "userId" in parsed &&
      "at" in parsed &&
      typeof parsed.userId === "string" &&
      typeof parsed.at === "number"
    ) {
      return { userId: parsed.userId, at: parsed.at };
    }
  } catch {
    // Unreadable or unavailable: nothing was asked, as far as this page can prove.
  }
  return null;
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
      // No forced chooser: the user already accepted in the app's own dialog.
      const provider = new GoogleAuthProvider();
      const viaRedirect = async () => {
        rememberPendingDeletion(userId);
        try {
          await reauthenticateWithRedirect(user, provider);
        } catch (error) {
          // The page never left, so nothing will come back to finish it.
          takePendingDeletion();
          throw error;
        }
      };
      try {
        if (currentSignInMethod() === "redirect") {
          await viaRedirect();
        } else {
          await reauthenticateWithPopup(user, provider);
        }
      } catch (error) {
        if (errorCode(error) !== "auth/popup-blocked") throw toFailure(error);
        try {
          await viaRedirect();
        } catch (redirectError) {
          throw toFailure(redirectError);
        }
      }
    },
    async confirmedByRedirect() {
      const pending = takePendingDeletion();
      if (pending?.userId !== userId) return false;
      // Wall-clock age only ever narrows this; Firebase itself still checks the sign-in.
      const age = Date.now() - pending.at;
      if (!(age >= 0 && age < RECENT_MS)) return false;
      // Coming back with the back button carries no result, so it never deletes.
      return (await redirectReauthenticatedUserId()) === userId;
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
