import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { HistoryLog } from "../application/ports";
import { parseHistoryEntry } from "../domain/historyEntry";

const VISIBLE_ENTRIES = 100;

export function createFirestoreHistoryLog(db: Firestore, userId: string): HistoryLog {
  const history = collection(db, "users", userId, "history");

  return {
    subscribe(onData, onError) {
      return onSnapshot(
        query(history, orderBy("finishedAt", "desc"), limit(VISIBLE_ENTRIES)),
        (snapshot) => {
          onData(snapshot.docs.flatMap((item) => parseHistoryEntry(item.id, item.data()) ?? []));
        },
        onError,
      );
    },
    async add(draft) {
      await setDoc(doc(history), draft);
    },
  };
}
