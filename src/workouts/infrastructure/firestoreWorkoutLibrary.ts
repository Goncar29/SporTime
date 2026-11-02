import {
  collection,
  deleteDoc,
  doc,
  getDocFromCache,
  onSnapshot,
  orderBy,
  query,
  setDoc,
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

interface Durability {
  store: OutboxStore<SavedWorkoutDraft>;
  whenReady(): Promise<boolean>;
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
        await setDoc(doc(workouts, id), draft);
      },
      has: (id) => isInLocalCache(() => getDocFromCache(doc(workouts, id))),
    },
  });

  return {
    subscribe: outbox.subscribe,
    save: outbox.add,
    async remove(id) {
      outbox.cancel(id);
      // Also covers a write that was already on its way when it was cancelled.
      await deleteDoc(doc(workouts, id));
    },
  };
}
