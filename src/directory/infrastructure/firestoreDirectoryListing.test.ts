import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createFirestoreDirectoryListing, removeDirectoryEntry } from "./firestoreDirectoryListing";

/** The server's directory by path, as the rules would leave it for the signed-in "u1". */
const firestore = vi.hoisted(() => ({
  server: new Map<string, Record<string, unknown>>(),
  listeners: new Map<string, (snapshot: unknown) => void>(),
  serverReachable: true,
  calls: [] as string[],
}));

const snapshotOf = (path: string) => {
  const data = firestore.server.get(path);
  return { exists: () => data !== undefined, data: () => data };
};

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  getDocFromCache: () => Promise.resolve({ exists: () => false }),
  getDocFromServer: ({ path }: { path: string }) =>
    firestore.serverReachable
      ? Promise.resolve(snapshotOf(path))
      : Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" })),
  onSnapshot: ({ path }: { path: string }, onNext: (snapshot: unknown) => void) => {
    firestore.listeners.set(path, onNext);
    onNext(snapshotOf(path));
    return () => firestore.listeners.delete(path);
  },
  setDoc: ({ path }: { path: string }, data: Record<string, unknown>) => {
    firestore.calls.push(`set ${path}`);
    firestore.server.set(path, data);
    firestore.listeners.get(path)?.(snapshotOf(path));
    return Promise.resolve();
  },
  // Like the rules: only the entry's own account may delete it, and only an entry that exists.
  deleteDoc: ({ path }: { path: string }) => {
    firestore.calls.push(`delete ${path}`);
    if (firestore.server.get(path)?.uid !== "u1") {
      return Promise.reject(Object.assign(new Error("denied"), { code: "permission-denied" }));
    }
    firestore.server.delete(path);
    firestore.listeners.get(path)?.(snapshotOf(path));
    return Promise.resolve();
  },
}));

const user = {
  id: "u1",
  name: "Ana Pérez",
  email: " Ana@Example.com ",
  photoUrl: "https://lh3.googleusercontent.com/a/ana=s96-c",
};
const PATH = "directory/ana@example.com";
const db = {} as never;

describe("createFirestoreDirectoryListing", () => {
  beforeEach(() => {
    firestore.server.clear();
    firestore.listeners.clear();
    firestore.calls.length = 0;
    firestore.serverReachable = true;
  });

  it("lists the account under its normalized email with its Google name and photo", async () => {
    const listing = createFirestoreDirectoryListing(db, user);
    await listing.list();
    expect(firestore.server.get(PATH)).toEqual({
      uid: "u1",
      name: "Ana Pérez",
      photo: "https://lh3.googleusercontent.com/a/ana=s96-c",
    });
  });

  it("writes no photo from another host", async () => {
    await createFirestoreDirectoryListing(db, {
      ...user,
      photoUrl: "https://example.com/a.png",
    }).list();
    expect(firestore.server.get(PATH)?.photo).toBe("");
  });

  it("reports whether the account is listed, as it changes", async () => {
    const listing = createFirestoreDirectoryListing(db, user);
    const seen: boolean[] = [];
    const stop = listing.subscribe(
      (listed) => seen.push(listed),
      () => undefined,
    );
    await listing.list();
    await listing.unlist();
    stop();
    expect(seen).toEqual([false, true, false]);
    expect(firestore.server.has(PATH)).toBe(false);
  });

  it("does not count an entry of another account under the same email", () => {
    firestore.server.set(PATH, { uid: "someone-else", name: "", photo: "" });
    const seen: boolean[] = [];
    createFirestoreDirectoryListing(db, user).subscribe(
      (listed) => seen.push(listed),
      () => undefined,
    );
    expect(seen).toEqual([false]);
  });

  it("settles when unlisting finds the entry already gone", async () => {
    await expect(createFirestoreDirectoryListing(db, user).unlist()).resolves.toBeUndefined();
  });

  it("reports a refusal it cannot explain by asking the server", async () => {
    firestore.server.set(PATH, { uid: "u2", name: "", photo: "" });
    firestore.serverReachable = false;
    await expect(createFirestoreDirectoryListing(db, user).unlist()).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("refuses to list an account without an email, and reports it as not listed", async () => {
    const listing = createFirestoreDirectoryListing(db, { ...user, email: "  " });
    const seen: boolean[] = [];
    listing.subscribe(
      (listed) => seen.push(listed),
      () => undefined,
    );
    expect(seen).toEqual([false]);
    await expect(listing.list()).rejects.toThrow();
    expect(firestore.calls).toEqual([]);
  });

  it("runs each change inside the guard", async () => {
    let guarded = 0;
    const guard = <T>(write: () => Promise<T>) => {
      guarded += 1;
      return write();
    };
    const listing = createFirestoreDirectoryListing(db, user, { guard });
    await listing.list();
    await listing.unlist();
    expect(guarded).toBe(2);
  });
});

describe("removeDirectoryEntry", () => {
  beforeEach(() => {
    firestore.server.clear();
    firestore.calls.length = 0;
    firestore.serverReachable = true;
  });

  it("removes the account's own entry and leaves another account's", async () => {
    firestore.server.set(PATH, { uid: "u1", name: "", photo: "" });
    firestore.server.set("directory/bob@example.com", { uid: "u2", name: "", photo: "" });
    await removeDirectoryEntry(db, { id: "u1", email: user.email });
    expect(firestore.server.has(PATH)).toBe(false);
    expect(firestore.server.has("directory/bob@example.com")).toBe(true);
  });

  it("settles without deleting when there is no entry, or it belongs to another account", async () => {
    await expect(
      removeDirectoryEntry(db, { id: "u1", email: user.email }),
    ).resolves.toBeUndefined();
    firestore.server.set(PATH, { uid: "u2", name: "", photo: "" });
    await expect(
      removeDirectoryEntry(db, { id: "u1", email: user.email }),
    ).resolves.toBeUndefined();
    expect(firestore.server.has(PATH)).toBe(true);
    expect(firestore.calls).toEqual([]);
  });

  it("rejects, deleting nothing, when the server cannot be asked", async () => {
    firestore.server.set(PATH, { uid: "u1", name: "", photo: "" });
    firestore.serverReachable = false;
    await expect(removeDirectoryEntry(db, { id: "u1", email: user.email })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(firestore.calls).toEqual([]);
    expect(firestore.server.has(PATH)).toBe(true);
  });

  it("does nothing for an account without an email", async () => {
    await removeDirectoryEntry(db, { id: "u1", email: "" });
    expect(firestore.calls).toEqual([]);
  });
});
