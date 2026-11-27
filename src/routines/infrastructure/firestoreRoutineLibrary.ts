import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocFromCache,
  getDocFromServer,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { withOutbox, type HeldWrites, type OutboxStore } from "../../shared/application/outbox";
import { storeFailureCode } from "../../shared/domain/storeFailure";
import { isInLocalCache } from "../../shared/firebase/localCache";
import type { ReceivedRoutines, RoutineLibrary } from "../application/ports";
import { parseRoutine, toStoredRoutine, type Routine, type RoutineDraft } from "../domain/routine";

interface Durability {
  store: OutboxStore<RoutineDraft>;
  whenReady: () => Promise<boolean>;
  /**
   * Runs a change until it is stored on this device, holding off a sign-out in another tab, or
   * refuses it. Without one, changes run at once.
   */
  guard?: <T>(write: () => Promise<T>) => Promise<T>;
  /** Waits before asking the server again; tests replace it. */
  wait?: (ms: number) => Promise<void>;
}

const waitFor = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** How long to wait before asking an unreachable server again: doubling, at most 30 s. */
const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 30_000;

const runAtOnce = <T>(write: () => Promise<T>) => write();

/** The server's answer, kept apart so the guard does not wait for it. */
function answerLater(answer: Promise<void>): { answer: Promise<void> } {
  // Read after the guard ends; until then a refusal must not count as unhandled.
  answer.catch(() => undefined);
  return { answer };
}

/**
 * The server checks the rules before it checks that the document exists, and the update rule
 * reads the stored routine, so editing one deleted elsewhere comes back as permission-denied.
 * Asking the server tells the two apart; when it cannot be asked, the refusal stands.
 */
async function explainRefusal(ref: DocumentReference, error: unknown): Promise<unknown> {
  if (storeFailureCode(error) !== "permission-denied") return error;
  try {
    if ((await getDocFromServer(ref)).exists()) return error;
  } catch {
    return error;
  }
  return Object.assign(new Error("The routine no longer exists"), {
    code: "not-found",
    cause: error,
  });
}

/**
 * Whether the server holds the routine, or null when it cannot be asked (offline). The answer
 * includes this device's changes still on their way; `confirmed` counts only a routine with none.
 */
async function onServer(ref: DocumentReference, confirmed: boolean): Promise<boolean | null> {
  try {
    const snapshot = await getDocFromServer(ref);
    return snapshot.exists() && (!confirmed || !snapshot.metadata.hasPendingWrites);
  } catch {
    return null;
  }
}

/**
 * Whether the server holds the routine, counting this device's changes on their way. Only the
 * server's own answer counts (L64 A2): this device's cache may lack a routine received and edited
 * elsewhere. While the server cannot be reached it asks again later, so it never settles offline;
 * any other failure, such as a refusal after signing out, is passed on.
 */
async function serverHolds(
  ref: DocumentReference,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let delay = FIRST_RETRY_MS; ; delay = Math.min(delay * 2, LAST_RETRY_MS)) {
    try {
      return (await getDocFromServer(ref)).exists();
    } catch (error) {
      if (storeFailureCode(error) !== "unavailable") throw error;
    }
    await wait(delay);
  }
}

const notConfirmed = () =>
  Object.assign(new Error("The server does not hold the received routine yet"), {
    code: "not-confirmed",
  });

