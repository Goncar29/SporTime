/** Applies a new version of the app as soon as it is ready, but never in the middle of a workout. */
export interface AppUpdater {
  /** A new version is downloaded and waiting to take over. */
  ready: () => void;
  /** True while reloading would interrupt something, such as a running workout's timer. */
  setBusy: (busy: boolean) => void;
}

/** `apply` switches to the waiting version, which reloads the page. */
export function createAppUpdater(apply: () => void): AppUpdater {
  let waiting = false;
  let busy = false;
  let applied = false;

  const applyWhenFree = () => {
    if (!waiting || busy || applied) return;
    applied = true;
    apply();
  };

  return {
    ready() {
      waiting = true;
      applyWhenFree();
    },
    setBusy(next) {
      busy = next;
      applyWhenFree();
    },
  };
}
