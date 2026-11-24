import {
  collection,
  getDocsFromServer,
  limit,
  query,
  writeBatch,
  type CollectionReference,
  type Firestore,
} from "firebase/firestore";
import { AuthFailure } from "../../auth/domain/user";
import { removeDirectoryEntry } from "../../directory/infrastructure/firestoreDirectoryListing";
import type { AccountData } from "../application/ports";

const BATCH_SIZE = 400;
const ERASE_TIMEOUT_MS = 60_000;

interface Dependencies {
  db: Firestore;
  userId: string;
  /** The account's email, under which it may be listed in the directory; null when it has none. */
  email: () => string | null;
  /** Drops writes not yet handed to Firestore, so none can recreate data after erasing. */
  discardPendingWrites: () => void;
}

async function eraseCollection(
  db: Firestore,
  documents: CollectionReference,
  isCancelled: () => boolean,
) {
  while (!isCancelled()) {
    const page = await getDocsFromServer(query(documents, limit(BATCH_SIZE)));
    if (page.empty || isCancelled()) return;
    const batch = writeBatch(db);
    page.docs.forEach((item) => {
      batch.delete(item.ref);
    });
    await batch.commit();
  }
}

/**
 * Firestore waits for the network without limit, so without this a lost connection
 * looks like a hang. Cancelling stops further deletes; one already queued cannot be
 * recalled and still applies when the connection returns.
 */
function withTimeout(work: (isCancelled: () => boolean) => Promise<void>): Promise<void> {
  let cancelled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cancelled = true;
      reject(new AuthFailure("network"));
    }, ERASE_TIMEOUT_MS);
    work(() => cancelled)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

export function createFirestoreAccountData({
  db,
  userId,
  email,
  discardPendingWrites,
}: Dependencies): AccountData {
  const erase = async (isCancelled: () => boolean) => {
    discardPendingWrites();
    // First, as it is the only thing other users can read. It is read from the server before
    // deleting, and a failed read stops here. Like the listings below, the answer includes this
    // device's writes still on their way, and the delete is sent after them.
    const address = email();
    if (address !== null) await removeDirectoryEntry(db, { id: userId, email: address });
    if (isCancelled()) return;
    // Firestore's listing includes writes still on their way, and sends the deletes after them.
    await eraseCollection(db, collection(db, "users", userId, "workouts"), isCancelled);
    await eraseCollection(db, collection(db, "users", userId, "history"), isCancelled);
    await eraseCollection(db, collection(db, "users", userId, "routines"), isCancelled);
    await eraseCollection(db, collection(db, "users", userId, "contacts"), isCancelled);
  };

  return {
    async erase() {
      if (!navigator.onLine) throw new AuthFailure("network");
      try {
        await withTimeout(erase);
      } catch (error) {
        if (error instanceof AuthFailure) throw error;
        if ((error as { code?: unknown }).code === "unavailable") throw new AuthFailure("network");
        console.error("Erasing the account's data failed:", error);
        throw new AuthFailure("unknown");
      }
    },
  };
}
