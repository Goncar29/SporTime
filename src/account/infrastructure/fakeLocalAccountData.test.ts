import { beforeEach, expect, it } from "vite-plus/test";
import { createFakeLocalAccountData } from "./fakeLocalAccountData";

const kept = {
  "sportime.language": "es",
  "sportime.seenRoutines.other": '["c9"]',
  "sportime.outbox.blocked.other": '[{"id":"x","draft":{}}]',
};

beforeEach(() => {
  localStorage.clear();
});

it("erases on sign-out what the production sign-out erases: seen marks and held blocks (L69 A3)", async () => {
  localStorage.setItem("sportime.seenRoutines.me", '["c1"]');
  localStorage.setItem(
    "sportime.outbox.blocked.me",
    '[{"id":"alice","draft":{"uid":"alice","name":"Alice","email":"alice@example.com"}}]',
  );
  Object.entries(kept).forEach(([key, value]) => {
    localStorage.setItem(key, value);
  });

  await createFakeLocalAccountData("me").erase();

  expect(localStorage.getItem("sportime.seenRoutines.me")).toBeNull();
  expect(localStorage.getItem("sportime.outbox.blocked.me")).toBeNull();
  // Other accounts and the device's own settings stay.
  expect(Object.fromEntries(Object.entries(localStorage))).toEqual(kept);
});

it("keeps sign-out as it was otherwise: nothing waits to be sent, and nothing is cached", async () => {
  const local = createFakeLocalAccountData("me");
  await expect(local.sendPending()).resolves.toBe("sent");
  expect(() => {
    local.discardPending();
    local.eraseOnNextStart();
    local.keepOnNextStart();
  }).not.toThrow();
});
