import type { Contact } from "../../contacts/domain/contact";
import type { RoutineDraft } from "../../routines/domain/routine";
import type { StoreFailureKind } from "../../shared/domain/storeFailure";
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
