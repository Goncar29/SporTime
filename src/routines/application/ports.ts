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
  /**
   * Settles when the server answers, which never happens offline, so callers must not wait for it.
   * A routine received from a contact goes with its copy in the inbox, if any is left, so it
   * cannot be received again.
   */
  remove(id: string): Promise<void>;
}

/**
 * Which received routines the user has seen in the routine list (T27, S7), on this device only;
 * erased with the account's other data on this device.
 */
export interface SeenRoutines {
  /** The ids seen, or none when nothing usable is kept. */
  load(): string[];
  /** Replaces the ids kept. */
  save(ids: readonly string[]): void;
  erase(): void;
}

/** Keeps the routines received from contacts (T26, S12) among the user's own. */
export interface ReceivedRoutines {
  /**
   * Stores `routine` under its id unless a routine with that id is already stored (received
   * before, and maybe edited since), which is left as it is. Only the server decides, in one
   * write that creates it only if absent and is never held on this device to be sent later
   * (T29 W2): while the server cannot be reached, nothing is written.
   * Resolves only once the server holds that routine; rejects when it was refused.
   * Never settles offline.
   */
  receive(routine: Routine): Promise<void>;
}
