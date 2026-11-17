import type { SubscribeToList } from "./liveList";

export interface Pending<Draft> {
  id: string;
  draft: Draft;
}

export interface OutboxStore<Draft> {
  load: () => Pending<Draft>[];
  /** Replaces everything held; `save([])` discards it all. */
  save: (items: Pending<Draft>[]) => void;
  /**
   * Adds or replaces one write without rewriting the others, so tabs sharing the store never
   * undo each other's changes. Without it, the outbox rewrites the whole list.
   */
  put?: (item: Pending<Draft>) => void;
  /** Drops one write without rewriting the others. */
  remove?: (id: string) => void;
}

export interface DurableCollection<T, Draft> {
  subscribe: SubscribeToList<T>;
  newId: () => string;
  /** Settles when the server answers, which never happens offline. */
  put: (id: string, draft: Draft) => Promise<void>;
  /** Answers from the local cache, including writes still waiting for the server. */
  has: (id: string) => Promise<boolean>;
}

interface Options<T, Draft> {
  collection: DurableCollection<T, Draft>;
  store: OutboxStore<Draft>;
  parse: (id: string, draft: unknown) => T | null;
  newestFirst: (a: T, b: T) => number;
  /** Resolves true once the collection can accept writes for this account. */
  whenReady: () => Promise<boolean>;
}

/** Writes this device holds for an account before Firestore's own cache has them. */
export interface HeldWrites {
  /**
   * Tries now to hand every held write to the collection, and resolves to how many it still
   * holds. Zero means Firestore's local cache has them all, not that the server does.
   */
  flushNow: () => Promise<number>;
}

export interface Outbox<T, Draft> extends HeldWrites {
  subscribe: SubscribeToList<T>;
  /** Durable as soon as it returns. Settles when the server answers, so callers must not wait for it. */
  add: (draft: Draft) => Promise<void>;
  cancel: (id: string) => void;
  /**
   * Replaces the draft of a write still held here, so an edit made before it reached the
   * collection is the version sent. False when this outbox does not hold that write.
   */
  revise: (id: string, draft: Draft) => boolean;
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
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

  const changed = () => {
    refreshers.forEach((refresh) => {
      refresh();
    });
  };

  const hold = (item: Pending<Draft>) => {
    if (store.put) store.put(item);
    else {
      const items = store.load();
      store.save(
        items.some(({ id }) => id === item.id)
          ? items.map((each) => (each.id === item.id ? item : each))
          : [...items, item],
      );
    }
    changed();
  };

  const drop = (id: string) => {
    if (store.remove) store.remove(id);
    else store.save(store.load().filter((item) => item.id !== id));
    changed();
  };

  const held = (id: string) => store.load().find((item) => item.id === id);
  const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

  const send = async ({ id, draft }: Pending<Draft>) => {
    if (parse(id, draft) === null) {
      drop(id);
      return;
    }
    if (await collection.has(id)) {
      waiters.get(id)?.resolve();
      drop(id);
      return;
    }
    // Read again after every wait: a delete may have removed it, or an edit revised it, meanwhile.
    let latest = held(id);
    while (latest) {
      const waiter = waiters.get(id);
      const sent = latest.draft;
      collection.put(id, sent).then(
        () => waiter?.resolve(),
        (error: unknown) => {
          if (waiter) waiter.reject(error);
          // Left behind by an earlier page load, so nobody is waiting to hear about it.
          else console.error("A pending write was refused", error);
        },
      );
      // The cache answers in order, so a hit means the write above is stored locally.
      if (!(await collection.has(id))) return;
      latest = held(id);
      if (!latest) return;
      if (sameDraft(latest.draft, sent)) {
        drop(id);
        return;
      }
    }
    // Deleted, discarded, or sent by another tab before it was sent here: never write it now.
    waiters.get(id)?.resolve();
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
    return queue;
  };

  void flush();

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
      hold({ id, draft });
      void flush();
      return settled;
    },
    cancel(id) {
      waiters.get(id)?.resolve();
      drop(id);
    },
    revise(id, draft) {
      if (!held(id)) return false;
      hold({ id, draft });
      return true;
    },
    async flushNow() {
      await flush();
      return store.load().length;
    },
  };
}
