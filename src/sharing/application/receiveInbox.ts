import { receivedRoutine } from "../domain/receivedCopy";
import type { InboxReader, InboxReceiving, ReceivedRoutineStore } from "./ports";

interface Dependencies {
  inbox: InboxReader;
  routines: ReceivedRoutineStore;
}

/**
 * Moves each copy in the inbox into the user's routines ("Se guarda automáticamente", S7), then
 * deletes it from the inbox (T26, S12). The routine takes the copy's id, so receiving a copy
 * twice (two tabs, a retry, a page closed before the delete) never makes two routines; the copy
 * is deleted only once the server holds the routine, so a sign-out, crash or reload in between
 * leaves it in the inbox to be received again.
 *
 * Each copy is tried at most once per receiver (one per signed-in page): one that cannot become a
 * routine, or whose routine or delete is refused, is left in the inbox and reported in the
 * developer's log, never written again in a loop, and never holds up the others. The next page
 * load tries it again.
 */
export function createInboxReceiver({ inbox, routines }: Dependencies): InboxReceiving {
  /** Copies being received, received, or left alone: none is taken up twice. */
  const taken = new Set<string>();

  const receive = async (copyId: string, data: unknown) => {
    const routine = receivedRoutine(copyId, data);
    if (routine === null) {
      // By id only: the copy holds another user's text.
      console.error("A routine in the inbox cannot be received; it stays there:", copyId);
      return;
    }
    try {
      await routines.receive(routine);
    } catch (error) {
      console.error("A received routine could not be stored; its copy stays:", copyId, error);
      return;
    }
    try {
      await inbox.remove(copyId);
    } catch (error) {
      console.error("A received routine's copy could not be deleted:", copyId, error);
    }
  };

  return {
    start() {
      return inbox.subscribe(
        (copies) => {
          for (const { id, data } of copies) {
            if (taken.has(id)) continue;
            taken.add(id);
            void receive(id, data);
          }
        },
        (error) => {
          console.error("The inbox could not be read:", error);
        },
      );
    },
  };
}
