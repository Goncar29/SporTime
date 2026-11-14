import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLocalStorageOutboxStore } from "../../shared/infrastructure/localStorageOutboxStore";
import { createFirestoreAccountData } from "./firestoreAccountData";

vi.mock("firebase/firestore", () => ({
  collection: () => ({}),
  getDocsFromServer: () => Promise.resolve({ empty: true, docs: [] }),
  limit: () => ({}),
  query: () => ({}),
  writeBatch: () => ({ delete: () => undefined, commit: () => Promise.resolve() }),
}));

describe("createFirestoreAccountData", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  it("still drops the account's pending writes when deleting the account", async () => {
    const workouts = createLocalStorageOutboxStore("sportime.outbox.workouts.u1");
    const history = createLocalStorageOutboxStore("sportime.outbox.history.u1");
    workouts.save([{ id: "w1", draft: {} }]);
    history.save([{ id: "h1", draft: {} }]);
    const data = createFirestoreAccountData({
      db: {} as never,
      userId: "u1",
      discardPendingWrites: () => {
        workouts.save([]);
        history.save([]);
      },
    });

    await data.erase();

    expect(localStorage.getItem("sportime.outbox.workouts.u1")).toBeNull();
    expect(localStorage.getItem("sportime.outbox.history.u1")).toBeNull();
  });
});
