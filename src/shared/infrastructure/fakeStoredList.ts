import type { SubscribeToNewest } from "../application/liveList";

export interface FakeStoredList<T, Draft> {
  /** Given `newest`, only that many of the newest, like a Firestore query with a limit. */
  subscribe: SubscribeToNewest<T>;
  add: (draft: Draft) => Promise<void>;
  update: (item: T) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Tests only: stands in for Firestore, which end-to-end tests cannot reach. Never part of a production build. */
export function createFakeStoredList<Draft, T extends Draft & { id: string }>(
  key: string,
  newestFirst: (a: T, b: T) => number,
): FakeStoredList<T, Draft> {
  const listeners = new Set<(items: T[]) => void>();
  const read = () => JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
  const write = (items: T[]) => {
    localStorage.setItem(key, JSON.stringify(items));
    const sorted = [...items].sort(newestFirst);
    listeners.forEach((listener) => {
      listener(sorted);
    });
  };

  return {
    subscribe(onData, _onError, newest) {
      const listener = (items: T[]) => {
        onData(newest === undefined ? items : items.slice(0, newest));
      };
      listeners.add(listener);
      listener([...read()].sort(newestFirst));
      return () => listeners.delete(listener);
    },
    add(draft) {
      const id = `${Date.now()}-${Math.random()}`;
      write([...read(), { ...draft, id } as T]);
      return Promise.resolve();
    },
    update(item) {
      const items = read();
      // Like Firestore's updateDoc, never recreates what was deleted.
      if (!items.some((current) => current.id === item.id)) {
        return Promise.reject(new Error(`No document to update: ${item.id}`));
      }
      write(items.map((current) => (current.id === item.id ? item : current)));
      return Promise.resolve();
    },
    remove(id) {
      write(read().filter((item) => item.id !== id));
      return Promise.resolve();
    },
  };
}
