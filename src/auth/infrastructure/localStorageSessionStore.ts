import type { SessionSnapshotStore } from "../application/cachedSessionGateway";
import type { User } from "../domain/user";

const KEY = "sportime.session";

function isUser(value: unknown): value is User {
  if (typeof value !== "object" || value === null) return false;
  const { id, name, email, photoUrl } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    typeof name === "string" &&
    typeof email === "string" &&
    (typeof photoUrl === "string" || photoUrl === null)
  );
}

/** Blocked or corrupted storage only costs the instant start, never the session. */
export const localStorageSessionStore: SessionSnapshotStore = {
  get() {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
      return isUser(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  set(user) {
    try {
      localStorage.setItem(KEY, JSON.stringify(user));
    } catch {
      // The next start simply waits for Firebase.
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing stored can be read back in this state either.
    }
  },
};
