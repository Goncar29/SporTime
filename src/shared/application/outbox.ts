import type { SubscribeToList } from "./liveList";

export interface Pending<Draft> {
  id: string;
  draft: Draft;
}

export interface OutboxStore<Draft> {
  load(): Pending<Draft>[];
  save(items: Pending<Draft>[]): void;
}

export interface DurableCollection<T, Draft> {
  subscribe: SubscribeToList<T>;
  newId(): string;
  /** Settles when the server answers, which never happens offline. */
  put(id: string, draft: Draft): Promise<void>;
  /** Answers from the local cache, including writes still waiting for the server. */
  has(id: string): Promise<boolean>;
}

interface Options<T, Draft> {
  collection: DurableCollection<T, Draft>;
  store: OutboxStore<Draft>;
  parse(id: string, draft: unknown): T | null;
  newestFirst(a: T, b: T): number;
  /** Resolves true once the collection can accept writes for this account. */
  whenReady(): Promise<boolean>;
}

export interface Outbox<T, Draft> {
  subscribe: SubscribeToList<T>;
  /** Durable as soon as it returns. Settles when the server answers, so callers must not wait for it. */
  add(draft: Draft): Promise<void>;
  cancel(id: string): void;
}

interface Waiter {
  resolve(): void;
  reject(error: unknown): void;
}

/**
 * Firestore holds every local read and write until Firebase Auth finishes its
 * start-up lookup, which takes about 30 s on a stalled network, and a write
 * still held when the page goes away is lost. This keeps writes on the device
 * until Firestore's own cache has them, and shows them in the meantime.
 */
export function withOutbox<T extends { id: string }, Draft>({
  collection,
  store,
  parse,
  newestFirst,
  whenReady,
}: Options<T, Draft>): Outbox<T, Draft> {
  const refreshers = new Set<() => void>();
  const waiters = new Map<string, Waiter>();
  let queue = Promise.resolve();

  const replace = (items: Pending<Draft>[]) => {
    store.save(items);
    refreshers.forEach((refresh) => {
      refresh();
    });
  };

  const drop = (id: string) => {
    replace(store.load().filter((item) => item.id !== id));
  };

  const send = async ({ id, draft }: Pending<Draft>) => {
    if (parse(id, draft) === null) {
      drop(id);
      return;
    }
    if (!(await collection.has(id))) {
      const waiter = waiters.get(id);
      collection.put(id, draft).then(
        () => waiter?.resolve(),
        (error: unknown) => {
          if (waiter) waiter.reject(error);
          // Left behind by an earlier page load, so nobody is waiting to hear about it.
          else console.error("A pending write was refused", error);
        },
      );
      // The cache answers in order, so a hit means the write above is stored locally.
      if (!(await collection.has(id))) return;
    } else {
      waiters.get(id)?.resolve();
    }
    drop(id);
  };

  const flush = () => {
    queue = queue.then(async () => {
      if (store.load().length === 0 || !(await whenReady())) return;
      // Read after waiting: anything cancelled during the wait must not be sent.
      for (const item of store.load()) {
        // A broken cache leaves the write here for the next page load.
        await send(item).catch((error: unknown) => {
          console.error("A pending write could not be stored", error);
        });
      }
    });
  };

  flush();

  return {
    subscribe(onData, onError) {
      let answered: T[] | null = null;
      let reported = false;

      const refresh = () => {
        const known = answered ?? [];
        const pending = store
          .load()
          .filter(({ id }) => !known.some((item) => item.id === id))
          .flatMap(({ id, draft }) => parse(id, draft) ?? []);
        // Without an answer, an empty list would be a guess.
        if (answered === null && pending.length === 0 && !reported) return;
        reported = true;
        onData([...pending, ...known].sort(newestFirst));
      };

      refreshers.add(refresh);
      refresh();
      const stop = collection.subscribe((items) => {
        answered = items;
        refresh();
      }, onError);

      return () => {
        refreshers.delete(refresh);
        stop();
      };
    },
    add(draft) {
      const id = collection.newId();
      const settled = new Promise<void>((resolve, reject) => {
        waiters.set(id, { resolve, reject });
      });
      replace([...store.load(), { id, draft }]);
      flush();
      return settled;
    },
    cancel(id) {
      waiters.get(id)?.resolve();
      drop(id);
    },
  };
}
