import type { User } from "../../auth/domain/user";
import type { InboxWriter, RoutineSharing } from "../application/ports";
import { createRoutineSharing } from "../application/shareRoutine";
import type { SharedCopy } from "../domain/sharedCopy";

const inboxKey = (uid: string) => `sportime.fakeInbox.${uid}`;

const refused = (code: string) => Object.assign(new Error(`Refused: ${code}`), { code });

/** Tests only: the copies in a user's fake inbox, by copy id. */
export function fakeInboxOf(uid: string): Record<string, SharedCopy> {
  try {
    return JSON.parse(localStorage.getItem(inboxKey(uid)) ?? "{}") as Record<string, SharedCopy>;
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
 * who is not a contact, a copy id already used), with the signed-in user as the sender. Never
 * part of a production build.
 */
export function createFakeRoutineSharing(user: User): RoutineSharing {
  const inbox: InboxWriter = {
    create(recipientUid, copyId, copy) {
      if (!navigator.onLine) return Promise.reject(refused("unavailable"));
      const copies = fakeInboxOf(recipientUid);
      if (copyId in copies || !hasContact(user.id, recipientUid)) {
        return Promise.reject(refused("permission-denied"));
      }
      localStorage.setItem(inboxKey(recipientUid), JSON.stringify({ ...copies, [copyId]: copy }));
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
