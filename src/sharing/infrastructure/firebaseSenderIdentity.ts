import { getAuth } from "firebase/auth";
import { firebaseApp } from "../../shared/firebase/firebaseApp";
import type { SenderIdentity } from "../application/ports";
import type { SenderClaims } from "../domain/sharedCopy";

const failure = (code: string, cause?: unknown) =>
  Object.assign(new Error(`Reading the sign-in failed: ${code}`, { cause }), { code });

/**
 * The signed-in sender as their ID token says, which is what the rules compare a copy with:
 * email, name and picture exactly as Google gave them, never guessed from the profile.
 */
export function createFirebaseSenderIdentity(userId: string): SenderIdentity {
  return {
    async claims(): Promise<SenderClaims> {
      const user = getAuth(firebaseApp()).currentUser;
      if (user?.uid !== userId) throw failure("unauthenticated");
      let claims: Record<string, unknown>;
      try {
        ({ claims } = await user.getIdTokenResult());
      } catch (error: unknown) {
        const code = (error as { code?: unknown } | null)?.code;
        throw failure(code === "auth/network-request-failed" ? "unavailable" : "unknown", error);
      }
      const text = (value: unknown) => (typeof value === "string" ? value : undefined);
      const email = text(claims.email);
      const name = text(claims.name);
      const picture = text(claims.picture);
      return {
        uid: user.uid,
        ...(email === undefined ? {} : { email }),
        emailVerified: claims.email_verified === true,
        ...(name === undefined ? {} : { name }),
        ...(picture === undefined ? {} : { picture }),
      };
    },
  };
}
