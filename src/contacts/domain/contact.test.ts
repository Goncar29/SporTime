// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";
import {
  CONTACT_LIMITS,
  byName,
  contactFromEntry,
  isContactEmail,
  parseContact,
  refuseNewContact,
  toStoredContact,
  type Contact,
} from "./contact";

const bob: Contact = {
  uid: "bob",
  name: "Bob Stone",
  photo: "https://lh3.googleusercontent.com/a/bob=s96-c",
  email: "bob@example.com",
};

const contactsUpTo = (count: number): Contact[] =>
  Array.from({ length: count }, (_, index) => ({
    uid: `u${index}`,
    name: `User ${index}`,
    photo: "",
    email: `u${index}@example.com`,
  }));

describe("isContactEmail", () => {
  it("accepts a normalized address of up to 254 characters", () => {
    expect(isContactEmail("bob@example.com")).toBe(true);
    const longest = `${"a".repeat(CONTACT_LIMITS.emailLength - "@x.io".length)}@x.io`;
    expect(isContactEmail(longest)).toBe(true);
    expect(isContactEmail(`a${longest}`)).toBe(false);
  });

  it("refuses an address without exactly one @, or with spaces, slashes or control characters", () => {
    for (const email of [
      "",
      "bob",
      "@example.com",
      "bob@",
      "bob@@example.com",
      "bob@exa@mple.com",
      "bob smith@example.com",
      "bob@example.com/x",
      "a/b@example.com",
      "bob\u0000@example.com",
      "bob@example.com\u00a0",
    ]) {
      expect(isContactEmail(email)).toBe(false);
    }
  });
});

describe("contactFromEntry", () => {
  it("keeps the entry's uid, name and Google photo, with the email as added", () => {
    expect(
      contactFromEntry("bob@example.com", {
        uid: "bob",
        name: "Bob Stone",
        photo: "https://lh3.googleusercontent.com/a/bob=s96-c",
      }),
    ).toEqual(bob);
  });

  it("drops a photo from any other host and cleans the name like the directory", () => {
    expect(
      contactFromEntry("bob@example.com", {
        uid: "bob",
        name: "  Bob\tStone\u0000 \ud800",
        photo: "https://evil.com/bob.png",
      }),
    ).toEqual({ ...bob, photo: "", name: "Bob Stone" });
    expect(contactFromEntry("bob@example.com", { uid: "bob", name: 7 })).toEqual({
      ...bob,
      name: "",
      photo: "",
    });
    expect(
      contactFromEntry("bob@example.com", { uid: "bob", name: "💪".repeat(80), photo: "" })?.name,
    ).toBe("💪".repeat(50));
  });

  it("refuses an entry without a usable uid, or a bad email", () => {
    for (const entry of [
      null,
      "bob",
      {},
      { uid: "" },
      { uid: 7 },
      { uid: "a/b" },
      { uid: "x".repeat(CONTACT_LIMITS.uidLength + 1) },
    ]) {
      expect(contactFromEntry("bob@example.com", entry)).toBeNull();
    }
    expect(contactFromEntry("not an email", { uid: "bob" })).toBeNull();
  });
});

describe("parseContact", () => {
  it("reads a stored contact whose id is its uid", () => {
    expect(parseContact("bob", toStoredContact(bob))).toEqual(bob);
  });

  it("refuses a contact stored under another id, or without a valid email", () => {
    expect(parseContact("carol", bob)).toBeNull();
    expect(parseContact("bob", { ...bob, email: "nope" })).toBeNull();
    expect(parseContact("bob", null)).toBeNull();
  });

  it("cleans what it reads", () => {
    expect(parseContact("bob", { ...bob, name: "Bob\nStone", photo: "javascript:x" })).toEqual({
      ...bob,
      name: "Bob Stone",
      photo: "",
    });
  });
});

describe("toStoredContact", () => {
  it("writes exactly uid, name, photo and email, cleaned", () => {
    expect(toStoredContact({ ...bob, name: "Bob\u0007", extra: 1 } as Contact)).toEqual({
      ...bob,
      name: "Bob",
    });
  });
});

describe("refuseNewContact", () => {
  it("accepts a new contact", () => {
    expect(refuseNewContact([], bob, "alice")).toBeNull();
    expect(refuseNewContact(contactsUpTo(CONTACT_LIMITS.contacts - 1), bob, "alice")).toBeNull();
  });

  it("refuses yourself", () => {
    expect(refuseNewContact([], { ...bob, uid: "alice" }, "alice")).toBe("self");
  });

  it("refuses someone already in the list", () => {
    expect(refuseNewContact([bob], { ...bob, name: "Bobby" }, "alice")).toBe("duplicate");
  });

  it("refuses more than 50 contacts", () => {
    expect(CONTACT_LIMITS.contacts).toBe(50);
    expect(refuseNewContact(contactsUpTo(50), bob, "alice")).toBe("full");
  });
});

describe("byName", () => {
  it("orders by name, then by email for the same or no name", () => {
    const list: Contact[] = [
      { ...bob, uid: "c", name: "carol", email: "c@x.io" },
      { ...bob, uid: "z", name: "", email: "z@x.io" },
      { ...bob, uid: "a", name: "Ana", email: "a@x.io" },
      { ...bob, uid: "y", name: "", email: "y@x.io" },
    ];
    expect([...list].sort(byName).map(({ uid }) => uid)).toEqual(["a", "c", "y", "z"]);
  });
});
