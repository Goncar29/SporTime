import { FirebaseError } from "firebase/app";
import type { DocumentSnapshot } from "firebase/firestore";

/** Firestore reports a document missing from its cache as `unavailable`; other failures propagate. */
export async function isInLocalCache(read: () => Promise<DocumentSnapshot>): Promise<boolean> {
  try {
    return (await read()).exists();
  } catch (error) {
    if (error instanceof FirebaseError && error.code === "unavailable") return false;
    throw error;
  }
}
