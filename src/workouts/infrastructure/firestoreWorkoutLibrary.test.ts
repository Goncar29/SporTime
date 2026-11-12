import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { OutboxStore } from "../../shared/application/outbox";
import type { SavedWorkoutDraft } from "../domain/savedWorkout";
import { defaultConfig, toStoredConfig } from "../domain/workout";
import { createFirestoreWorkoutLibrary } from "./firestoreWorkoutLibrary";

const firestore = vi.hoisted(() => ({
  /** Paths whose document this device's cache holds. */
  cached: new Set<string>(),
  updateDoc: vi.fn(() => Promise.resolve()),
  setDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  doc: (parent: { path: string }, id = "new-id") => ({ path: `${parent.path}/${id}` }),
  getDocFromCache: (ref: { path: string }) =>
    Promise.resolve({ exists: () => firestore.cached.has(ref.path) }),
  onSnapshot: () => () => undefined,
  orderBy: () => ({}),
  query: () => ({}),
  setDoc: firestore.setDoc,
  updateDoc: firestore.updateDoc,
  deleteDoc: () => Promise.resolve(),
}));

const PATH = "users/u1/workouts/w1";
const workout = { id: "w1", name: "Leg day", config: defaultConfig("tabata"), createdAt: 1_000 };
const edited = { ...workout, name: "Leg day, harder", config: defaultConfig("emom") };

function setup({ pending = false, ready = true } = {}) {
  let items = pending
    ? [{ id: "w1", draft: { name: "Leg day", config: workout.config, createdAt: 1_000 } }]
    : [];
  const store: OutboxStore<SavedWorkoutDraft> = {
    load: () => items,
    save(next) {
      items = next;
    },
  };
  const library = createFirestoreWorkoutLibrary({} as never, "u1", {
    store,
    // Not ready keeps a pending save in the outbox, as during a slow sign-in check.
    whenReady: () => (ready ? Promise.resolve(true) : new Promise(() => undefined)),
  });
  return { library, store };
}

describe("update", () => {
  beforeEach(() => {
    firestore.cached.clear();
    firestore.updateDoc.mockClear();
    firestore.setDoc.mockClear();
  });

  it("updates the stored document, which fails rather than recreating one deleted elsewhere", async () => {
    firestore.cached.add(PATH);
    const { library } = setup();
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { path: PATH },
      { name: edited.name, config: toStoredConfig(edited.config), createdAt: 1_000 },
    );
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it("only revises a save still waiting in the outbox, writing nothing twice", async () => {
    const { library, store } = setup({ pending: true, ready: false });
    await library.update(edited);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    expect(store.load()).toEqual([
      { id: "w1", draft: { name: edited.name, config: edited.config, createdAt: 1_000 } },
    ]);
  });

  it("updates Firestore once the outbox has already handed it over", async () => {
    firestore.cached.add(PATH);
    const { library } = setup({ pending: true, ready: false });
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
  });

  it("asks Firestore about a workout it knows nothing of, so a deleted one is refused", async () => {
    const { library } = setup();
    await library.update(edited);
    expect(firestore.updateDoc).toHaveBeenCalledOnce();
  });
});
