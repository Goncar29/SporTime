import type { AuthGateway } from "../application/ports";
import type { User } from "../domain/user";

const KEY = "sportime.fakeAuth";

const TEST_USER: User = {
  id: "e2e-user",
  name: "Test Athlete",
  email: "athlete@example.com",
  photoUrl: null,
};

/** End-to-end tests only: Google's sign-in page cannot be automated. Never part of a production build. */
export function createFakeAuthGateway(): AuthGateway {
  const listeners = new Set<(user: User | null) => void>();
  const current = () => (localStorage.getItem(KEY) === "signed-out" ? null : TEST_USER);
  const update = (state: string) => {
    localStorage.setItem(KEY, state);
    listeners.forEach((listener) => {
      listener(current());
    });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(current());
      return () => listeners.delete(listener);
    },
    signIn: () => {
      update("signed-in");
      return Promise.resolve();
    },
    signOut: () => {
      update("signed-out");
      return Promise.resolve();
    },
    completePendingSignIn: () => Promise.resolve(),
  };
}
