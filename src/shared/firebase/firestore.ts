import { getAuth } from "firebase/auth";
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  waitForPendingWrites,
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

/**
 * Settles once the server has confirmed every write Firestore holds. It never settles offline,
 * and rejects when the signed-in user changes, so it must run before signing out.
 */
export function serverHasWrites(): Promise<void> {
  return waitForPendingWrites(firestore());
}

/**
 * Stops Firestore and erases its cache on this device, writes still queued included. The cache
 * can only be cleared while no instance runs, so it is stopped first; the next call to
 * `firestore()` starts a fresh one.
 */
export async function clearLocalCache(): Promise<void> {
  const running = firestore();
  instance = undefined;
  await terminate(running);
  await clearIndexedDbPersistence(running);
}

/** Firestore writes as whoever Auth reports, so a write must wait for that account to be confirmed. */
export async function accountReady(userId: string): Promise<boolean> {
  const auth = getAuth(firebaseApp());
  await auth.authStateReady();
  return auth.currentUser?.uid === userId;
}
