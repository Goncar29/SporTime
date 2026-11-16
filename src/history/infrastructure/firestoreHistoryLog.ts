import {
  collection,
  deleteDoc,
  doc,
  getDocFromCache,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import { withOutbox, type HeldWrites, type OutboxStore } from "../../shared/application/outbox";
import { isInLocalCache } from "../../shared/firebase/localCache";
import type { HistoryLog } from "../application/ports";
import { parseHistoryEntry, type HistoryDraft, type HistoryEntry } from "../domain/historyEntry";
import { toStoredConfig } from "../../workouts/domain/workout";

const VISIBLE_ENTRIES = 100;

interface Durability {
  store: OutboxStore<HistoryDraft>;
  whenReady: () => Promise<boolean>;
  /**
   * Runs a change until it is stored on this device, holding off a sign-out in another tab, or
   * refuses it. Without one, changes run at once.
   */
  guard?: <T>(write: () => Promise<T>) => Promise<T>;
}

const runAtOnce = <T>(write: () => Promise<T>) => write();

/** The server's answer, kept apart so the guard does not wait for it. */
function answerLater(answer: Promise<void>): { answer: Promise<void> } {
  // Read after the guard ends; until then a refusal must not count as unhandled.
  answer.catch(() => undefined);
  return { answer };
}

export function createFirestoreHistoryLog(
  db: Firestore,
  userId: string,
  { store, whenReady, guard = runAtOnce }: Durability,
): HistoryLog & HeldWrites {
  const history = collection(db, "users", userId, "history");

  const outbox = withOutbox<HistoryEntry, HistoryDraft>({
    store,
    whenReady,
    parse: parseHistoryEntry,
    newestFirst: (a, b) => b.finishedAt - a.finishedAt,
    collection: {
      subscribe(onData, onError) {
        return onSnapshot(
          query(history, orderBy("finishedAt", "desc"), limit(VISIBLE_ENTRIES)),
          (snapshot) => {
            onData(snapshot.docs.flatMap((item) => parseHistoryEntry(item.id, item.data()) ?? []));
          },
          onError,
        );
      },
      newId: () => doc(history).id,
      async put(id, draft) {
        await setDoc(doc(history, id), { ...draft, config: toStoredConfig(draft.config) });
      },
      has: (id) => isInLocalCache(() => getDocFromCache(doc(history, id))),
    },
  });

  return {
    subscribe: outbox.subscribe,
    flushNow: outbox.flushNow,
    async add(draft) {
      const { answer } = await guard(async () => {
        const added = answerLater(outbox.add(draft));
        // Handed to Firestore's cache now, where a sign-out in another tab waits for the server.
        await outbox.flushNow();
        return added;
      });
      await answer;
    },
    async remove(id) {
      const ref = doc(history, id);
      const { answer } = await guard(async () => {
        outbox.cancel(id);
        // Also covers a write that was already on its way when it was cancelled.
        const removed = answerLater(deleteDoc(ref));
        // Firestore answers in order, so once this read answers, the removal is in the cache.
        await getDocFromCache(ref).catch(() => undefined);
        return removed;
      });
      await answer;
    },
  };
}