export function createFirestoreRoutineLibrary(
  db: Firestore,
  userId: string,
  { store, whenReady, guard = runAtOnce, wait = waitFor }: Durability,
): RoutineLibrary & ReceivedRoutines & HeldWrites {
  const routines = collection(db, "users", userId, "routines");
  const inbox = collection(db, "users", userId, "inbox");
  /**
   * Whether a routine may have been received from a contact: it says so in this device's cache,
   * or the cache does not know it (then it is treated as received, to be safe).
   */
  const mayBeReceived = (ref: DocumentReference) =>
    getDocFromCache(ref).then(
      (snapshot) => !snapshot.exists() || snapshot.data()?.receivedFrom !== undefined,
      () => true,
    );
  /** Firestore answers in order, so once this read answers, the change before it is in the cache. */
  const inLocalCache = (ref: DocumentReference) => getDocFromCache(ref).catch(() => undefined);

  const outbox = withOutbox<Routine, RoutineDraft>({
    store,
    whenReady,
    parse: parseRoutine,
    newestFirst: (a, b) => b.createdAt - a.createdAt,
    collection: {
      subscribe(onData, onError) {
        return onSnapshot(
          query(routines, orderBy("createdAt", "desc")),
          (snapshot) => {
            onData(snapshot.docs.flatMap((item) => parseRoutine(item.id, item.data()) ?? []));
          },
          onError,
        );
      },
      newId: () => doc(routines).id,
      async put(id, draft) {
        await setDoc(doc(routines, id), toStoredRoutine(draft));
      },
      has: (id) => isInLocalCache(() => getDocFromCache(doc(routines, id))),
    },
  });

  return {
    subscribe: outbox.subscribe,
    flushNow: outbox.flushNow,
    async save(draft) {
      const { answer } = await guard(async () => {
        const saved = answerLater(outbox.add(draft));
        // Handed to Firestore's cache now, where a sign-out in another tab waits for the server.
        await outbox.flushNow();
        return saved;
      });
      await answer;
    },
    async update({ id, ...draft }) {
      const ref = doc(routines, id);
      const sent = await guard(async () => {
        // Revised first, so a save still waiting in the outbox sends this version and never the old one.
        const heldHere = outbox.revise(id, draft);
        // Once the outbox has handed it to Firestore, or it was never here, Firestore updates it.
        if (heldHere && !(await isInLocalCache(() => getDocFromCache(ref)))) return null;
        const stored = toStoredRoutine(draft);
        // An update, unlike setDoc, fails for a routine deleted elsewhere instead of bringing it back.
        // It merges top-level fields, so notes the edit cleared must be removed explicitly.
        const updated = answerLater(
          updateDoc(ref, { ...stored, notes: stored.notes ?? deleteField() }),
        );
        await inLocalCache(ref);
        return updated;
      });
      if (!sent) return;
      try {
        await sent.answer;
      } catch (error) {
        throw await explainRefusal(ref, error);
      }
    },
    async receive({ id, ...draft }) {
      const ref = doc(routines, id);
      // Received before, maybe edited since, or being stored by another tab: never written again.
      // Written only once the server itself says there is no such routine (L64 A2); until it can
      // be asked nothing is written, so an edit made elsewhere is never overwritten.
      if (!(await serverHolds(ref, wait))) {
        const { answer } = await guard(async () => {
          // Under the copy's id; one already held or cached here is not written twice.
          const saved = answerLater(outbox.add(draft, id));
          await outbox.flushNow();
          return saved;
        });
        await answer;
      }
      // The outbox settles at once for a routine already in this device's cache, which may not have
      // reached the server yet, so the server itself must say it holds it.
      if ((await onServer(ref, true)) !== true) throw notConfirmed();
    },
    async remove(id) {
      const ref = doc(routines, id);
      const { answer } = await guard(async () => {
        outbox.cancel(id);
        let deleting: Promise<void>;
        if (await mayBeReceived(ref)) {
          // Its copy may still be in the inbox (a delete that failed, a page closed in between):
          // deleted with it, in one write, so receiving it again cannot bring it back (L64 A1).
          // Deleting a copy that is already gone is fine.
          const batch = writeBatch(db);
          batch.delete(ref);
          batch.delete(doc(inbox, id));
          deleting = batch.commit();
        } else {
          deleting = deleteDoc(ref);
        }
        // Also covers a write that was already on its way when it was cancelled.
        const removed = answerLater(deleting);
        await inLocalCache(ref);
        return removed;
      });
      await answer;
    },
  };
}
