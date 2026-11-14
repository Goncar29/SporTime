import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const sdk = vi.hoisted(() => ({
  calls: [] as string[],
  created: 0,
}));

vi.mock("./firebaseApp", () => ({ firebaseApp: () => ({}) }));
vi.mock("firebase/auth", () => ({ getAuth: () => ({}) }));
vi.mock("firebase/firestore", () => ({
  initializeFirestore: () => ({ id: ++sdk.created }),
  getFirestore: () => ({ id: ++sdk.created }),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  connectFirestoreEmulator: () => undefined,
  waitForPendingWrites: (db: { id: number }) => {
    sdk.calls.push(`waitForPendingWrites ${db.id}`);
    return Promise.resolve();
  },
  terminate: (db: { id: number }) => {
    sdk.calls.push(`terminate ${db.id}`);
    return Promise.resolve();
  },
  clearIndexedDbPersistence: (db: { id: number }) => {
    sdk.calls.push(`clear ${db.id}`);
    return Promise.resolve();
  },
}));

const firestoreModule = await import("./firestore");
const { clearLocalCache, serverHasWrites } = firestoreModule;
const firestore = () => firestoreModule.firestore() as unknown as { id: number };

describe("clearLocalCache", () => {
  beforeEach(() => {
    sdk.calls = [];
  });

  it("stops Firestore before clearing its cache, and starts a new one when next asked", async () => {
    const before = firestore();
    await clearLocalCache();
    expect(sdk.calls).toEqual([`terminate ${before.id}`, `clear ${before.id}`]);
    expect(firestore()).not.toBe(before);
  });
});

describe("serverHasWrites", () => {
  it("waits for the running Firestore's queued writes", async () => {
    const db = firestore();
    await serverHasWrites();
    expect(sdk.calls).toContain(`waitForPendingWrites ${db.id}`);
  });
});
