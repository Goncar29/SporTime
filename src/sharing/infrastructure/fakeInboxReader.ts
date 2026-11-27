import type { InboxCopy, InboxReader } from "../application/ports";
import { fakeInboxKey, fakeInboxOf } from "./fakeRoutineSharing";

/**
 * Tests only: reads and deletes the copies in a user's fake inbox (createFakeRoutineSharing keeps
 * them in localStorage), told of copies sent from other pages by the storage event. Never part of
 * a production build.
 */
export function createFakeInboxReader(uid: string): InboxReader {
  const key = fakeInboxKey(uid);
  const listeners = new Set<(copies: InboxCopy[]) => void>();
  const copies = (): InboxCopy[] =>
    Object.entries(fakeInboxOf(uid)).map(([id, data]) => ({ id, data }));
  const report = () => {
    const list = copies();
    listeners.forEach((listener) => {
      listener(list);
    });
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) report();
  };

  return {
    subscribe(onCopies) {
      if (listeners.size === 0) window.addEventListener("storage", onStorage);
      listeners.add(onCopies);
      onCopies(copies());
      return () => {
        listeners.delete(onCopies);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
    remove(copyId) {
      // Like the server, which never answers offline.
      if (!navigator.onLine) return new Promise(() => undefined);
      const { [copyId]: _removed, ...rest } = fakeInboxOf(uid);
      localStorage.setItem(key, JSON.stringify(rest));
      report();
      return Promise.resolve();
    },
  };
}
