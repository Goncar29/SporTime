import type { Sender } from "../../routines/domain/routine";
import type { SubscribeToList } from "../../shared/application/liveList";
import { copySender, receivedRoutine } from "../domain/receivedCopy";
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
 * Each copy is tried at most once per receiver (one per signed-in page): one whose routine or
 * delete is refused is left in the inbox and reported in the developer's log, never written again
 * in a loop, and never holds up the others. The next page load tries it again.
 *
 * A copy this app cannot open (T29 W5: a newer version's, or one the rules accept but the app does
 * not) is never left unseen: when it says who sent it, it stays in the inbox and is reported to
 * the user by its sender, to delete it or block them; when it does not, nobody can be shown or
 * blocked for it, so it is deleted, logged once by id.
 *
 * A copy from a sender the user blocked (T27) is never received: it is deleted from the inbox
 * (the rules refuse their new copies, so only one sent before the block can be there), and so is
 * one that could not be opened once its sender is blocked. Nothing is received until the server
 * has answered the blocked list (a list from this device alone may miss a block made on another
 * device), nor at all once it cannot be read: the copies then wait in the inbox for the next page
 * load.
 */
export function createInboxReceiver({ inbox, routines, blocked }: Dependencies): InboxReceiving {
  /** Copies being received, received, or left alone: none is taken up twice. */
  const taken = new Set<string>();
  /** Copies that could not be opened, by id, with who sent them; kept across restarts. */
  const unopened = new Map<string, Sender>();
  /** Of those, the ones being deleted, which are no longer shown. */
  const discarding = new Set<string>();
  /** What the running listener last reported; refreshed by `discard`. */
  let refresh: () => void = () => undefined;

  const receive = async (copyId: string, data: unknown) => {
    const routine = receivedRoutine(copyId, data);
    if (routine === null) return;
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

  const discardBlocked = async (copyId: string) => {
    try {
      await inbox.remove(copyId);
    } catch (error) {
      console.error("A copy from a blocked sender could not be deleted:", copyId, error);
    }
  };

  const discardUnattributable = async (copyId: string) => {
    try {
      await inbox.remove(copyId);
    } catch (error) {
      console.error("A copy with no sender could not be deleted:", copyId, error);
    }
  };

  return {
    start(onUnopened) {
      /** Unknown (null) until the server first answers the blocked list; known without one. */
      let blockedUids: ReadonlySet<string> | null = blocked ? null : new Set();
      let failed = false;
      let latest: InboxCopy[] = [];

      /** The copies that could not be opened, still in the inbox and not being deleted. */
      const report = () => {
        onUnopened?.(
          latest.flatMap(({ id }) => {
            const sender = unopened.get(id);
            return sender === undefined || discarding.has(id) ? [] : [{ id, sender }];
          }),
        );
      };

      const take = () => {
        if (blockedUids === null || failed) return;
        for (const { id, data } of latest) {
          const unopenedFrom = unopened.get(id);
          if (unopenedFrom !== undefined) {
            // Blocked since it was shown: deleted like any of their copies.
            if (blockedUids.has(unopenedFrom.uid) && !discarding.has(id)) {
              discarding.add(id);
              void discardBlocked(id);
            }
            continue;
          }
          if (taken.has(id)) continue;
          taken.add(id);
          const sender = senderOf(data);
          if (sender !== null && blockedUids.has(sender)) {
            void discardBlocked(id);
          } else if (receivedRoutine(id, data) !== null) {
            void receive(id, data);
          } else {
            const from = copySender(data);
            if (from === null) {
              // By id only: the copy holds another user's text.
              console.error("A routine in the inbox has no sender it can name; it is deleted:", id);
              void discardUnattributable(id);
            } else {
              console.error("A routine in the inbox cannot be opened; it is shown:", id);
              unopened.set(id, from);
            }
          }
        }
        report();
      };
      refresh = report;

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
        if (refresh === report) refresh = () => undefined;
      };
    },
    async discard(copyId) {
      discarding.add(copyId);
      refresh();
      try {
        await inbox.remove(copyId);
      } catch (error) {
        discarding.delete(copyId);
        refresh();
        throw error;
      }
    },
  };
}
