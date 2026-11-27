import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Contact } from "../../contacts/domain/contact";
import type { RoutineDraft } from "../../routines/domain/routine";
import { createFakeRoutineSharing, fakeInboxOf } from "./fakeRoutineSharing";

const me = { id: "me", name: "Me", email: "me@example.com", photoUrl: null };
const bob: Contact = { uid: "bob", name: "Bob", photo: "", email: "bob@example.com" };
const carol: Contact = { uid: "carol", name: "Carol", photo: "", email: "carol@example.com" };
const routine: RoutineDraft = { name: "Piernas", createdAt: 1, stages: [] };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("sportime.fakeContacts.me", JSON.stringify([bob]));
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("keeps copies in the recipient's inbox, refusing like the rules", async () => {
  const preparation = await createFakeRoutineSharing(me).prepare(routine, [bob, carol]);
  if (preparation.kind !== "ready") throw new Error(preparation.kind);
  expect(
    (await preparation.share.send()).map(({ contact, outcome }) => [contact.uid, outcome]),
  ).toEqual([
    ["bob", "sent"],
    ["carol", "refused"],
  ]);
  expect(Object.values(fakeInboxOf("bob"))).toEqual([
    {
      fromUid: "me",
      fromEmail: "me@example.com",
      fromName: "Me",
      name: "Piernas",
      stages: [],
      // Set on arrival, as the rules make the server's time the copy's sentAt.
      sentAt: expect.any(Number),
    },
  ]);
  expect(fakeInboxOf("carol")).toEqual({});
});

it("needs a connection", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  expect(await createFakeRoutineSharing(me).prepare(routine, [bob])).toEqual({ kind: "offline" });
});
