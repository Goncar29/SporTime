import { createFakeStoredList } from "../../shared/infrastructure/fakeStoredList";
import type { RoutineLibrary } from "../application/ports";
import type { Routine, RoutineDraft } from "../domain/routine";

export function createFakeRoutineLibrary(userId: string): RoutineLibrary {
  const list = createFakeStoredList<RoutineDraft, Routine>(
    `sportime.fakeRoutines.${userId}`,
    (a, b) => b.createdAt - a.createdAt,
  );
  return { subscribe: list.subscribe, save: list.add, update: list.update, remove: list.remove };
}
