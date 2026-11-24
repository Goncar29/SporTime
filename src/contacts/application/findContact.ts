import { normalizeEmail } from "../../directory/domain/directory";
import {
  ContactRefused,
  contactFromEntry,
  isContactEmail,
  refuseNewContact,
  type Contact,
} from "../domain/contact";

interface Lookup {
  /** The directory entry stored under a normalized email, or null when there is none. */
  entryOf: (email: string) => Promise<unknown>;
  /** The account's contacts, including those still on their way to the server. */
  current: () => Promise<Contact[]>;
  ownUid: string;
}

/** Who an email added as a contact stands for; rejects with `ContactRefused` when nobody may be added. */
export async function findContact(
  email: string,
  { entryOf, current, ownUid }: Lookup,
): Promise<Contact> {
  const address = normalizeEmail(email);
  if (!isContactEmail(address)) throw new ContactRefused("invalidEmail");
  const entry = await entryOf(address);
  const contact = entry === null ? null : contactFromEntry(address, entry);
  if (!contact) throw new ContactRefused("notListed");
  const refusal = refuseNewContact(await current(), contact, ownUid);
  if (refusal) throw new ContactRefused(refusal);
  return contact;
}

/** Runs one add at a time, so two at once never both pass the checks. */
export function oneAtATime(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve();
  return (work) => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
}
