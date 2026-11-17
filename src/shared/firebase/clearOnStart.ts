/**
 * A note that has the next start clear Firestore's cache on this device before anything uses it.
 * Kept apart from Firestore, so a start can read it without loading Firestore.
 */
const CLEAR_ON_START = "sportime.clearLocalCache";

export function markForClearing() {
  try {
    localStorage.setItem(CLEAR_ON_START, "true");
  } catch (error) {
    console.warn("The cache could not be marked for clearing:", error);
  }
}

export function unmarkForClearing() {
  try {
    localStorage.removeItem(CLEAR_ON_START);
  } catch (error) {
    console.warn("The note to clear the cache could not be taken back:", error);
  }
}

export function markedForClearing(): boolean {
  try {
    return localStorage.getItem(CLEAR_ON_START) === "true";
  } catch {
    return false;
  }
}
