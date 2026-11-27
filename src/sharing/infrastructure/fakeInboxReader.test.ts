import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { InboxCopy } from "../application/ports";
import { createFakeInboxReader } from "./fakeInboxReader";
import { fakeInboxOf } from "./fakeRoutineSharing";

const KEY = "sportime.fakeInbox.bob";
const copy = { fromUid: "alice", name: "Piernas", sentAt: 5 };

beforeEach(() => {
  localStorage.clear();
});

it("lists the copies in the user's fake inbox, then each change another page makes", () => {
  localStorage.setItem(KEY, JSON.stringify({ c1: copy }));
  const reports: InboxCopy[][] = [];
  const stop = createFakeInboxReader("bob").subscribe(
    (copies) => reports.push(copies),
    () => undefined,
  );
  expect(reports).toEqual([[{ id: "c1", data: copy }]]);

  localStorage.setItem(KEY, JSON.stringify({ c1: copy, c2: copy }));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  expect(reports.at(-1)?.map(({ id }) => id)).toEqual(["c1", "c2"]);

  // Another user's inbox changing is not this one's news.
  window.dispatchEvent(new StorageEvent("storage", { key: "sportime.fakeInbox.carol" }));
  expect(reports).toHaveLength(2);
  stop();
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  expect(reports).toHaveLength(2);
});

it("deletes a copy and reports the inbox without it", async () => {
  localStorage.setItem(KEY, JSON.stringify({ c1: copy, c2: copy }));
  const reader = createFakeInboxReader("bob");
  const reports: InboxCopy[][] = [];
  reader.subscribe(
    (copies) => reports.push(copies),
    () => undefined,
  );
  await reader.remove("c1");
  expect(Object.keys(fakeInboxOf("bob"))).toEqual(["c2"]);
  expect(reports.at(-1)?.map(({ id }) => id)).toEqual(["c2"]);
});

it("never answers a delete offline, as the server would not", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  localStorage.setItem(KEY, JSON.stringify({ c1: copy }));
  let settled = false;
  void createFakeInboxReader("bob")
    .remove("c1")
    .finally(() => {
      settled = true;
    });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).toBe(false);
  expect(Object.keys(fakeInboxOf("bob"))).toEqual(["c1"]);
  vi.restoreAllMocks();
});
