import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLocalStorageOutboxStore } from "../../shared/infrastructure/localStorageOutboxStore";
import { createFirestoreAccountData } from "./firestoreAccountData";

/** The server's documents by collection path, emptied as the batches delete them. */
const server = vi.hoisted(() => new Map<string, string[]>());

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join("/") }),
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
        return Promise.resolve();
      },
    };
  },
}));

describe("createFirestoreAccountData", () => {
  beforeEach(() => {
    localStorage.clear();
    server.clear();
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
    const data = createFirestoreAccountData({
      db: {} as never,
      userId: "u1",
      discardPendingWrites: () => undefined,
    });

    await data.erase();

    expect(server.get("users/u1/workouts")).toEqual([]);
    expect(server.get("users/u1/history")).toEqual([]);
    expect(server.get("users/u1/routines")).toEqual([]);
    expect(server.get("users/u2/routines")).toEqual(["r3"]);
  });
});
