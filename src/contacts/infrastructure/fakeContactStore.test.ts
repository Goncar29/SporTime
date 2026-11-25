import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createFakeDirectoryListing } from "../../directory/infrastructure/fakeDirectoryListing";
import { ContactRefused, type Contact } from "../domain/contact";
import { createFakeContactStore } from "./fakeContactStore";

const bob = {
  id: "bob",
  name: "Bob Stone",
  email: "Bob@Example.com",
  photoUrl: "https://lh3.googleusercontent.com/a/bob",
};

const kindOf = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (error: unknown) => (error instanceof ContactRefused ? error.kind : error),
  );

describe("createFakeContactStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("adds someone listed in the fake directory, lists and removes them", async () => {
    await createFakeDirectoryListing(bob).list();
    const contacts = createFakeContactStore("alice");
    const seen: Contact[][] = [];
    contacts.subscribe(
      (items) => seen.push(items),
      () => undefined,
    );
    const added = await contacts.add(" bob@example.com ");
    await added.saved;
    expect(seen.at(-1)).toEqual([
      { uid: "bob", name: "Bob Stone", photo: bob.photoUrl, email: "bob@example.com" },
    ]);
    // Kept across a reload, per account.
    const reloaded: Contact[][] = [];
    createFakeContactStore("alice").subscribe(
      (items) => reloaded.push(items),
      () => undefined,
    );
    const other: Contact[][] = [];
    createFakeContactStore("carol").subscribe(
      (items) => other.push(items),
      () => undefined,
    );
    expect(reloaded.at(-1)).toHaveLength(1);
    expect(other.at(-1)).toEqual([]);
    await contacts.remove("bob");
    expect(seen.at(-1)).toEqual([]);
  });

  it("refuses like the real list", async () => {
    await createFakeDirectoryListing(bob).list();
    await createFakeDirectoryListing({ ...bob, id: "alice", email: "alice@example.com" }).list();
    const contacts = createFakeContactStore("alice");
    expect(await kindOf(contacts.add("nope"))).toBe("invalidEmail");
    expect(await kindOf(contacts.add("carol@example.com"))).toBe("notListed");
    expect(await kindOf(contacts.add("alice@example.com"))).toBe("self");
    await (
      await contacts.add("bob@example.com")
    ).saved;
    expect(await kindOf(contacts.add("bob@example.com"))).toBe("duplicate");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await kindOf(contacts.add("bob@example.com"))).toBe("offline");
  });
});
