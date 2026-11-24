import type { DirectoryListing } from "../application/ports";
import { directoryEntryFor, normalizeEmail } from "../domain/directory";

const keyOf = (email: string) => `sportime.fakeDirectory.${normalizeEmail(email)}`;

/** Keeps the entry in localStorage, so it outlives a reload like the server's would. */
export function createFakeDirectoryListing(account: {
  id: string;
  name: string;
  email: string;
  photoUrl: string | null;
}): DirectoryListing {
  const key = keyOf(account.email);
  const listeners = new Set<(listed: boolean) => void>();
  const listed = () => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null && (JSON.parse(raw) as { uid?: unknown }).uid === account.id;
    } catch {
      return false;
    }
  };
  const notify = () => {
    const now = listed();
    listeners.forEach((listener) => {
      listener(now);
    });
  };

  return {
    subscribe(onListed) {
      listeners.add(onListed);
      onListed(listed());
      return () => listeners.delete(onListed);
    },
    list() {
      localStorage.setItem(key, JSON.stringify(directoryEntryFor(account)));
      notify();
      return Promise.resolve();
    },
    unlist() {
      if (listed()) localStorage.removeItem(key);
      notify();
      return Promise.resolve();
    },
  };
}
