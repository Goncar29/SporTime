import type { Contact } from "../../contacts/domain/contact";
import type { ReceivedRoutines } from "../../routines/application/ports";
import type { RoutineDraft } from "../../routines/domain/routine";
import type { SubscribeToList } from "../../shared/application/liveList";
import type { StoreFailureKind } from "../../shared/domain/storeFailure";
import type { BlockedSender } from "../domain/blockedSender";
import type { SenderClaims, SharedCopy, ShareProblem } from "../domain/sharedCopy";

/** Who is signed in, as their ID token says; the rules compare the copy with the same claims. */
export interface SenderIdentity {
  /** Rejects with a store-like error code: `unavailable` offline, `unauthenticated` signed out. */
  claims(): Promise<SenderClaims>;
}

/**
 * Writes copies to other users' inboxes. A write needs the server: it is never queued, in an
 * outbox or in Firestore's offline cache, so it either reaches the server now or fails.
 */
export interface InboxWriter {
  /**
   * Creates `users/{recipientUid}/inbox/{copyId}` with the server's time as `sentAt`, once.
   * Rejects with the store's error; one that the server may still have applied (its answer was
   * lost) has a code like `unavailable` or `deadline-exceeded`.
   */
  create(recipientUid: string, copyId: string, copy: SharedCopy): Promise<void>;
}

/**
 * What became of one recipient's copy:
 * - `sent`: the server stored it;
 * - `refused`: the server refused it, so it is not there;
 * - `mayHaveArrived`: the answer was lost, so it may or may not be there; trying again never
 *   delivers it twice;
 * - `offline`: nothing was sent, as there is no connection;
 * - `failed`: nothing was stored, for `failure`.
 */
export type DeliveryOutcome = "sent" | "refused" | "mayHaveArrived" | "offline" | "failed";

export interface Delivery {
  contact: Contact;
  outcome: DeliveryOutcome;
  /** Why it failed, when `outcome` is `failed`. */
  failure?: StoreFailureKind;
}

/** A copy ready to go to its recipients, each with its copy id fixed for every attempt. */
export interface Share {
  recipients: readonly Contact[];
  /**
   * Sends to every recipient not reached yet, each on their own: one refusal does not stop the
   * others. Calling it again while it runs returns the same run, so nothing is sent twice.
   */
  send(): Promise<Delivery[]>;
}

export type Preparation =
  | { kind: "ready"; share: Share }
  /** The copy breaks the inbox rules; nothing was written. */
  | { kind: "refused"; problems: ShareProblem[] }
  /** Nothing was written: sharing needs a connection. */
  | { kind: "offline" }
  /** Nothing was written, for `failure`. */
  | { kind: "failed"; failure: StoreFailureKind };

/** Sends copies of the signed-in user's routines to their contacts (S12). */
export interface RoutineSharing {
  /** Builds the copy and gives each recipient a copy id; writes nothing. */
  prepare(routine: RoutineDraft, recipients: readonly Contact[]): Promise<Preparation>;
}

/** A copy in the signed-in user's inbox, as stored but with `sentAt` in milliseconds. */
export interface InboxCopy {
  id: string;
  /** Untrusted until receivedRoutine reads it. */
  data: unknown;
}

/** The signed-in user's inbox, which only they may read and delete (T26, S12). */
export interface InboxReader {
  /**
   * Reports the copies the server holds, never a list read only from this device's cache (it
   * may hold copies already received elsewhere), then every change. Returns the unsubscribe
   * function; a listener stops for good after an error.
   */
  subscribe(onCopies: (copies: InboxCopy[]) => void, onError: (error: Error) => void): () => void;
  /** Deletes a copy. Settles when the server answers, which never happens offline. */
  remove(copyId: string): Promise<void>;
}

/** Where a received copy becomes one of the user's own routines. */
export type ReceivedRoutineStore = ReceivedRoutines;

/** Moves the copies in the signed-in user's inbox into their routines. */
export interface InboxReceiving {
  /** Listens to the inbox and receives every copy in it. Returns the function that stops it. */
  start(): () => void;
}

/**
 * Who the signed-in user blocked from sending them routines (S7, T27), by name. Writes apply on
 * this device right away and sync when online, through an outbox like contacts, so a block is never
 * lost to a closed page or a missing connection.
 */
export interface BlockedSenders {
  subscribe: SubscribeToList<BlockedSender>;
  /**
   * The blocked list for deciding what to receive: reported only once the server has answered it
   * (never from this device's cache or outbox alone, which may miss a block made on another
   * device), with the blocks still held on this device on top.
   */
  subscribeAnswered: SubscribeToList<BlockedSender>;
  /**
   * Blocks a sender: the rules then refuse every copy they send, and the copies they sent before
   * are not received. Already received routines stay. Held on this device at once; settles when
   * the server answers, which never happens offline, so callers must not wait for it.
   */
  block(sender: BlockedSender): Promise<void>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  unblock(uid: string): Promise<void>;
}
