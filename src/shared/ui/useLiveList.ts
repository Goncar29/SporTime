import { useCallback, useEffect, useMemo, useState } from "react";
import type { SubscribeToList } from "../application/liveList";
import type { StoreFailureKind } from "../domain/storeFailure";
import { reportStoreFailure } from "./storeFailure";

export interface LiveList<T> {
  /** Null until the first answer arrives. */
  items: T[] | null;
  failed: boolean;
  /** Why the last read failed, when it did. */
  failure: StoreFailureKind | null;
}

export interface RetryableLiveList<T> extends LiveList<T> {
  /**
   * Subscribes again. A store's listener stops for good after an error, so a failed read only
   * recovers this way; until the new answer the list is loading, neither failed nor stale.
   */
  retry: () => void;
}

/** Nothing read yet. */
const loading = <T>(): LiveList<T> => ({ items: null, failed: false, failure: null });

/** `operation` names the read in the developer's log, such as "Loading the history". */
export function useLiveList<T>(
  subscribe: SubscribeToList<T>,
  operation: string,
): RetryableLiveList<T> {
  const [state, setState] = useState<LiveList<T>>(loading);
  const [attempt, setAttempt] = useState(0);

  useEffect(
    () =>
      subscribe(
        (items) => {
          setState({ items, failed: false, failure: null });
        },
        (error: unknown) => {
          const failure = reportStoreFailure(operation, error);
          setState((current) => ({ ...current, failed: true, failure }));
        },
      ),
    [subscribe, operation, attempt],
  );

  const retry = useCallback(() => {
    setState(loading);
    setAttempt((current) => current + 1);
  }, []);

  // The same object until the list changes, so callers may depend on it.
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
