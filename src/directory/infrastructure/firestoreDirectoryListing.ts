import {
  deleteDoc,
  doc,
  getDocFromCache,
  getDocFromServer,
  onSnapshot,
  setDoc,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { storeFailureCode } from "../../shared/domain/storeFailure";
import type { DirectoryListing } from "../application/ports";
import { directoryEntryFor, normalizeEmail } from "../domain/directory";

interface Account {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
}

interface Options {
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

/** Firestore answers in order, so once this read answers, the change before it is in the cache. */
const inLocalCache = (ref: DocumentReference) => getDocFromCache(ref).catch(() => undefined);

const entryRef = (db: Firestore, email: string): DocumentReference | null => {
  const id = normalizeEmail(email);
  return id === "" ? null : doc(db, "directory", id);
};

/**
 * The rules only let an account delete its own entry, and check that before whether it exists,
 * so deleting one already gone, or never there, comes back refused. Asking the server tells the
 * cases apart: nothing of this account's is left there. When it cannot be asked, the refusal stands.
 */
async function deleteOwnEntry(ref: DocumentReference, uid: string): Promise<void> {
  try {
    await deleteDoc(ref);
  } catch (error) {
    if (storeFailureCode(error) !== "permission-denied") throw error;
    let stillOurs: boolean;
    try {
      const stored = await getDocFromServer(ref);
      stillOurs = stored.exists() && stored.data().uid === uid;
    } catch {
      throw error;
    }
    if (stillOurs) throw error;
  }
}

/**
 * Removes the account's entry, if it has one; used when the account is deleted, which needs the
 * server anyway. The server is asked first, so an account never listed, or an entry another
 * account holds, sends no delete the rules would refuse, and a read that fails rejects at once
 * instead of leaving a delete queued until the connection returns.
 */
export async function removeDirectoryEntry(
  db: Firestore,
  account: { id: string; email: string },
): Promise<void> {
  const ref = entryRef(db, account.email);
  if (!ref) return;
  const stored = await getDocFromServer(ref);
  if (!stored.exists() || stored.data().uid !== account.id) return;
  await deleteDoc(ref);
}

/**
 * Not held in the app's outbox: this is one document, set or deleted, which Firestore's own
 * cache queues while offline. A change lost before it reaches that cache shows, as the switch
 * follows the stored entry.
 */
export function createFirestoreDirectoryListing(
  db: Firestore,
  account: Account,
  { guard = runAtOnce }: Options = {},
): DirectoryListing {
  const ref = entryRef(db, account.email);

  const change = async (write: (ref: DocumentReference) => Promise<void>) => {
    if (!ref) throw new Error("An account without an email cannot be found by email");
    const { answer } = await guard(async () => {
      const sent = answerLater(write(ref));
      await inLocalCache(ref);
      return sent;
    });
    await answer;
  };

  return {
    subscribe(onListed, onError) {
      if (!ref) {
        onListed(false);
        return () => undefined;
      }
      return onSnapshot(
        ref,
        (snapshot) => {
          // An entry left under this email by another account is not this one's.
          onListed(snapshot.exists() && snapshot.data().uid === account.id);
        },
        onError,
      );
    },
    list: () => change((target) => setDoc(target, directoryEntryFor(account))),
    unlist: () => change((target) => deleteOwnEntry(target, account.id)),
  };
}
