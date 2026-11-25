import type { Contact } from "../../contacts/domain/contact";
import { storeFailureKind, type StoreFailureKind } from "../../shared/domain/storeFailure";
import { buildSharedCopy, type SharedCopy } from "../domain/sharedCopy";
import type {
  Delivery,
  DeliveryOutcome,
  InboxWriter,
  RoutineSharing,
  SenderIdentity,
  Share,
} from "./ports";

interface Dependencies {
  identity: SenderIdentity;
  inbox: InboxWriter;
  /** Whether the device has a connection; without one nothing is attempted. */
  online: () => boolean;
  /** A fresh random id for one recipient's copy. */
  newCopyId?: () => string;
  /** How long to wait for the server's answer before reporting it as lost. */
  answerWithinMs?: number;
}

const ANSWER_WITHIN_MS = 30_000;

/**
 * Codes after which the server surely stored nothing: the request was refused or never ran.
 * Any other failure (a dropped connection, a timeout, an unknown error) may have come after the
 * server stored the copy, so it is reported as one that may have arrived.
 */
const NOTHING_STORED = new Set([
  "permission-denied",
  "unauthenticated",
  "invalid-argument",
  "resource-exhausted",
  "failed-precondition",
  "aborted",
  "already-exists",
  "not-found",
  "out-of-range",
  "unimplemented",
]);

const lostAnswer = () =>
  Object.assign(new Error("No answer in time"), { code: "deadline-exceeded" });

function withinTime(work: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(lostAnswer());
    }, ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const codeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String(error.code).replace(/^firestore\//, "")
    : undefined;

/** One recipient of a share, followed across attempts. */
interface Recipient {
  contact: Contact;
  /** Fixed before the first attempt, so a retry can never create a second copy. */
  copyId: string;
  /** Set once an attempt may have reached the server: a later refusal is then no proof. */
  uncertain: boolean;
  last?: Delivery;
}

/**
 * Sends copies of routines to contacts, at once or not at all: a copy is never queued for later,
 * since one the rules refuse could otherwise wait for ever (L56 A1, L58).
 */
export function createRoutineSharing({
  identity,
  inbox,
  online,
  newCopyId = () => crypto.randomUUID(),
  answerWithinMs = ANSWER_WITHIN_MS,
}: Dependencies): RoutineSharing {
  async function deliver(recipient: Recipient, copy: SharedCopy): Promise<Delivery> {
    const { contact } = recipient;
    if (!online()) return { contact, outcome: "offline" };
    try {
      await withinTime(inbox.create(contact.uid, recipient.copyId, copy), answerWithinMs);
      return { contact, outcome: "sent" };
    } catch (error: unknown) {
      const code = codeOf(error);
      if (code === undefined || !NOTHING_STORED.has(code)) {
        recipient.uncertain = true;
        return { contact, outcome: "mayHaveArrived" };
      }
      if (code === "permission-denied") {
        // After an attempt that may have arrived, the refusal may be the rules refusing to
        // overwrite it (no update), so it is not proof that nothing arrived.
        const outcome: DeliveryOutcome = recipient.uncertain ? "mayHaveArrived" : "refused";
        return { contact, outcome };
      }
      return { contact, outcome: "failed", failure: storeFailureKind(error) };
    }
  }

  function shareOf(recipients: Recipient[], copy: SharedCopy): Share {
    let running: Promise<Delivery[]> | null = null;
    const sendAll = async () => {
      const deliveries = await Promise.all(
        recipients.map(async (recipient) => {
          if (recipient.last?.outcome === "sent") return recipient.last;
          recipient.last = await deliver(recipient, copy);
          return recipient.last;
        }),
      );
      return deliveries;
    };
    return {
      recipients: recipients.map(({ contact }) => contact),
      send() {
        running ??= sendAll().finally(() => {
          running = null;
        });
        return running;
      },
    };
  }

  return {
    async prepare(routine, contacts) {
      if (!online()) return { kind: "offline" };
      let claims;
      try {
        claims = await identity.claims();
      } catch (error: unknown) {
        const failure: StoreFailureKind = storeFailureKind(error);
        return failure === "offline" ? { kind: "offline" } : { kind: "failed", failure };
      }
      const built = buildSharedCopy(routine, claims);
      if ("problems" in built) return { kind: "refused", problems: built.problems };
      const recipients = contacts.map((contact): Recipient => ({
        contact,
        copyId: newCopyId(),
        uncertain: false,
      }));
      return { kind: "ready", share: shareOf(recipients, built.copy) };
    },
  };
}
