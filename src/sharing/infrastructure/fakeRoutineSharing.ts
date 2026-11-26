import type { User } from "../../auth/domain/user";
import type { InboxWriter, RoutineSharing } from "../application/ports";
import { createRoutineSharing } from "../application/shareRoutine";
import type { SharedCopy } from "../domain/sharedCopy";
import { fakeBlockedOf } from "./fakeBlockedSenders";

/** Tests only: where a user's fake inbox is kept. */
export const fakeInboxKey = (uid: string) => `sportime.fakeInbox.${uid}`;

/** A copy as the fake server keeps it: with its time of arrival, as the rules set `sentAt`. */
export type FakeInboxCopy = SharedCopy & { sentAt: number };

const refused = (code: string) => Object.assign(new Error(`Refused: ${code}`), { code });

/** Tests only: the copies in a user's fake inbox, by copy id. */
export function fakeInboxOf(uid: string): Record<string, FakeInboxCopy> {
  try {
    return JSON.parse(localStorage.getItem(fakeInboxKey(uid)) ?? "{}") as Record<
      string,
      FakeInboxCopy
    >;
  } catch {
    return {};
  }
}

/** Whether the fake contact store of `owner` holds `contactUid`, as the rules ask the server. */
function hasContact(owner: string, contactUid: string): boolean {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(`sportime.fakeContacts.${owner}`) ?? "[]");
    return Array.isArray(raw) && raw.some((item) => (item as { uid?: unknown }).uid === contactUid);
  } catch {
    return false;
  }
}

/**
 * Tests only: sends copies to inboxes kept in localStorage, refusing like the rules (a recipient
 * who is not a contact or who blocked the sender, a copy id already used), with the signed-in user
 * as the sender. Never part of a production build.
 */
export function createFakeRoutineSharing(user: User): RoutineSharing {
  const inbox: InboxWriter = {
    create(recipientUid, copyId, copy) {
      if (!navigator.onLine) return Promise.reject(refused("unavailable"));
      const copies = fakeInboxOf(recipientUid);
      const blocked = fakeBlockedOf(recipientUid).some(({ uid }) => uid === user.id);
      if (copyId in copies || !hasContact(user.id, recipientUid) || blocked) {
        return Promise.reject(refused("permission-denied"));
      }
      const stored: FakeInboxCopy = { ...copy, sentAt: Date.now() };
      localStorage.setItem(
        fakeInboxKey(recipientUid),
        JSON.stringify({ ...copies, [copyId]: stored }),
      );
      return Promise.resolve();
    },
  };
  return createRoutineSharing({
    identity: {
      claims: () =>
        Promise.resolve({
          uid: user.id,
          email: user.email,
          emailVerified: true,
          name: user.name,
          ...(user.photoUrl === null ? {} : { picture: user.photoUrl }),
        }),
    },
    inbox,
    online: () => navigator.onLine,
  });
}
