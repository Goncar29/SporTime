import { createFakeStoredList } from "../../shared/infrastructure/fakeStoredList";
import type { ReceivedRoutines, RoutineLibrary } from "../application/ports";
import type { Routine, RoutineDraft } from "../domain/routine";

export function createFakeRoutineLibrary(userId: string): RoutineLibrary & ReceivedRoutines {
  const key = `sportime.fakeRoutines.${userId}`;
  const list = createFakeStoredList<RoutineDraft, Routine>(
    key,
    (a, b) => b.createdAt - a.createdAt,
  );
  const stored = (): Routine[] => JSON.parse(localStorage.getItem(key) ?? "[]") as Routine[];
  return {
    subscribe: list.subscribe,
    save: list.add,
    update: list.update,
    remove: list.remove,
    receive(routine) {
      // Under its own id, once: one already there, maybe edited since, stays as it is.
      if (stored().some(({ id }) => id === routine.id)) return Promise.resolve();
      localStorage.setItem(key, JSON.stringify([...stored(), routine]));
      // The list tells its listeners about an update, which now finds the routine.
      return list.update(routine);
    },
  };
}
