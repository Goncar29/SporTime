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
import { withOutbox, type OutboxStore } from "../../shared/application/outbox";
import { isInLocalCache } from "../../shared/firebase/localCache";
import type { HistoryLog } from "../application/ports";
import { parseHistoryEntry, type HistoryDraft, type HistoryEntry } from "../domain/historyEntry";
import { toStoredConfig } from "../../workouts/domain/workout";

const VISIBLE_ENTRIES = 100;

interface Durability {
  store: OutboxStore<HistoryDraft>;
  whenReady: () => Promise<boolean>;
}

export function createFirestoreHistoryLog(
  db: Firestore,
  userId: string,
  { store, whenReady }: Durability,
): HistoryLog {
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
    add: outbox.add,
    async remove(id) {
      outbox.cancel(id);
      // Also covers a write that was already on its way when it was cancelled.
      await deleteDoc(doc(history, id));
    },
  };
}
