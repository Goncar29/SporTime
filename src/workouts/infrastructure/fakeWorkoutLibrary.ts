import { createFakeStoredList } from "../../shared/infrastructure/fakeStoredList";
import type { WorkoutLibrary } from "../application/ports";
import type { SavedWorkout, SavedWorkoutDraft } from "../domain/savedWorkout";

export function createFakeWorkoutLibrary(userId: string): WorkoutLibrary {
  const list = createFakeStoredList<SavedWorkoutDraft, SavedWorkout>(
    `sportime.fakeWorkouts.${userId}`,
    (a, b) => b.createdAt - a.createdAt,
  );
  return { subscribe: list.subscribe, save: list.add, remove: list.remove };
}
