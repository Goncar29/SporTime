import type { Routine } from "./routine";

/**
 * The in-app notice of new received routines (S7 "notificación", T27): a routine a contact sent is
 * new until the user has seen the routine list with it, on this device. Only ids are kept; one's
 * own routines are never new.
 */

/** The ids of the received routines among `routines` that are not in `seen`, in list order. */
export function unseenReceived(routines: readonly Routine[], seen: ReadonlySet<string>): string[] {
  return routines.flatMap(({ id, receivedFrom }) =>
    receivedFrom !== undefined && !seen.has(id) ? [id] : [],
  );
}

/**
 * The ids to keep as seen once the list showing `routines` was seen: every received routine in
 * it, and nothing of a routine deleted since.
 */
export function receivedIds(routines: readonly Routine[]): string[] {
  return routines.flatMap(({ id, receivedFrom }) => (receivedFrom === undefined ? [] : [id]));
}
