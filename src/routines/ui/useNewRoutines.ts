import { useEffect, useMemo, useState } from "react";
import type { SeenRoutines } from "../application/ports";
import { receivedIds, unseenReceived } from "../domain/newRoutines";
import type { Routine } from "../domain/routine";

export interface NewRoutines {
  /** How many received routines were never seen in the list; null while unknown or not kept. */
  count: number | null;
  /** The routines to mark New in the list now. */
  marked: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The in-app notice of new received routines (T27, S7). A received routine counts as new until
 * the routine list is shown with it; it is then kept as seen on this device (`seen`), and stays
 * marked New for as long as the Routines section is open (the list and the routines opened from
 * it), so the user can see which ones arrived. The marks go once the section is left.
 * Without `seen`, nothing is new.
 */
export function useNewRoutines(
  seen: SeenRoutines | undefined,
  routines: readonly Routine[] | null,
  { listShown, inSection }: { listShown: boolean; inSection: boolean },
): NewRoutines {
  const [seenIds, setSeenIds] = useState<ReadonlySet<string>>(() => new Set(seen?.load() ?? []));
  const [marked, setMarked] = useState<ReadonlySet<string>>(NONE);

  const unseen = useMemo(
    () => (seen && routines ? unseenReceived(routines, seenIds) : null),
    [seen, routines, seenIds],
  );

  useEffect(() => {
    if (!listShown || !seen || !routines || !unseen || unseen.length === 0) return;
    setMarked((current) => new Set([...current, ...unseen]));
    const ids = receivedIds(routines);
    seen.save(ids);
    setSeenIds(new Set(ids));
  }, [listShown, seen, routines, unseen]);

  useEffect(() => {
    if (!inSection) setMarked(NONE);
  }, [inSection]);

  // Those not kept as seen yet are marked too, so none shows unmarked before it is kept.
  const shown = useMemo(
    () => (inSection && unseen && unseen.length > 0 ? new Set([...marked, ...unseen]) : marked),
    [inSection, unseen, marked],
  );
  return { count: unseen?.length ?? null, marked: inSection ? shown : NONE };
}
