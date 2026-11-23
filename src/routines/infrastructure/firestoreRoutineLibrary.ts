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
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { withOutbox, type HeldWrites, type OutboxStore } from "../../shared/application/outbox";
import { storeFailureCode } from "../../shared/domain/storeFailure";
import { isInLocalCache } from "../../shared/firebase/localCache";
import type { RoutineLibrary } from "../application/ports";
import { parseRoutine, toStoredRoutine, type Routine, type RoutineDraft } from "../domain/routine";

interface Durability {
  store: OutboxStore<RoutineDraft>;
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
  { store, whenReady, guard = runAtOnce }: Durability,
): RoutineLibrary & HeldWrites {
  const routines = collection(db, "users", userId, "routines");
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
    async remove(id) {
      const ref = doc(routines, id);
      const { answer } = await guard(async () => {
        outbox.cancel(id);
        // Also covers a write that was already on its way when it was cancelled.
        const removed = answerLater(deleteDoc(ref));
        await inLocalCache(ref);
        return removed;
      });
      await answer;
    },
  };
}
