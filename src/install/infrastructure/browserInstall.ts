import type { InstallController, InstallDismissals } from "../application/ports";
import { isIos, type InstallState } from "../domain/install";

/** Chrome's install offer; not in TypeScript's DOM types. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface BrowserEnvironment extends EventTarget {
  matchMedia(query: string): { matches: boolean };
  navigator: { userAgent: string; maxTouchPoints: number; standalone?: boolean };
}

/**
 * Must run before the app finishes loading: Chrome may offer the install right away, and an
 * offer nobody listened for is gone until the next visit.
 */
export function createBrowserInstall(env: BrowserEnvironment = window): InstallController {
  const listeners = new Set<() => void>();
  // Safari on iOS has its own flag for a home-screen app.
  const runsInstalled =
    env.matchMedia("(display-mode: standalone)").matches || env.navigator.standalone === true;
  let offer: InstallPromptEvent | null = null;
  let installed = runsInstalled;

  const changed = () => {
    listeners.forEach((listener) => {
      listener();
    });
  };

  env.addEventListener("beforeinstallprompt", (event) => {
    // Keeps the browser's own mini banner away; the app offers it at a better moment.
    event.preventDefault();
    offer = event as InstallPromptEvent;
    changed();
  });
  env.addEventListener("appinstalled", () => {
    installed = true;
    offer = null;
    changed();
  });

  const state = (): InstallState => {
    if (installed) return "installed";
    if (offer) return "prompt";
    return isIos(env.navigator) ? "ios" : "unavailable";
  };

  return {
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async install() {
      const current = offer;
      if (!current) return "unavailable";
      // Chrome allows one prompt per offer, so it is used up even if the dialog never shows.
      offer = null;
      try {
        await current.prompt();
        const { outcome } = await current.userChoice;
        return outcome;
      } finally {
        changed();
      }
    },
  };
}

const DISMISSED_KEY = "sportime.installDismissedAt";

/** Storage can be unavailable or full; then the notice simply shows again next time. */
export const localStorageInstallDismissals: InstallDismissals = {
  get() {
    try {
      const value = Number(localStorage.getItem(DISMISSED_KEY));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  },
  set(at) {
    try {
      localStorage.setItem(DISMISSED_KEY, String(at));
    } catch {
      // Nothing to do: the notice comes back on the next visit.
    }
  },
};
