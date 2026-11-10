import type { User } from "../domain/user";
import type { AuthGateway } from "./ports";

export interface SessionSnapshotStore {
  get: () => User | null;
  set: (user: User) => void;
  clear: () => void;
}

/**
 * Firebase only reports a stored session after a network lookup, which takes
 * 30 to 60 seconds on a stalled connection. Showing the last known user at once
 * keeps the timer available; the real answer then confirms or ends the session.
 * This gate only protects the local screen: cloud data is enforced by security rules.
 */
export function withCachedSession(inner: AuthGateway, store: SessionSnapshotStore): AuthGateway {
  return {
    ...inner,
    subscribe(listener) {
      const snapshot = store.get();
      if (snapshot) listener(snapshot);
      return inner.subscribe((user) => {
        if (user) store.set(user);
        else store.clear();
        listener(user);
      });
    },
  };
}
