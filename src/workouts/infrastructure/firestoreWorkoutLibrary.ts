import {
  collection,
  deleteDoc,
  doc,
  getDocFromCache,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore";
import { withOutbox, type OutboxStore } from "../../shared/application/outbox";
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
      // An update, unlike setDoc, fails for a workout deleted elsewhere instead of bringing it back.
      await updateDoc(doc(workouts, id), {
        name: draft.name,
        config: toStoredConfig(draft.config),
        createdAt: draft.createdAt,
      });
    },
    async remove(id) {
      outbox.cancel(id);
      // Also covers a write that was already on its way when it was cancelled.
      await deleteDoc(doc(workouts, id));
    },
  };
}
