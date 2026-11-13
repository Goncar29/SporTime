import {
  collection,
  deleteDoc,
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
import { withOutbox, type OutboxStore } from "../../shared/application/outbox";
import { storeFailureCode } from "../../shared/domain/storeFailure";
import { isInLocalCache } from "../../shared/firebase/localCache";
import type { WorkoutLibrary } from "../application/ports";
import {
  parseSavedWorkout,
  type SavedWorkout,
  type SavedWorkoutDraft,
} from "../domain/savedWorkout";
import { toStoredConfig } from "../domain/workout";

interface Durability {
  store: OutboxStore<SavedWorkoutDraft>;
  whenReady: () => Promise<boolean>;
}

/**
 * The server checks the rules before it checks that the document exists, and the update rule
 * reads the stored workout, so editing one deleted elsewhere comes back as permission-denied.
 * Asking the server tells the two apart; when it cannot be asked, the refusal stands.
 */
async function explainRefusal(ref: DocumentReference, error: unknown): Promise<unknown> {
  if (storeFailureCode(error) !== "permission-denied") return error;
  try {
    if ((await getDocFromServer(ref)).exists()) return error;
  } catch {
    return error;
  }
  return Object.assign(new Error("The saved workout no longer exists"), {
    code: "not-found",
    cause: error,
  });
}

export function createFirestoreWorkoutLibrary(
  db: Firestore,
  userId: string,
  { store, whenReady }: Durability,
): WorkoutLibrary {
  const workouts = collection(db, "users", userId, "workouts");

  const outbox = withOutbox<SavedWorkout, SavedWorkoutDraft>({
    store,
    whenReady,
    parse: parseSavedWorkout,
    newestFirst: (a, b) => b.createdAt - a.createdAt,
    collection: {
      subscribe(onData, onError) {
        return onSnapshot(
          query(workouts, orderBy("createdAt", "desc")),
          (snapshot) => {
            onData(snapshot.docs.flatMap((item) => parseSavedWorkout(item.id, item.data()) ?? []));
          },
          onError,
        );
      },
      newId: () => doc(workouts).id,
      async put(id, draft) {
        await setDoc(doc(workouts, id), { ...draft, config: toStoredConfig(draft.config) });
      },
      has: (id) => isInLocalCache(() => getDocFromCache(doc(workouts, id))),
    },
  });

  return {
    subscribe: outbox.subscribe,
    save: outbox.add,
    async update({ id, ...draft }) {
      // Revised first, so a save still waiting in the outbox sends this version and never the old one.
      const heldHere = outbox.revise(id, draft);
      // Once the outbox has handed it to Firestore, or it was never here, Firestore updates it.
      if (heldHere && !(await isInLocalCache(() => getDocFromCache(doc(workouts, id))))) return;
      const ref = doc(workouts, id);
      try {
        // An update, unlike setDoc, fails for a workout deleted elsewhere instead of bringing it back.
        await updateDoc(ref, {
          name: draft.name,
          config: toStoredConfig(draft.config),
          createdAt: draft.createdAt,
        });
      } catch (error) {
        throw await explainRefusal(ref, error);
      }
    },
    async remove(id) {
      outbox.cancel(id);
      // Also covers a write that was already on its way when it was cancelled.
      await deleteDoc(doc(workouts, id));
    },
  };
}
