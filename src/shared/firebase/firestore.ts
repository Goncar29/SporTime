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

/** Set when erasing the cache failed, so the next start erases it before using Firestore. */
const CLEAR_ON_START = "sportime.clearLocalCache";

function markForClearing() {
  try {
    localStorage.setItem(CLEAR_ON_START, "true");
  } catch (error) {
    console.warn("The cache could not be marked for clearing:", error);
  }
}

function markedForClearing(): boolean {
  try {
    return localStorage.getItem(CLEAR_ON_START) === "true";
  } catch {
    return false;
  }
}

/**
 * Clears a cache left by a failed erase. Only possible before the new instance is first used;
 * Firestore runs its work in order, so anything asked of it afterwards waits for the clear.
 */
function clearLeftoverCache(db: Firestore) {
  if (!markedForClearing()) return;
  const failed = (error: unknown) => {
    // The note stays, so the next start tries again.
    console.warn("The cache left by an earlier sign-out could not be cleared:", error);
  };
  try {
    clearIndexedDbPersistence(db)
      .then(() => {
        localStorage.removeItem(CLEAR_ON_START);
      })
      .catch(failed);
  } catch (error) {
    failed(error);
  }
}

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
    // Already initialized, for example after a hot reload. Maybe in use, so it cannot be cleared.
    instance = getFirestore(firebaseApp());
    return instance;
  }
  clearLeftoverCache(instance);
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
  try {
    await terminate(running);
    await clearIndexedDbPersistence(running);
  } catch (error) {
    markForClearing();
    throw error;
  }
}

/** Firestore writes as whoever Auth reports, so a write must wait for that account to be confirmed. */
export async function accountReady(userId: string): Promise<boolean> {
  const auth = getAuth(firebaseApp());
  await auth.authStateReady();
  return auth.currentUser?.uid === userId;
}
