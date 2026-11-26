import {
  collection,
  deleteDoc,
  doc,
  getDocFromCache,
  onSnapshot,
  setDoc,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { withOutbox, type HeldWrites, type OutboxStore } from "../../shared/application/outbox";
import { isInLocalCache } from "../../shared/firebase/localCache";
import type { BlockedSenders } from "../application/ports";
import {
  byShownName,
  parseBlockedSender,
  toStoredBlockedSender,
  type BlockedSender,
} from "../domain/blockedSender";

interface Durability {
  store: OutboxStore<BlockedSender>;
  whenReady: () => Promise<boolean>;
  /**
   * Runs a change until it is stored on this device, holding off a sign-out in another tab, or
   * refuses it. Without one, changes run at once.
   */
  guard?: <T>(write: () => Promise<T>) => Promise<T>;
}

const runAtOnce = <T>(write: () => Promise<T>) => write();

/** The outbox knows items by `id`, which for a blocked sender is their uid. */
type Held = BlockedSender & { id: string };

const held = (id: string, raw: unknown): Held | null => {
  const sender = parseBlockedSender(id, raw);
  return sender && { ...sender, id };
};

const withoutId = (items: Held[]): BlockedSender[] => items.map(({ id: _id, ...sender }) => sender);

/** The server's answer, kept apart so the guard does not wait for it. */
function answerLater(answer: Promise<void>): { answer: Promise<void> } {
  // Read after the guard ends; until then a refusal must not count as unhandled.
  answer.catch(() => undefined);
  return { answer };
}

/**
 * The senders the user blocked (T27), at `users/{userId}/blocked/{sender uid}`, kept like contacts
 * through the outbox: a block is held on this device until Firestore's cache has it, so a page
 * closed during Auth's start-up or a lost connection never loses it, and it counts here at once.
 */
export function createFirestoreBlockedSenders(
  db: Firestore,
  userId: string,
  { store, whenReady, guard = runAtOnce }: Durability,
): BlockedSenders & HeldWrites {
  const blocked = collection(db, "users", userId, "blocked");
  /** Firestore answers in order, so once this read answers, the change before it is in the cache. */
  const inLocalCache = (ref: DocumentReference) => getDocFromCache(ref).catch(() => undefined);

  const outbox = withOutbox<Held, BlockedSender>({
    store,
    whenReady,
    parse: held,
    newestFirst: byShownName,
    collection: {
      subscribe(onData, onError) {
        return onSnapshot(
          blocked,
          (snapshot) => {
            onData(snapshot.docs.flatMap((item) => held(item.id, item.data()) ?? []));
          },
          onError,
        );
      },
      newId: () => doc(blocked).id,
      async put(id, sender) {
        await setDoc(doc(blocked, id), toStoredBlockedSender(sender));
      },
      has: (id) => isInLocalCache(() => getDocFromCache(doc(blocked, id))),
    },
  });

  return {
    subscribe: (onData, onError) =>
      outbox.subscribe((items) => {
        onData(withoutId(items));
      }, onError),
    /**
     * The outbox reports held blocks and cached lists before Firestore answers, which may miss a
     * block made on another device. This waits for a list the server answered, like the inbox
     * reader, and adds this device's list (held blocks and its cache) on top, so a block made here
     * counts at once and an unblock made here counts once the server has it.
     */
    subscribeAnswered(onData, onError) {
      let answered: BlockedSender[] | null = null;
      let onDevice: BlockedSender[] = [];
      const report = () => {
        if (answered === null) return;
        const byUid = new Map([...answered, ...onDevice].map((sender) => [sender.uid, sender]));
        onData([...byUid.values()].sort(byShownName));
      };
      const stopServer = onSnapshot(
        blocked,
        // So an answer first read from the cache is reported again once the server confirms it.
        { includeMetadataChanges: true },
        (snapshot) => {
          if (snapshot.metadata.fromCache) return;
          answered = withoutId(snapshot.docs.flatMap((item) => held(item.id, item.data()) ?? []));
          report();
        },
        onError,
      );
      const stopDevice = outbox.subscribe((items) => {
        onDevice = withoutId(items);
        report();
      }, onError);
      return () => {
        stopDevice();
        stopServer();
      };
    },
    flushNow: outbox.flushNow,
    async block(sender) {
      const { answer } = await guard(async () => {
        const added = answerLater(outbox.add(sender, sender.uid));
        // Handed to Firestore's cache now, where a sign-out in another tab waits for the server.
        await outbox.flushNow();
        return added;
      });
      await answer;
    },
    async unblock(uid) {
      const ref = doc(blocked, uid);
      const { answer } = await guard(async () => {
        outbox.cancel(uid);
        // Also covers a block that was already on its way when it was cancelled.
        const removed = answerLater(deleteDoc(ref));
        await inLocalCache(ref);
        return removed;
      });
      await answer;
    },
  };
}
