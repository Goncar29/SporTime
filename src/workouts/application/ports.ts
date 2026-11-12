import type { SubscribeToList } from "../../shared/application/liveList";
import type { SavedWorkout, SavedWorkoutDraft } from "../domain/savedWorkout";

/** One user's saved workouts, newest first. Writes apply locally right away and sync when online. */
export interface WorkoutLibrary {
  subscribe: SubscribeToList<SavedWorkout>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  save(draft: SavedWorkoutDraft): Promise<void>;
  /**
   * Replaces a saved workout's name and settings; its id and createdAt, and so its place in the
   * list, stay. Settles when the server answers, so callers must not wait for it.
   */
  update(workout: SavedWorkout): Promise<void>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  remove(id: string): Promise<void>;
}
