/**
 * Why the account's data store refused something, in the terms the user is told. Firestore
 * reports one of its own codes (not an HTTP status); only these change what the user can do.
 */
export type StoreFailureKind =
  | "notFound"
  | "denied"
  | "sessionEnded"
  | "offline"
  | "busy"
  | "unknown";

const KINDS: Record<string, StoreFailureKind> = {
  "not-found": "notFound",
  "permission-denied": "denied",
  unauthenticated: "sessionEnded",
  unavailable: "offline",
  "deadline-exceeded": "offline",
  "resource-exhausted": "busy",
};

/** The store's code for the developer, without the service prefix Firebase sometimes adds. */
export function storeFailureCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return String(error.code).replace(/^firestore\//, "");
}

export function storeFailureKind(error: unknown): StoreFailureKind {
  const code = storeFailureCode(error);
  return (code && KINDS[code]) || "unknown";
}
