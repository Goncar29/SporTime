import type { SubscribeToList } from "../application/liveList";

export interface FakeStoredList<T, Draft> {
  subscribe: SubscribeToList<T>;
  add(draft: Draft): Promise<void>;
  remove(id: string): Promise<void>;
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
    subscribe(onData) {
      listeners.add(onData);
      onData([...read()].sort(newestFirst));
      return () => listeners.delete(onData);
    },
    add(draft) {
      const id = `${Date.now()}-${Math.random()}`;
      write([...read(), { ...draft, id } as T]);
      return Promise.resolve();
    },
    remove(id) {
      write(read().filter((item) => item.id !== id));
      return Promise.resolve();
    },
  };
}
