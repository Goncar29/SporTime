import {
  isSenderEmail,
  isSenderName,
  isSenderUid,
  senderName,
  type Sender,
} from "../../routines/domain/routine";

/**
 * Someone the user blocked from sending them routines (S7 "block sender", T27), kept at
 * `users/{uid}/blocked/{sender uid}`. Blocked by the uid the inbox rules bind to the sender's
 * sign-in, so a block cannot be dodged by a changed name; the name and email are those the
 * received routine showed when blocking, kept only to show the list. firestore/firestore.rules
 * (isBlockedSender) checks them as it checks a routine's sender.
 */
export type BlockedSender = Sender;

/** Exactly what is written; the uid is the document's id. */
export interface StoredBlockedSender {
  name: string;
  email: string;
}

/** Who blocking the sender of a received routine names. */
export function blockedSenderOf({ uid, name, email }: Sender): BlockedSender {
  return { uid, name, email };
}

export function toStoredBlockedSender({ name, email }: BlockedSender): StoredBlockedSender {
  return { name, email };
}

/**
 * A stored blocked sender (or one an outbox holds), under its id; null when it is not one. A name
 * that cannot be shown is read as no name, as for a routine's sender.
 */
export function parseBlockedSender(id: string, raw: unknown): BlockedSender | null {
  if (typeof raw !== "object" || raw === null || !isSenderUid(id)) return null;
  const { name, email } = raw as Record<string, unknown>;
  if (!isSenderEmail(email)) return null;
  return { uid: id, name: isSenderName(name) ? name : "", email };
}

/** The name to show for them, which is their email when the name shows nothing. */
export function shownSenderName(sender: BlockedSender): string {
  return senderName(sender) ?? sender.email;
}

/** By the name shown, then by email. */
export function byShownName(a: BlockedSender, b: BlockedSender): number {
  return (
    shownSenderName(a).localeCompare(shownSenderName(b), undefined, { sensitivity: "base" }) ||
    a.email.localeCompare(b.email)
  );
}

/** Whether `uid` is blocked; never while the list is unknown (null). */
export function isBlocked(blocked: readonly BlockedSender[] | null, uid: string): boolean {
  return blocked?.some((sender) => sender.uid === uid) ?? false;
}
