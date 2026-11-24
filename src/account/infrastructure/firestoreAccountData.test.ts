import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLocalStorageOutboxStore } from "../../shared/infrastructure/localStorageOutboxStore";
import { createFirestoreAccountData } from "./firestoreAccountData";

/** The server's documents by collection path, emptied as the batches delete them. */
const server = vi.hoisted(() => new Map<string, string[]>());
/** The server's directory entries by path, and the account the rules see signed in. */
const directory = vi.hoisted(() => ({
  entries: new Map<string, { uid: string }>(),
  signedIn: "u1",
  /** Every write, in order. */
  calls: [] as string[],
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
  getDocFromCache: () => Promise.resolve({ exists: () => false }),
  getDocFromServer: ({ path }: { path: string }) => {
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
        directory.calls.push("batch");
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
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  it("still drops the account's pending writes when deleting the account", async () => {
    const workouts = createLocalStorageOutboxStore("sportime.outbox.workouts.u1");
    const history = createLocalStorageOutboxStore("sportime.outbox.history.u1");
    const routines = createLocalStorageOutboxStore("sportime.outbox.routines.u1");
    workouts.save([{ id: "w1", draft: {} }]);
    history.save([{ id: "h1", draft: {} }]);
    routines.save([{ id: "r1", draft: {} }]);
    const data = createFirestoreAccountData({
      db: {} as never,
      userId: "u1",
      email: () => "u1@example.com",
      discardPendingWrites: () => {
        workouts.save([]);
        history.save([]);
        routines.save([]);
      },
    });

    await data.erase();

    expect(localStorage.getItem("sportime.outbox.workouts.u1")).toBeNull();
    expect(localStorage.getItem("sportime.outbox.history.u1")).toBeNull();
    expect(localStorage.getItem("sportime.outbox.routines.u1")).toBeNull();
  });

  it("erases the account's workouts, history and routines, and no other account's", async () => {
    server.set("users/u1/workouts", ["w1", "w2"]);
    server.set("users/u1/history", ["h1"]);
    server.set("users/u1/routines", ["r1", "r2"]);
    server.set("users/u2/routines", ["r3"]);

    await accountData("u1@example.com").erase();

    expect(server.get("users/u1/workouts")).toEqual([]);
    expect(server.get("users/u1/history")).toEqual([]);
    expect(server.get("users/u1/routines")).toEqual([]);
    expect(server.get("users/u2/routines")).toEqual(["r3"]);
  });

  it("removes the account's directory entry first, under its normalized email", async () => {
    directory.entries.set("directory/u1@example.com", { uid: "u1" });
    directory.entries.set("directory/u2@example.com", { uid: "u2" });
    server.set("users/u1/routines", ["r1"]);

    await accountData(" U1@Example.com ").erase();

    expect(directory.entries.has("directory/u1@example.com")).toBe(false);
    expect(directory.entries.has("directory/u2@example.com")).toBe(true);
    expect(directory.calls[0]).toBe("delete directory/u1@example.com");
    expect(server.get("users/u1/routines")).toEqual([]);
  });

  it("erases the rest when the account was never listed", async () => {
    server.set("users/u1/routines", ["r1"]);

    await accountData("u1@example.com").erase();

    expect(server.get("users/u1/routines")).toEqual([]);
  });

  it("leaves an entry another account holds under the same email", async () => {
    directory.entries.set("directory/u1@example.com", { uid: "u9" });

    await accountData("u1@example.com").erase();

    expect(directory.entries.get("directory/u1@example.com")).toEqual({ uid: "u9" });
  });

  it("erases the rest for an account without an email", async () => {
    server.set("users/u1/workouts", ["w1"]);

    await accountData(null).erase();

    expect(server.get("users/u1/workouts")).toEqual([]);
    expect(directory.calls.filter((call) => call.startsWith("delete"))).toEqual([]);
  });
});
