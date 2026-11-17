import type { HeldWrites } from "../../shared/application/outbox";
import type { LocalAccountData, SendResult } from "../application/ports";

const SEND_TIMEOUT_MS = 10_000;

interface Dependencies {
  outboxes: HeldWrites[];
  /** Drops writes not yet handed to Firestore. Only the account's outbox keys. */
  discardPendingWrites: () => void;
  /** Settles once the server confirmed every write Firestore holds. */
  serverHasWrites: () => Promise<void>;
  /** Stops Firestore and erases its cache on this device. */
  clearCache: () => Promise<void>;
  /** Forgets the account's stores, which hold the stopped Firestore. */
  forget: () => void;
  /**
   * The note that has the next start clear the cache, taken back by `clearCache` once it is
   * cleared. None where nothing is cached.
   */
  clearOnNextStart?: { mark: () => void; unmark: () => void };
}

async function sendOnce(outboxes: HeldWrites[], serverHasWrites: () => Promise<void>) {
  const held = await Promise.all(outboxes.map((outbox) => outbox.flushNow()));
  // Another account's session, or a broken cache, keeps them here: they were not sent.
  if (held.some((count) => count > 0)) return "unsent";
  await serverHasWrites();
  return "sent";
}

/**
 * The server only confirms the writes made before it was asked, so a change made while waiting
 * would be left out. A second round, right before the caller signs out, sends and waits for it.
 */
async function send(
  outboxes: HeldWrites[],
  serverHasWrites: () => Promise<void>,
): Promise<SendResult> {
  if ((await sendOnce(outboxes, serverHasWrites)) === "unsent") return "unsent";
  return sendOnce(outboxes, serverHasWrites);
}

/** Firestore waits for the network without limit, so without this a lost connection looks like a hang. */
function withTimeout(work: Promise<SendResult>): Promise<SendResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve("unsent");
    }, SEND_TIMEOUT_MS);
    void work
      .catch((error: unknown) => {
        // Also reached after the timeout, when a later sign-out makes Firestore stop waiting.
        console.warn("Pending changes were not confirmed:", error);
        return "unsent" as const;
      })
      .then(resolve)
      .finally(() => {
        clearTimeout(timer);
      });
  });
}

export function createLocalAccountData({
  outboxes,
  discardPendingWrites,
  serverHasWrites,
  clearCache,
  forget,
  clearOnNextStart,
}: Dependencies): LocalAccountData {
  return {
    sendPending() {
      if (!navigator.onLine) return Promise.resolve("unsent");
      return withTimeout(send(outboxes, serverHasWrites));
    },
    discardPending: discardPendingWrites,
    eraseOnNextStart: () => clearOnNextStart?.mark(),
    keepOnNextStart: () => clearOnNextStart?.unmark(),
    async erase() {
      discardPendingWrites();
      try {
        await clearCache();
      } finally {
        // Firestore is stopped either way, so these stores must not be handed out again.
        forget();
      }
    },
  };
}
