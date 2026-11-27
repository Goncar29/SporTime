import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubscribeToNewest } from "../application/liveList";
import { reportStoreFailure } from "./storeFailure";
import type { LiveList } from "./useLiveList";

/** How many items a long list shows at first, and how many more each Show more adds (T38). */
export const PAGE_SIZE = 20;

export interface NewestList<T> extends LiveList<T> {
  /** Whether older items are left to show. */
  hasMore: boolean;
  /**
   * Shows up to a page more. Until the bigger read answers, what is shown stays; pressing it again
   * meanwhile, or when nothing is left, does nothing.
   */
  showMore: () => void;
}

interface Shown<T> extends LiveList<T> {
  hasMore: boolean;
}

/**
 * Whether `item`, missing from `list`, may only have moved past the newest shown, pushed by newer
 * ones, rather than been deleted: older items are left, and it is no newer than the oldest shown.
 */
export function mayBeOlder<T extends { createdAt: number }>(
  list: Pick<NewestList<T>, "items" | "hasMore">,
  item: T,
): boolean {
  const oldest = list.items?.at(-1);
  return list.hasMore && oldest !== undefined && item.createdAt <= oldest.createdAt;
}

const loading = <T>(): Shown<T> => ({ items: null, failed: false, failure: null, hasMore: false });

/**
 * A list read newest first a page at a time (T38): it reads one item more than it shows, so it
 * knows whether to offer more without another read. Live like useLiveList: changes, deletions that
 * bring older items into view, and writes this device still holds show as they happen.
 * `operation` names the read in the developer's log, such as "Loading saved workouts".
 */
export function useNewestList<T>(
  subscribe: SubscribeToNewest<T>,
  operation: string,
  pageSize = PAGE_SIZE,
): NewestList<T> {
  const [wanted, setWanted] = useState(pageSize);
  const [state, setState] = useState<Shown<T>>(loading);
  // Read by showMore, which keeps one identity: how many the last answer was for, and whether more
  // were left then.
  const answered = useRef({ count: 0, hasMore: false });

  useEffect(
    () =>
      subscribe(
        (items) => {
          const hasMore = items.length > wanted;
          answered.current = { count: wanted, hasMore };
          setState({ items: items.slice(0, wanted), failed: false, failure: null, hasMore });
        },
        (error: unknown) => {
          const failure = reportStoreFailure(operation, error);
          setState((current) => ({ ...current, failed: true, failure }));
        },
        wanted + 1,
      ),
    [subscribe, operation, wanted],
  );

  const showMore = useCallback(() => {
    setWanted((current) =>
      answered.current.count === current && answered.current.hasMore ? current + pageSize : current,
    );
  }, [pageSize]);

  // The same object until the list changes, so callers may depend on it.
  return useMemo(() => ({ ...state, showMore }), [state, showMore]);
}
