import {
  collection,
  deleteDoc,
  doc,
  getDocFromCache,
  getDocFromServer,
  onSnapshot,
  setDoc,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { withOutbox, type HeldWrites, type OutboxStore } from "../../shared/application/outbox";
import { storeFailureKind } from "../../shared/domain/storeFailure";
import { isInLocalCache } from "../../shared/firebase/localCache";
import { findContact, oneAtATime } from "../application/findContact";
import type { ContactStore } from "../application/ports";
import {
  ContactRefused,
  byName,
  parseContact,
  toStoredContact,
  type Contact,
} from "../domain/contact";

interface Durability {
  store: OutboxStore<Contact>;
  whenReady: () => Promise<boolean>;
  /**
   * Runs a change until it is stored on this device, holding off a sign-out in another tab, or
   * refuses it. Without one, changes run at once.
   */
  guard?: <T>(write: () => Promise<T>) => Promise<T>;
}

const runAtOnce = <T>(write: () => Promise<T>) => write();

/** The outbox knows items by `id`, which for a contact is its uid. */
type Held = Contact & { id: string };

const held = (id: string, raw: unknown): Held | null => {
  const contact = parseContact(id, raw);
  return contact && { ...contact, id };
};

const withoutId = (items: Held[]): Contact[] => items.map(({ id: _id, ...contact }) => contact);

/** The server's answer, kept apart so the guard does not wait for it. */
function answerLater(answer: Promise<void>): { answer: Promise<void> } {
  // Read after the guard ends; until then a refusal must not count as unhandled.
  answer.catch(() => undefined);
  return { answer };
}

/**
 * Contacts are kept like routines, through the outbox, under the contact's uid. Adding one needs
 * the server, which alone can say who chose to be found by an email; the write itself then works
 * like any other. The rules refuse a contact whose directory entry is gone by the time the write
 * arrives; Firestore then drops it, as the outbox already handed it over.
 */
export function createFirestoreContactList(
  db: Firestore,
  userId: string,
  { store, whenReady, guard = runAtOnce }: Durability,
): ContactStore & HeldWrites {
  const contacts = collection(db, "users", userId, "contacts");
  /** Firestore answers in order, so once this read answers, the change before it is in the cache. */
  const inLocalCache = (ref: DocumentReference) => getDocFromCache(ref).catch(() => undefined);
  const serial = oneAtATime();

  const outbox = withOutbox<Held, Contact>({
    store,
    whenReady,
    parse: held,
    newestFirst: byName,
    collection: {
      subscribe(onData, onError) {
        return onSnapshot(
          contacts,
          (snapshot) => {
            onData(snapshot.docs.flatMap((item) => held(item.id, item.data()) ?? []));
          },
          onError,
        );
      },
      newId: () => doc(contacts).id,
      async put(id, contact) {
        await setDoc(doc(contacts, id), toStoredContact(contact));
      },
      has: (id) => isInLocalCache(() => getDocFromCache(doc(contacts, id))),
    },
  });

  const subscribe: ContactStore["subscribe"] = (onData, onError) =>
    outbox.subscribe((items) => {
      onData(withoutId(items));
    }, onError);

  /** The list as shown, held writes included, read once. */
  const current = () =>
    new Promise<Contact[]>((resolve, reject) => {
      let done = false;
      let stop: (() => void) | undefined;
      const finish = () => {
        done = true;
        stop?.();
      };
      stop = subscribe(
        (items) => {
          if (done) return;
          finish();
          resolve(items);
        },
        (error) => {
          if (done) return;
          finish();
          reject(error);
        },
      );
      // Answered before subscribe returned.
      if (done) stop();
    });

  const entryOf = async (email: string): Promise<unknown> => {
    try {
      const stored = await getDocFromServer(doc(db, "directory", email));
      return stored.exists() ? stored.data() : null;
    } catch (error) {
      if (storeFailureKind(error) === "offline")
        throw new ContactRefused("offline", { cause: error });
      throw error;
    }
  };

  return {
    subscribe,
    flushNow: outbox.flushNow,
    add: (email) =>
      serial(async () => {
        const contact = await findContact(email, { entryOf, current, ownUid: userId });
        return guard(async () => {
          const { answer } = answerLater(outbox.add(contact, contact.uid));
          // Handed to Firestore's cache now, where a sign-out in another tab waits for the server.
          await outbox.flushNow();
          return { contact, saved: answer };
        });
      }),
    async remove(uid) {
      const ref = doc(contacts, uid);
      const { answer } = await guard(async () => {
        outbox.cancel(uid);
        // Also covers a write that was already on its way when it was cancelled.
        const removed = answerLater(deleteDoc(ref));
        await inLocalCache(ref);
        return removed;
      });
      await answer;
    },
  };
}
