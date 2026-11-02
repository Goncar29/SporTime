import type { User } from "../domain/user";

export interface AuthGateway {
  /** Reports the current user right away, then every change. Returns the unsubscribe function. */
  subscribe(listener: (user: User | null) => void): () => void;
  /** Rejects with `AuthFailure`. A redirect sign-in may navigate away before settling. */
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Surfaces the outcome of a redirect sign-in after returning to the app. */
  completePendingSignIn(): Promise<void>;
}
