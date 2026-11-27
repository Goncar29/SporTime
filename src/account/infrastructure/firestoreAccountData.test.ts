import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLocalStorageOutboxStore } from "../../shared/infrastructure/localStorageOutboxStore";
import { createFirestoreAccountData } from "./firestoreAccountData";

/** The server's documents by collection path, emptied as the batches delete them. */
const server = vi.hoisted(() => new Map<string, string[]>());
/** The server's directory entries by path, and the account the rules see signed in. */
const directory = vi.hoisted(() => ({
  entries: new Map<string, { uid: string }>(),
  signedIn: "u1",
  /** Whether the server can be asked; when not, a read fails at once, as Firestore does offline. */
  reachable: true,
  /** Every server read and write, in order. */
  calls: [] as string[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  getDocFromCache: () => Promise.resolve({ exists: () => false }),
  getDocFromServer: ({ path }: { path: string }) => {
    directory.calls.push(`read ${path}`);
    if (!directory.reachable) {
      return Promise.reject(Object.assign(new Error("offline"), { code: "unavailable" }));
    }
    const entry = directory.entries.get(path);
    return Promise.resolve({ exists: () => entry !== undefined, data: () => entry });
  },
  // Like the rules: only the entry's own account may delete it, and only an entry that exists.
  deleteDoc: ({ path }: { path: string }) => {
    directory.calls.push(`delete ${path}`);
    if (directory.entries.get(path)?.uid !== directory.signedIn) {
      return Promise.reject(Object.assign(new Error("denied"), { code: "permission-denied" }));
    }
    directory.entries.delete(path);
    return Promise.resolve();
  },
  getDocsFromServer: ({ path }: { path: string }) => {
    const ids = server.get(path) ?? [];
    return Promise.resolve({
      empty: ids.length === 0,
      docs: ids.map((id) => ({ ref: { path, id } })),
    });
  },
  limit: () => ({}),
  query: (documents: unknown) => documents,
  writeBatch: () => {
    const deletes: { path: string; id: string }[] = [];
    return {
      delete: (ref: { path: string; id: string }) => {
        deletes.push(ref);
      },
      commit: () => {
        deletes.forEach(({ path, id }) => {
          server.set(
            path,
            (server.get(path) ?? []).filter((item) => item !== id),
          );
        });
        directory.calls.push(`batch ${deletes[0]?.path ?? ""}`);
        return Promise.resolve();
      },
    };
  },
}));

const accountData = (email: string | null) =>
  createFirestoreAccountData({
    db: {} as never,
    userId: "u1",
    email: () => email,
    discardPendingWrites: () => undefined,
  });

describe("createFirestoreAccountData", () => {
  beforeEach(() => {
    localStorage.clear();
    server.clear();
    directory.entries.clear();
    directory.calls.length = 0;
    directory.reachable = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  it("still drops the account's pending writes when deleting the account", async () => {
    const workouts = createLocalStorageOutboxStore("sportime.outbox.workouts.u1");
    const history = createLocalStorageOutboxStore("sportime.outbox.history.u1");
    const routines = createLocalStorageOutboxStore("sportime.outbox.routines.u1");
    const contacts = createLocalStorageOutboxStore("sportime.outbox.contacts.u1");
    workouts.save([{ id: "w1", draft: {} }]);
    history.save([{ id: "h1", draft: {} }]);
    routines.save([{ id: "r1", draft: {} }]);
    contacts.save([{ id: "c1", draft: {} }]);
    const data = createFirestoreAccountData({
      db: {} as never,
      userId: "u1",
      email: () => "u1@example.com",
      discardPendingWrites: () => {
        workouts.save([]);
        history.save([]);
        routines.save([]);
        contacts.save([]);
      },
    });

    await data.erase();

    expect(localStorage.getItem("sportime.outbox.workouts.u1")).toBeNull();
    expect(localStorage.getItem("sportime.outbox.history.u1")).toBeNull();
    expect(localStorage.getItem("sportime.outbox.routines.u1")).toBeNull();
    expect(localStorage.getItem("sportime.outbox.contacts.u1")).toBeNull();
  });

  it("erases the account's workouts, history, routines, contacts and inbox, and no other account's", async () => {
    server.set("users/u1/workouts", ["w1", "w2"]);
    server.set("users/u1/history", ["h1"]);
    // Received routines are routines like the others.
    server.set("users/u1/routines", ["r1", "r2", "received-copy"]);
    server.set("users/u1/contacts", ["u2", "u3"]);
    server.set("users/u1/inbox", ["c1", "c2"]);
    server.set("users/u2/routines", ["r3"]);
    server.set("users/u2/contacts", ["u1"]);
    server.set("users/u2/inbox", ["c3"]);

    await accountData("u1@example.com").erase();

    expect(server.get("users/u1/workouts")).toEqual([]);
    expect(server.get("users/u1/history")).toEqual([]);
    expect(server.get("users/u1/routines")).toEqual([]);
    expect(server.get("users/u1/contacts")).toEqual([]);
    expect(server.get("users/u1/inbox")).toEqual([]);
    expect(server.get("users/u2/routines")).toEqual(["r3"]);
    expect(server.get("users/u2/contacts")).toEqual(["u1"]);
    expect(server.get("users/u2/inbox")).toEqual(["c3"]);
  });

  it("erases the inbox last, so a copy a contact sends meanwhile is erased too", async () => {
    for (const name of ["workouts", "history", "routines", "contacts", "inbox"]) {
      server.set(`users/u1/${name}`, [name]);
    }

    await accountData(null).erase();

    expect(directory.calls.filter((call) => call.startsWith("batch"))).toEqual([
      "batch users/u1/workouts",
      "batch users/u1/history",
      "batch users/u1/routines",
      "batch users/u1/contacts",
      "batch users/u1/inbox",
    ]);
  });

  it("removes the account's directory entry first, under its normalized email", async () => {
    directory.entries.set("directory/u1@example.com", { uid: "u1" });
    directory.entries.set("directory/u2@example.com", { uid: "u2" });
    server.set("users/u1/routines", ["r1"]);

    await accountData(" U1@Example.com ").erase();

    expect(directory.entries.has("directory/u1@example.com")).toBe(false);
    expect(directory.entries.has("directory/u2@example.com")).toBe(true);
    // Read from the server first, and deleted only because it holds this account.
    expect(directory.calls.slice(0, 2)).toEqual([
      "read directory/u1@example.com",
      "delete directory/u1@example.com",
    ]);
    expect(server.get("users/u1/routines")).toEqual([]);
  });

  it("issues no delete for an account that was never listed, and erases the rest", async () => {
    server.set("users/u1/routines", ["r1"]);

    await accountData("u1@example.com").erase();

    expect(directory.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
    expect(server.get("users/u1/routines")).toEqual([]);
  });

  it("leaves an entry another account holds under the same email, without trying to delete it", async () => {
    directory.entries.set("directory/u1@example.com", { uid: "u9" });
    server.set("users/u1/routines", ["r1"]);

    await accountData("u1@example.com").erase();

    expect(directory.entries.get("directory/u1@example.com")).toEqual({ uid: "u9" });
    expect(directory.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
    expect(server.get("users/u1/routines")).toEqual([]);
  });

  it("fails at once, as a network failure, when the entry cannot be read, queuing no delete", async () => {
    vi.useFakeTimers();
    directory.entries.set("directory/u1@example.com", { uid: "u1" });
    directory.reachable = false;
    server.set("users/u1/routines", ["r1"]);

    try {
      // No timer is advanced: it must not wait for the erase timeout.
      await expect(accountData("u1@example.com").erase()).rejects.toMatchObject({
        kind: "network",
      });
    } finally {
      vi.useRealTimers();
    }

    expect(directory.calls).toEqual(["read directory/u1@example.com"]);
    expect(directory.entries.has("directory/u1@example.com")).toBe(true);
    expect(server.get("users/u1/routines")).toEqual(["r1"]);
  });

  it("erases the rest for an account without an email", async () => {
    server.set("users/u1/workouts", ["w1"]);

    await accountData(null).erase();

    expect(server.get("users/u1/workouts")).toEqual([]);
    expect(directory.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
  });
});
