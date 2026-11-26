import type { BlockedSenders } from "../application/ports";
import {
  byShownName,
  parseBlockedSender,
  toStoredBlockedSender,
  type BlockedSender,
} from "../domain/blockedSender";

/** Tests only: where a user's fake blocked list is kept, by sender uid. */
export const fakeBlockedKey = (uid: string) => `sportime.fakeBlocked.${uid}`;

/** Tests only: the senders `uid` blocked, as the rules ask the server. */
export function fakeBlockedOf(uid: string): BlockedSender[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(fakeBlockedKey(uid)) ?? "{}");
    if (typeof raw !== "object" || raw === null) return [];
    return Object.entries(raw).flatMap(([id, stored]) => parseBlockedSender(id, stored) ?? []);
  } catch {
    return [];
  }
}

/**
 * Tests only: keeps a user's blocked senders in localStorage, which the fake sharing reads to
 * refuse their copies like the rules. Never part of a production build.
 */
export function createFakeBlockedSenders(userId: string): BlockedSenders {
  const key = fakeBlockedKey(userId);
  const listeners = new Set<(items: BlockedSender[]) => void>();
  const write = (items: BlockedSender[]) => {
    localStorage.setItem(
      key,
      JSON.stringify(
        Object.fromEntries(items.map((item) => [item.uid, toStoredBlockedSender(item)])),
      ),
    );
    const sorted = [...items].sort(byShownName);
    listeners.forEach((listener) => {
      listener(sorted);
    });
  };

  const subscribe: BlockedSenders["subscribe"] = (onData) => {
    listeners.add(onData);
    onData(fakeBlockedOf(userId).sort(byShownName));
    return () => listeners.delete(onData);
  };

  return {
    subscribe,
    // The fake list is the server's own, so it is always answered.
    subscribeAnswered: subscribe,
    block(sender) {
      write([...fakeBlockedOf(userId).filter(({ uid }) => uid !== sender.uid), sender]);
      return Promise.resolve();
    },
    unblock(uid) {
      write(fakeBlockedOf(userId).filter((sender) => sender.uid !== uid));
      return Promise.resolve();
    },
  };
}
