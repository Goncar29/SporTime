import { storeFailureCode, storeFailureKind, type StoreFailureKind } from "../domain/storeFailure";
import type { Messages } from "../../i18n/messages/types";

/**
 * Logs what failed and the store's code for the developer (never the data involved), and
 * returns the kind of failure to tell the user about.
 */
export function reportStoreFailure(operation: string, error: unknown): StoreFailureKind {
  console.error(`${operation} failed:`, storeFailureCode(error) ?? "no code");
  return storeFailureKind(error);
}

/** The message for a kind of failure; one nothing specific explains keeps the caller's own. */
export function storeFailureMessage(t: Messages, kind: StoreFailureKind, fallback: string): string {
  switch (kind) {
    case "notFound":
      return t.failureNotFound;
    case "denied":
      return t.failureDenied;
    case "sessionEnded":
      return t.failureSessionEnded;
    case "offline":
      return t.failureOffline;
    case "busy":
      return t.failureBusy;
    case "unknown":
      return fallback;
  }
}
