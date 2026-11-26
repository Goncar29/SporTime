import type { SeenRoutines } from "../application/ports";

/** Where an account's seen received routines are kept on this device. */
export const seenRoutinesKey = (userId: string) => `sportime.seenRoutines.${userId}`;

/**
 * Which received routines the user has seen (T27), kept in this browser only: another device
 * shows them as new until they are seen there too. Erased with the rest of the account's data on
 * this device when signing out or deleting the account.
 */
export function createLocalStorageSeenRoutines(userId: string): SeenRoutines {
  const key = seenRoutinesKey(userId);
  return {
    load() {
      try {
        const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
        return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
      } catch {
        return [];
      }
    },
    save(ids) {
      try {
        localStorage.setItem(key, JSON.stringify(ids));
      } catch (error) {
        // Storage full or blocked: the routines simply show as new again next time.
        console.warn("Could not keep which received routines were seen:", error);
      }
    },
    erase() {
      localStorage.removeItem(key);
    },
  };
}
