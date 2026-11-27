/** Whether this device has a network, as the browser reports it. */
export interface Connectivity {
  /** False only when the browser knows there is no network (navigator.onLine). */
  isOnline: () => boolean;
  /** Settles at once when online, otherwise on the browser's next 'online' event. */
  whenOnline: () => Promise<void>;
}

/** The browser's own report: navigator.onLine and the window's 'online' event. */
export const browserConnectivity: Connectivity = {
  isOnline: () => navigator.onLine,
  whenOnline: () =>
    navigator.onLine
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          window.addEventListener("online", () => resolve(), { once: true });
        }),
};
