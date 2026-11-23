import type { SubscribeToList } from "../../shared/application/liveList";
import type { Routine, RoutineDraft } from "../domain/routine";

/** One user's routines, newest first. Writes apply locally right away and sync when online. */
export interface RoutineLibrary {
  subscribe: SubscribeToList<Routine>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  save(draft: RoutineDraft): Promise<void>;
  /**
   * Replaces a routine's name, notes and stages; its id and createdAt, and so its place in the
   * list, stay. Settles when the server answers, so callers must not wait for it.
   */
  update(routine: Routine): Promise<void>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  remove(id: string): Promise<void>;
}
