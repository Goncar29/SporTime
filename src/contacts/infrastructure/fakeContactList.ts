import { fakeDirectoryEntry } from "../../directory/infrastructure/fakeDirectoryListing";
import { findContact, oneAtATime } from "../application/findContact";
import type { ContactList } from "../application/ports";
import { ContactRefused, byName, parseContact, type Contact } from "../domain/contact";

/**
 * Tests only: keeps contacts in localStorage and finds them in the fake directory, refusing like
 * the real list. Never part of a production build.
 */
export function createFakeContactList(userId: string): ContactList {
  const key = `sportime.fakeContacts.${userId}`;
  const listeners = new Set<(items: Contact[]) => void>();
  const serial = oneAtATime();

  const read = (): Contact[] => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(raw)
        ? raw.flatMap((item) => parseContact((item as Contact).uid, item) ?? [])
        : [];
    } catch {
      return [];
    }
  };
  const write = (items: Contact[]) => {
    localStorage.setItem(key, JSON.stringify(items));
    const sorted = [...items].sort(byName);
    listeners.forEach((listener) => {
      listener(sorted);
    });
  };

  return {
    subscribe(onData) {
      listeners.add(onData);
      onData(read().sort(byName));
      return () => listeners.delete(onData);
    },
    add: (email) =>
      serial(async () => {
        const contact = await findContact(email, {
          entryOf: (address) =>
            navigator.onLine
              ? Promise.resolve(fakeDirectoryEntry(address))
              : Promise.reject(new ContactRefused("offline")),
          current: () => Promise.resolve(read()),
          ownUid: userId,
        });
        write([...read(), contact]);
        return { contact, saved: Promise.resolve() };
      }),
    remove(uid) {
      write(read().filter((contact) => contact.uid !== uid));
      return Promise.resolve();
    },
  };
}
