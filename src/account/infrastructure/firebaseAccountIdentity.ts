import {
  GoogleAuthProvider,
  deleteUser,
  getAuth,
  reauthenticateWithPopup,
  reauthenticateWithRedirect,
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

export function isRecentSignIn(authTime: string, now: number): boolean {
  // A time that cannot be read compares false, so it never counts as recent.
  return now - Date.parse(authTime) < RECENT_MS;
}

export function createFirebaseAccountIdentity(): AccountIdentity {
  const auth = getAuth(firebaseApp());

  const signedInUser = async () => {
    await auth.authStateReady();
    if (!auth.currentUser) throw new AuthFailure("unknown");
    return auth.currentUser;
  };

  return {
    async isRecentlyConfirmed() {
      const user = await signedInUser();
      try {
        const { authTime } = await user.getIdTokenResult();
        return isRecentSignIn(authTime, Date.now());
      } catch (error) {
        throw toFailure(error);
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
        throw toFailure(error);
      }
    },
  };
}
