import { directoryName, isGooglePhoto } from "../../directory/domain/directory";

/**
 * A contact is another user found in the directory, kept at `users/{uid}/contacts/{contact uid}`.
 * Limits mirror the rules for that path in firestore/firestore.rules; firestore/rules.test.ts
 * keeps them in step. The rules cannot count documents, so only the app keeps the 50.
 */
export const CONTACT_LIMITS = { contacts: 50, emailLength: 254, uidLength: 128 } as const;

/** What the directory said about a user when they were added, under the email used to add them. */
export interface Contact {
  /** Also the document's id. */
  uid: string;
  /** Google's display name, or empty. */
  name: string;
  /** An https photo on googleusercontent.com, or empty. */
  photo: string;
  /** The normalized address they were added by, which is their directory entry's id. */
  email: string;
}

/** Exactly what is written; nothing else is sent. */
export type StoredContact = Contact;

/** Why a contact cannot be added, in the terms the user is told. */
export type ContactRefusal =
  | "invalidEmail"
  /** Nobody chose to be found by that email. */
  | "notListed"
  | "self"
  | "duplicate"
  /** Already CONTACT_LIMITS.contacts contacts. */
  | "full"
  /** The directory can only be asked with a connection. */
  | "offline";

export class ContactRefused extends Error {
  constructor(
    readonly kind: ContactRefusal,
    options?: { cause?: unknown },
  ) {
    super(`The contact cannot be added: ${kind}`, options);
    this.name = "ContactRefused";
  }
}

/** One @ with something on each side, no space, slash or control character; the rules agree. */
const EMAIL = /^[^\p{Cc}\p{Z}/@]+@[^\p{Cc}\p{Z}/@]+$/u;

/** Whether a normalized email (normalizeEmail) can be looked up and stored. */
export function isContactEmail(email: string): boolean {
  return email.length <= CONTACT_LIMITS.emailLength && EMAIL.test(email);
}

/** A user id that is also a valid document id. */
function isUid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CONTACT_LIMITS.uidLength &&
    !value.includes("/")
  );
}

function sanitize(raw: unknown, email: unknown): Contact | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { uid, name, photo } = raw as Record<string, unknown>;
  if (!isUid(uid) || typeof email !== "string" || !isContactEmail(email)) return null;
  return {
    uid,
    name: directoryName(name),
    photo: typeof photo === "string" && isGooglePhoto(photo) ? photo : "",
    email,
  };
}

/** The contact a directory entry stands for, under the normalized email it was found by. */
export function contactFromEntry(email: string, entry: unknown): Contact | null {
  return sanitize(entry, email);
}

/** A stored contact, or null when it is not one; its id must be its uid. */
export function parseContact(id: string, raw: unknown): Contact | null {
  const contact = sanitize(raw, (raw as { email?: unknown } | null)?.email);
  return contact?.uid === id ? contact : null;
}

export function toStoredContact(contact: Contact): StoredContact {
  const { uid, name, photo, email } = contact;
  return {
    uid,
    name: directoryName(name),
    photo: isGooglePhoto(photo) ? photo : "",
    email,
  };
}

/** Why `candidate` cannot join `contacts` for the account `ownUid`, or null when it can. */
export function refuseNewContact(
  contacts: readonly Contact[],
  candidate: Contact,
  ownUid: string,
): ContactRefusal | null {
  if (candidate.uid === ownUid) return "self";
  if (contacts.some(({ uid }) => uid === candidate.uid)) return "duplicate";
  if (contacts.length >= CONTACT_LIMITS.contacts) return "full";
  return null;
}

/** By the name shown, which is the email when there is no name. */
export function byName(a: Contact, b: Contact): number {
  return (
    (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: "base" }) ||
    a.email.localeCompare(b.email)
  );
}
