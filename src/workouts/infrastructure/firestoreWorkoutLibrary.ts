import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import type { WorkoutLibrary } from "../application/ports";
import { parseSavedWorkout } from "../domain/savedWorkout";

export function createFirestoreWorkoutLibrary(db: Firestore, userId: string): WorkoutLibrary {
  const workouts = collection(db, "users", userId, "workouts");

  return {
    subscribe(onData, onError) {
      return onSnapshot(
        query(workouts, orderBy("createdAt", "desc")),
        (snapshot) => {
          onData(snapshot.docs.flatMap((item) => parseSavedWorkout(item.id, item.data()) ?? []));
        },
        onError,
      );
    },
    async save(draft) {
      await setDoc(doc(workouts), draft);
    },
    async remove(id) {
      await deleteDoc(doc(workouts, id));
    },
  };
}
