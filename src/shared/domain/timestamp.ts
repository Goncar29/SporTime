/** The latest time a JavaScript Date can hold; `firestore/firestore.rules` enforces the same limit. */
export const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

export function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= MAX_TIMESTAMP_MS
  );
}
