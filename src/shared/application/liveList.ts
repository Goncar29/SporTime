/** Reports the current items right away when known, then every change. Returns the unsubscribe function. */
export type SubscribeToList<T> = (
  onData: (items: T[]) => void,
  onError: (error: Error) => void,
) => () => void;
