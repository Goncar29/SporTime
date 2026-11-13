import { useEffect, useState } from "react";
import type { SubscribeToList } from "../application/liveList";
import type { StoreFailureKind } from "../domain/storeFailure";
import { reportStoreFailure } from "./storeFailure";

interface LiveList<T> {
  /** Null until the first answer arrives. */
  items: T[] | null;
  failed: boolean;
  /** Why the last read failed, when it did. */
  failure: StoreFailureKind | null;
}

/** `operation` names the read in the developer's log, such as "Loading the history". */
export function useLiveList<T>(subscribe: SubscribeToList<T>, operation: string): LiveList<T> {
  const [state, setState] = useState<LiveList<T>>({ items: null, failed: false, failure: null });

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
    [subscribe, operation],
  );

  return state;
}
