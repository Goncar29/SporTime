import { beforeEach, expect, it } from "vite-plus/test";
import type { Contact } from "../../contacts/domain/contact";
import type { BlockedSender } from "../domain/blockedSender";
import { createFakeBlockedSenders } from "./fakeBlockedSenders";
import { createFakeRoutineSharing, fakeInboxOf } from "./fakeRoutineSharing";

const alice: BlockedSender = { uid: "alice", name: "Alice", email: "alice@example.com" };
const bob: Contact = { uid: "bob", name: "Bob", photo: "", email: "bob@example.com" };

beforeEach(() => {
  localStorage.clear();
});

it("blocks, lists and unblocks senders, kept in localStorage as the rules keep them", async () => {
  const blocked = createFakeBlockedSenders("bob");
  const seen: BlockedSender[][] = [];
  blocked.subscribe(
    (items) => seen.push(items),
    () => undefined,
  );
  expect(seen.at(-1)).toEqual([]);
  await blocked.block(alice);
  expect(seen.at(-1)).toEqual([alice]);
  await blocked.unblock("alice");
  expect(seen.at(-1)).toEqual([]);
});

it("makes the fake sharing refuse a blocked sender's copies, like the rules", async () => {
  localStorage.setItem("sportime.fakeContacts.alice", JSON.stringify([bob]));
  const me = { id: "alice", name: "Alice", email: "alice@example.com", photoUrl: null };
  await createFakeBlockedSenders("bob").block(alice);
  const preparation = await createFakeRoutineSharing(me).prepare(
    { name: "Piernas", createdAt: 1, stages: [] },
    [bob],
  );
  if (preparation.kind !== "ready") throw new Error(preparation.kind);
  expect((await preparation.share.send()).map(({ outcome }) => outcome)).toEqual(["refused"]);
  expect(fakeInboxOf("bob")).toEqual({});
});
