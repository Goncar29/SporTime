import { useEffect, useState } from "react";
import type { SubscribeToList } from "../application/liveList";

interface LiveList<T> {
  /** Null until the first answer arrives. */
  items: T[] | null;
  failed: boolean;
}

export function useLiveList<T>(subscribe: SubscribeToList<T>): LiveList<T> {
  const [state, setState] = useState<LiveList<T>>({ items: null, failed: false });

  useEffect(
    () =>
      subscribe(
        (items) => {
          setState({ items, failed: false });
        },
        () => {
          setState((current) => ({ ...current, failed: true }));
        },
      ),
    [subscribe],
  );

  return state;
}
