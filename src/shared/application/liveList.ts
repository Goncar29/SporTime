/** Reports the current items right away when known, then every change. Returns the unsubscribe function. */
export type SubscribeToList<T> = (
  onData: (items: T[]) => void,
  onError: (error: Error) => void,
) => () => void;

/**
 * A list read newest first that can be read only in part (T38): given `newest`, it reports at
 * most that many of the stored items, plus any this device holds that are not stored yet; without
 * it, every item, as a SubscribeToList does.
 */
export type SubscribeToNewest<T> = (
  onData: (items: T[]) => void,
  onError: (error: Error) => void,
  newest?: number,
) => () => void;
