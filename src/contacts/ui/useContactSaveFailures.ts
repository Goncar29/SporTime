import { useCallback, useMemo, useRef, useState } from "react";
import type { StoreFailureKind } from "../../shared/domain/storeFailure";
import { reportStoreFailure } from "../../shared/ui/storeFailure";
import type { AddedContact } from "../application/ports";
import type { Contact } from "../domain/contact";

/** A contact added on this device that the server later refused, by the add that kept it. */
export interface ContactSaveFailure {
  attempt: number;
  contact: Contact;
  kind: StoreFailureKind;
}

export interface ContactSaveFailures {
  /** The refusals not yet let go, oldest first. */
  failures: ContactSaveFailure[];
  /**
   * Watches an add's server answer. A refusal is kept unless a later add kept the same contact
   * again; a new add of a contact drops that contact's earlier refusal.
   */
  track: (added: AddedContact) => void;
  /** Lets go of the refusals shown so far. */
  clear: () => void;
}

/**
 * Late server refusals of contacts added here. Held by whoever outlives the Contacts screen, so a
 * refusal that arrives after leaving it is still shown when it opens again.
 */
export function useContactSaveFailures(): ContactSaveFailures {
  const [failures, setFailures] = useState<ContactSaveFailure[]>([]);
  const attempts = useRef(0);
  /** The latest add that kept each contact, so an older add's late refusal is not told. */
  const latestAdd = useRef(new Map<string, number>());

  const track = useCallback(({ contact, saved }: AddedContact) => {
    attempts.current += 1;
    const attempt = attempts.current;
    latestAdd.current.set(contact.uid, attempt);
    setFailures((current) => current.filter((failure) => failure.contact.uid !== contact.uid));
    // Not awaited: the server never answers offline, and the contact is already kept here.
    saved.catch((error: unknown) => {
      const kind = reportStoreFailure("Saving a contact", error);
      if (latestAdd.current.get(contact.uid) !== attempt) return;
      setFailures((current) => [
        ...current.filter((failure) => failure.contact.uid !== contact.uid),
        { attempt, contact, kind },
      ]);
    });
  }, []);

  const clear = useCallback(() => {
    setFailures((current) => (current.length === 0 ? current : []));
  }, []);

  return useMemo(() => ({ failures, track, clear }), [failures, track, clear]);
}
