import { getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { firebaseApp } from "./firebaseApp";

let instance: Firestore | undefined;

/** The persistent cache keeps saved data readable, and writes queued, with no connection. */
export function firestore(): Firestore {
  if (instance) return instance;
  try {
    instance = initializeFirestore(firebaseApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    // Decided at build time, so this is never shipped in a production build.
    if (import.meta.env.MODE === "emulator") {
      connectFirestoreEmulator(instance, "127.0.0.1", 8080);
    }
  } catch {
    // Already initialized, for example after a hot reload.
    instance = getFirestore(firebaseApp());
  }
  return instance;
}

/** Firestore writes as whoever Auth reports, so a write must wait for that account to be confirmed. */
export async function accountReady(userId: string): Promise<boolean> {
  const auth = getAuth(firebaseApp());
  await auth.authStateReady();
  return auth.currentUser?.uid === userId;
}
