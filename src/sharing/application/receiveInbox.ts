import type { SubscribeToList } from "../../shared/application/liveList";
import { receivedRoutine } from "../domain/receivedCopy";
import type { InboxCopy, InboxReader, InboxReceiving, ReceivedRoutineStore } from "./ports";

interface Dependencies {
  inbox: InboxReader;
  routines: ReceivedRoutineStore;
  /**
   * Who the user blocked (T27), as the server answered it; a copy one of them sent is deleted
   * instead of received. Without it, every copy is received.
   */
  blocked?: { subscribeAnswered: SubscribeToList<{ uid: string }> };
}

/** Who sent a copy, as the inbox rules bound it to the writer's sign-in; null when unreadable. */
function senderOf(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const { fromUid } = data as { fromUid?: unknown };
  return typeof fromUid === "string" ? fromUid : null;
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
 *
 * A copy from a sender the user blocked (T27) is never received: it is deleted from the inbox
 * (the rules refuse their new copies, so only one sent before the block can be there). Nothing is
 * received until the server has answered the blocked list (a list from this device alone may miss
 * a block made on another device), nor at all once it cannot be read: the copies then wait in the
 * inbox for the next page load.
 */
export function createInboxReceiver({ inbox, routines, blocked }: Dependencies): InboxReceiving {
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

  const discard = async (copyId: string) => {
    try {
      await inbox.remove(copyId);
    } catch (error) {
      console.error("A copy from a blocked sender could not be deleted:", copyId, error);
    }
  };

  return {
    start() {
      /** Unknown (null) until the server first answers the blocked list; known without one. */
      let blockedUids: ReadonlySet<string> | null = blocked ? null : new Set();
      let failed = false;
      let latest: InboxCopy[] = [];

      const take = () => {
        if (blockedUids === null || failed) return;
        for (const { id, data } of latest) {
          if (taken.has(id)) continue;
          taken.add(id);
          const sender = senderOf(data);
          if (sender !== null && blockedUids.has(sender)) void discard(id);
          else void receive(id, data);
        }
      };

      const stopBlocked = blocked?.subscribeAnswered(
        (items) => {
          blockedUids = new Set(items.map(({ uid }) => uid));
          take();
        },
        (error) => {
          failed = true;
          console.error("The blocked senders could not be read; nothing is received:", error);
        },
      );
      const stopInbox = inbox.subscribe(
        (copies) => {
          latest = copies;
          take();
        },
        (error) => {
          console.error("The inbox could not be read:", error);
        },
      );
      return () => {
        stopInbox();
        stopBlocked?.();
      };
    },
  };
}
