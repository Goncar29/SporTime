import { doc, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import type { InboxWriter } from "../application/ports";

/**
 * Writes a copy to `users/{recipient}/inbox/{copyId}` in a transaction holding only that write.
 * Unlike setDoc, a transaction is never kept in Firestore's offline cache to be sent later: it
 * reaches the server now or fails (offline, it fails). One attempt only: the SDK would otherwise
 * resend a commit whose answer was lost, and the rules refuse that resend (no update), which would
 * read as a refusal of a copy that did arrive.
 */
export function createFirestoreInbox(db: Firestore): InboxWriter {
  return {
    async create(recipientUid, copyId, copy) {
      const ref = doc(db, "users", recipientUid, "inbox", copyId);
      await runTransaction(
        db,
        (transaction) => {
          transaction.set(ref, { ...copy, sentAt: serverTimestamp() });
          return Promise.resolve();
        },
        { maxAttempts: 1 },
      );
    },
  };
}
