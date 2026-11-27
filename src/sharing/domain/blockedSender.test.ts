// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import { ROUTINE_LIMITS } from "../../routines/domain/routine";
import {
  blockedSenderOf,
  byShownName,
  isBlocked,
  parseBlockedSender,
  shownSenderName,
  toStoredBlockedSender,
} from "./blockedSender";

const alice = { uid: "alice", name: "Alice Liddell", email: "alice@example.com" };

describe("a blocked sender (T27, S7)", () => {
  it("is the sender of a received routine: their uid, and the name and email it showed", () => {
    expect(blockedSenderOf(alice)).toEqual(alice);
    // The photo a received routine keeps (T29 W3) is never part of a block.
    expect(
      blockedSenderOf({ ...alice, photo: "https://lh3.googleusercontent.com/a/alice" }),
    ).toEqual(alice);
    expect(toStoredBlockedSender(alice)).toEqual({
      name: "Alice Liddell",
      email: "alice@example.com",
    });
  });

  it("is stored as exactly its name and email, under the uid", () => {
    expect(Object.keys(toStoredBlockedSender({ ...alice, extra: 1 } as never)).sort()).toEqual([
      "email",
      "name",
    ]);
    expect(
      parseBlockedSender("alice", { name: "Alice Liddell", email: "alice@example.com" }),
    ).toEqual(alice);
  });

  it("reads back a draft held by the outbox, taking the uid from the id", () => {
    expect(parseBlockedSender("alice", { ...alice, uid: "someone-else" })).toEqual(alice);
  });

  it("keeps an empty or unusable name as empty, and needs a usable uid and email", () => {
    expect(parseBlockedSender("alice", { name: "", email: alice.email })).toEqual({
      ...alice,
      name: "",
    });
    expect(parseBlockedSender("alice", { name: "a\nb", email: alice.email })?.name).toBe("");
    expect(
      parseBlockedSender("alice", {
        name: "N".repeat(ROUTINE_LIMITS.senderNameLength + 1),
        email: alice.email,
      })?.name,
    ).toBe("");
    expect(parseBlockedSender("alice", { name: "Alice" })).toBeNull();
    expect(parseBlockedSender("alice", { name: "Alice", email: "not an email" })).toBeNull();
    expect(parseBlockedSender("", { name: "Alice", email: alice.email })).toBeNull();
    expect(parseBlockedSender("a/b", { name: "Alice", email: alice.email })).toBeNull();
    expect(parseBlockedSender("alice", { name: "A", email: "a\u0007@b.co" })).toBeNull();
    // Any email a verified sign-in may hold, as the rules keep it (T29 W4).
    for (const email of ["a/b@example.com", '"al ice"@example.com', '"a@b"@example.com']) {
      expect(parseBlockedSender("alice", { name: "A", email })?.email).toBe(email);
    }
    expect(parseBlockedSender("alice", null)).toBeNull();
    expect(parseBlockedSender("alice", "alice")).toBeNull();
  });

  it("is shown by its name, or by its email when the name shows nothing", () => {
    expect(shownSenderName(alice)).toBe("Alice Liddell");
    expect(shownSenderName({ ...alice, name: "  " })).toBe("alice@example.com");
    expect(shownSenderName({ ...alice, name: "" })).toBe("alice@example.com");
  });

  it("is listed by the name shown", () => {
    const zoe = { uid: "z", name: "zoe", email: "z@example.com" };
    const ana = { uid: "a", name: "", email: "ana@example.com" };
    expect([zoe, alice, ana].sort(byShownName)).toEqual([alice, ana, zoe]);
  });

  it("tells whether a sender's uid is in the list", () => {
    expect(isBlocked([alice], "alice")).toBe(true);
    expect(isBlocked([alice], "bob")).toBe(false);
    expect(isBlocked(null, "alice")).toBe(false);
  });
});
