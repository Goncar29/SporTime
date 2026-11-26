import { createLocalStorageSeenRoutines } from "../../routines/infrastructure/localStorageSeenRoutines";
import { createLocalStorageOutboxStore } from "../../shared/infrastructure/localStorageOutboxStore";
import { blockedOutboxKey } from "../../sharing/infrastructure/blockedOutboxKey";
import type { LocalAccountData } from "../application/ports";

/**
 * Tests only: this device's account data in the end-to-end build, which has no Firestore, so
 * nothing waits to be sent and nothing is cached. Erasing still removes what the production
 * sign-out removes from this device besides Firestore: which received routines were seen and any
 * held blocks. Never part of a production build.
 */
export function createFakeLocalAccountData(userId: string): LocalAccountData {
  return {
    sendPending: () => Promise.resolve("sent"),
    discardPending: () => undefined,
    eraseOnNextStart: () => undefined,
    keepOnNextStart: () => undefined,
    erase() {
      createLocalStorageOutboxStore(blockedOutboxKey(userId)).save([]);
      createLocalStorageSeenRoutines(userId).erase();
      return Promise.resolve();
    },
  };
}
