import type { LanguageStore } from "../application/ports";

const KEY = "sportime.language";

/** Storage can be blocked or full; the language then simply is not remembered. */
export const localStorageLanguageStore: LanguageStore = {
  get() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(language) {
    try {
      localStorage.setItem(KEY, language);
    } catch {
      // Nothing to do: the choice still applies for this visit.
    }
  },
};
