import type { SoundSettingsStore } from "../application/ports";

const KEY = "sportime.soundSettings";

/** Storage can be blocked or full; the settings then simply are not remembered. */
export const localStorageSoundSettingsStore: SoundSettingsStore = {
  get() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(settings) {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Nothing to do: the choice still applies for this visit.
    }
  },
};
