import { registerSW } from "virtual:pwa-register";
import type { AppUpdater } from "../application/appUpdater";
import { connectUpdates } from "./connectUpdates";

/** An app left open, such as an installed one in the background, still looks for new versions. */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and applies each new version it downloads.
 * The new worker waits until the app applies it, so a running workout is never reloaded.
 */
export function startBrowserUpdates(): AppUpdater {
  return connectUpdates({
    register: registerSW,
    container: navigator.serviceWorker,
    reload: () => {
      window.location.reload();
    },
    onRegistered: (_url, registration) => {
      if (!registration) return;
      const check = () => {
        // Offline the check fails; the next one runs on the next visit or hour.
        registration.update().catch(() => undefined);
      };
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
      setInterval(check, CHECK_EVERY_MS);
    },
  });
}
