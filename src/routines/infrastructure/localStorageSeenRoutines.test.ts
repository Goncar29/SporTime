import { beforeEach, expect, it } from "vite-plus/test";
import { createLocalStorageSeenRoutines, seenRoutinesKey } from "./localStorageSeenRoutines";

beforeEach(() => {
  localStorage.clear();
});

it("keeps which received routines were seen on this device, per account", () => {
  const seen = createLocalStorageSeenRoutines("u1");
  expect(seen.load()).toEqual([]);
  seen.save(["r1", "r2"]);
  expect(createLocalStorageSeenRoutines("u1").load()).toEqual(["r1", "r2"]);
  expect(createLocalStorageSeenRoutines("u2").load()).toEqual([]);
  expect(seenRoutinesKey("u1")).toBe("sportime.seenRoutines.u1");
});

it("erases its key, leaving everything else", () => {
  localStorage.setItem("sportime.language", "es");
  const seen = createLocalStorageSeenRoutines("u1");
  seen.save(["r1"]);
  createLocalStorageSeenRoutines("u2").save(["r9"]);
  seen.erase();
  expect(localStorage.getItem("sportime.seenRoutines.u1")).toBeNull();
  expect(createLocalStorageSeenRoutines("u2").load()).toEqual(["r9"]);
  expect(localStorage.getItem("sportime.language")).toBe("es");
});

it("reads anything it cannot use as nothing seen", () => {
  for (const raw of ["not json", "{}", "[1, null]", "null"]) {
    localStorage.setItem("sportime.seenRoutines.u1", raw);
    expect(createLocalStorageSeenRoutines("u1").load()).toEqual([]);
  }
  localStorage.setItem("sportime.seenRoutines.u1", JSON.stringify(["r1", 2]));
  expect(createLocalStorageSeenRoutines("u1").load()).toEqual(["r1"]);
});
