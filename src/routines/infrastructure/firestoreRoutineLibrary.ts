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
  runTransaction,
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

/**
 * Why a received routine's transaction is tried again: the server could not be reached or its
 * answer was lost, or another write changed the routine between the read and the commit.
 */
const TRIED_AGAIN = new Set([
  "unavailable",
  "deadline-exceeded",
  "aborted",
  "failed-precondition",
  "already-exists",
]);

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
      const stored = toStoredRoutine(draft);
      // One server transaction that reads the routine and creates it only if it is absent (T29
      // W2). Unlike setDoc through the outbox, it is never held on this device to be sent later:
      // it reaches the server now or fails, so a routine received before and edited elsewhere
      // (L64 A2) can never be overwritten by a write replayed later, and offline nothing is
      // written. If another device creates it between the read and the commit, the server refuses
      // the commit and the next try finds it there. One attempt per try: each try is decided here,
      // after reading the server again, also when a commit's answer was lost.
      const createIfAbsent = () =>
        runTransaction(
          db,
          async (transaction) => {
            if ((await transaction.get(ref)).exists()) return;
            transaction.set(ref, stored);
          },
          { maxAttempts: 1 },
        );
      // While the server cannot be reached, or another write got there first, it tries again
      // later, so it never settles offline; any other failure, such as a refusal after signing
      // out, is passed on.
      for (let delay = FIRST_RETRY_MS; ; delay = Math.min(delay * 2, LAST_RETRY_MS)) {
        try {
          // Under the account's lock, like any change: a sign-out or deletion in another tab waits
          // for it, or refuses it before it runs.
          await guard(createIfAbsent);
          return;
        } catch (error) {
          if (!TRIED_AGAIN.has(storeFailureCode(error) ?? "")) throw error;
        }
        await wait(delay);
      }
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
