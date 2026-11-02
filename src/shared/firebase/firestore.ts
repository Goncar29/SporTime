import {
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
  } catch {
    // Already initialized, for example after a hot reload.
    instance = getFirestore(firebaseApp());
  }
  return instance;
}
