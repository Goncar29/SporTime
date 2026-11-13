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
 * With no known user, sign-in shows at once for the same reason: on phones Firebase
 * waits for Google's sign-in frame before answering. Only a page coming back from a
 * redirect sign-in waits for the answer, since it is about to be signed in.
 * This gate only protects the local screen: cloud data is enforced by security rules.
 */
export function withCachedSession(
  inner: AuthGateway,
  store: SessionSnapshotStore,
  returningFromRedirect: () => boolean,
): AuthGateway {
  return {
    ...inner,
    subscribe(listener) {
      const snapshot = store.get();
      if (snapshot) listener(snapshot);
      else if (!returningFromRedirect()) listener(null);
      return inner.subscribe((user) => {
        if (user) store.set(user);
        else store.clear();
        listener(user);
      });
    },
  };
}
