import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const sdk = vi.hoisted(() => ({
  calls: [] as string[],
  created: 0,
  /** How many of the next cache clears fail. */
  failingClears: 0,
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
    if (sdk.failingClears > 0) {
      sdk.failingClears -= 1;
      return Promise.reject(new Error("blocked by another tab"));
    }
    return Promise.resolve();
  },
}));

const firestoreModule = await import("./firestore");
const { clearLocalCache, serverHasWrites } = firestoreModule;
const firestore = () => firestoreModule.firestore() as unknown as { id: number };

/** The module as a newly loaded page sees it, with no Firestore started yet. */
async function nextStart() {
  vi.resetModules();
  const fresh = await import("./firestore");
  return {
    firestore: () => fresh.firestore() as unknown as { id: number },
    serverHasWrites: fresh.serverHasWrites,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("clearLocalCache", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    sdk.calls = [];
    sdk.failingClears = 0;
    localStorage.clear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("stops Firestore before clearing its cache, and starts a new one when next asked", async () => {
    const before = firestore();
    await clearLocalCache();
    expect(sdk.calls).toEqual([`terminate ${before.id}`, `clear ${before.id}`]);
    expect(firestore()).not.toBe(before);
  });

  it("when clearing fails, the next start clears the cache before Firestore is first used", async () => {
    firestore();
    sdk.failingClears = 1;
    await expect(clearLocalCache()).rejects.toThrow("blocked by another tab");

    const next = await nextStart();
    sdk.calls = [];
    const db = next.firestore();
    await next.serverHasWrites();
    expect(sdk.calls).toEqual([`clear ${db.id}`, `waitForPendingWrites ${db.id}`]);

    await settled();
    const after = await nextStart();
    sdk.calls = [];
    after.firestore();
    expect(sdk.calls).toEqual([]);
  });

  it("keeps clearing on later starts until a clear succeeds", async () => {
    firestore();
    sdk.failingClears = 2;
    await expect(clearLocalCache()).rejects.toThrow();
    (await nextStart()).firestore();
    await settled();

    const next = await nextStart();
    sdk.calls = [];
    const db = next.firestore();
    expect(sdk.calls).toEqual([`clear ${db.id}`]);
  });

  it("clears nothing on a start that follows a successful erase", async () => {
    firestore();
    await clearLocalCache();
    const next = await nextStart();
    sdk.calls = [];
    next.firestore();
    expect(sdk.calls).toEqual([]);
  });
});

describe("serverHasWrites", () => {
  it("waits for the running Firestore's queued writes", async () => {
    const db = firestore();
    await serverHasWrites();
    expect(sdk.calls).toContain(`waitForPendingWrites ${db.id}`);
  });
});
