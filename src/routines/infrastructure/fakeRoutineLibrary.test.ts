import { beforeEach, expect, it } from "vite-plus/test";
import type { Routine } from "../domain/routine";
import { createFakeRoutineLibrary } from "./fakeRoutineLibrary";

const received: Routine = {
  id: "copy-1",
  name: "Piernas",
  createdAt: 5,
  stages: [],
  receivedFrom: { uid: "alice", name: "Alice", email: "alice@example.com" },
};

beforeEach(() => {
  localStorage.clear();
});

it("receives a routine under its own id, once, and tells the list", async () => {
  const library = createFakeRoutineLibrary("bob");
  const lists: Routine[][] = [];
  library.subscribe(
    (items) => lists.push(items),
    () => undefined,
  );
  await library.receive(received);
  await library.receive({ ...received, name: "Otra vez" });
  expect(lists.at(-1)).toEqual([received]);
});

it("leaves a received routine edited since as it is", async () => {
  const library = createFakeRoutineLibrary("bob");
  await library.receive(received);
  await library.update({ ...received, name: "Mía" });
  await library.receive(received);
  const lists: Routine[][] = [];
  library.subscribe(
    (items) => lists.push(items),
    () => undefined,
  );
  expect(lists.at(-1)).toEqual([{ ...received, name: "Mía" }]);
});
