import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { InboxReader } from "../application/ports";

interface Options {
  /**
   * Runs a change until it is stored on this device, holding off a sign-out in another tab, or
   * refuses it. Without one, changes run at once.
   */
  guard?: <T>(write: () => Promise<T>) => Promise<T>;
}

const runAtOnce = <T>(write: () => Promise<T>) => write();

/** The copy as stored, with the server's time as milliseconds; anything else is passed on as is. */
function withMillis(data: DocumentData): Record<string, unknown> {
  const { sentAt } = data as { sentAt?: unknown };
  return sentAt instanceof Timestamp ? { ...data, sentAt: sentAt.toMillis() } : { ...data };
}

/**
 * Reads and deletes the copies in `users/{userId}/inbox` (T26, S12). Only lists the server has
 * answered are reported: this device's cache may still hold copies already received on another
 * device, and receiving one of those again could bring back a routine deleted there.
 */
export function createFirestoreInboxReader(
  db: Firestore,
  userId: string,
  { guard = runAtOnce }: Options = {},
): InboxReader {
  const inbox = collection(db, "users", userId, "inbox");
  return {
    subscribe(onCopies, onError) {
      return onSnapshot(
        inbox,
        // So an answer first read from the cache is reported again once the server confirms it.
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.fromCache) return;
          onCopies(snapshot.docs.map((item) => ({ id: item.id, data: withMillis(item.data()) })));
        },
        onError,
      );
    },
    async remove(copyId) {
      const { answer } = await guard(() => {
        const removed = deleteDoc(doc(inbox, copyId));
        // Read after the guard ends; until then a refusal must not count as unhandled.
        removed.catch(() => undefined);
        return Promise.resolve({ answer: removed });
      });
      await answer;
    },
  };
}
