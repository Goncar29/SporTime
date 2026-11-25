import { expect, test, type Page } from "@playwright/test";
import {
  accountExists,
  asksBeforeLeaving,
  cacheContains,
  clearEmulatorData,
  eventually,
  googleButton,
  holdWrites,
  markPage,
  openTab,
  reloaded,
  restoreNetwork,
  saveWorkout,
  signInAs,
  signOut,
  stallNetwork,
  startButton,
  stored,
  storedEntry,
  storedNames,
  uniqueName,
} from "./helpers";

test.beforeEach(clearEmulatorData);

interface Account {
  name: string;
  email: string;
  uid: string;
}

const openedPage = async (page: Page) => {
  await page.goto("/");
  await page.waitForFunction(() => "signInForTest" in window);
  return page;
};

/** Signs in a new account on an open page; the emulator's email is `{name}@example.com`. */
async function newAccount(page: Page, who: string): Promise<Account> {
  const name = uniqueName(who);
  const uid = await signInAs(page, name);
  return { name, email: `${name}@example.com`, uid };
}

/** What the server holds under an email in the directory, or null. */
const directoryEntry = async (email: string) => {
  const fields = await storedEntry(email);
  return (
    fields && {
      uid: fields.uid?.stringValue,
      name: fields.name?.stringValue,
      photo: fields.photo?.stringValue,
    }
  );
};

/** What the server holds as the account's contacts, each under its document id. */
const storedContacts = async (uid: string) =>
  (await stored(uid, "contacts")).map(({ name, fields }) => ({
    id: name.split("/").pop(),
    uid: fields.uid?.stringValue,
    name: fields.name?.stringValue,
    photo: fields.photo?.stringValue,
    email: fields.email?.stringValue,
  }));

const contactOf = ({ uid, name, email }: Account) => ({ id: uid, uid, name, photo: "", email });
const entryOf = ({ uid, name }: Account) => ({ uid, name, photo: "" });

const findMe = (page: Page) => page.getByRole("switch", { name: "Let people find me by email" });
const contactsItem = (page: Page) => page.getByRole("button", { name: /^Contacts/ });
const contactList = (page: Page) => page.getByRole("list", { name: "Contacts" });
const contactRow = (page: Page, { name }: Account) =>
  contactList(page).getByRole("listitem").filter({ hasText: name });
const signOutButton = (page: Page) => page.getByRole("button", { name: "Sign out" });

async function openContacts(page: Page) {
  await openTab(page, "Profile");
  await contactsItem(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
}

async function addContact(page: Page, email: string) {
  await page.getByRole("textbox", { name: "Contact's email" }).fill(email);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

async function deleteAccount(page: Page) {
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Delete account" }).click();
  await markPage(page);
  await page.getByRole("button", { name: "Delete my account" }).click();
  // Sign-in shows as soon as the account is gone; the page reloads once this device's cache is
  // cleared, so anything read from the page waits for that.
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
}

/**
 * Signs in a new account, lets people find it by email from Profile, and signs it out again:
 * its directory entry stays on the server, so others can add it.
 */
async function listedAccount(page: Page, who: string): Promise<Account> {
  const account = await newAccount(page, who);
  await openTab(page, "Profile");
  await expect(findMe(page)).toBeEnabled();
  await findMe(page).click();
  await eventually(() => directoryEntry(account.email)).toEqual(entryOf(account));
  await signOut(page);
  expect(await directoryEntry(account.email)).toEqual(entryOf(account));
  return account;
}

test("the find-by-email switch lists and unlists the account, the same on Profile and Contacts", async ({
  page,
}) => {
  const bob = await newAccount(await openedPage(page), "bob");
  await openTab(page, "Profile");
  await expect(findMe(page)).toBeEnabled();
  await expect(findMe(page)).not.toBeChecked();
  expect(await directoryEntry(bob.email)).toBeNull();

  await findMe(page).click();
  await eventually(() => directoryEntry(bob.email)).toEqual(entryOf(bob));
  await expect(findMe(page)).toBeChecked();

  await contactsItem(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
  await expect(findMe(page)).toBeChecked();
  await expect(findMe(page)).toHaveAccessibleDescription(
    /^Turn it on so others can add you as a contact\./,
  );

  await findMe(page).click();
  await eventually(() => directoryEntry(bob.email)).toBeNull();
  await expect(findMe(page)).not.toBeChecked();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(findMe(page)).not.toBeChecked();

  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await openTab(page, "Profile");
  await expect(findMe(page)).toBeEnabled();
  await expect(findMe(page)).not.toBeChecked();
  expect(await directoryEntry(bob.email)).toBeNull();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a contact added by email is listed, counted in Profile and kept on the server; refusals say why; removing asks first", async ({
  page,
}) => {
  const bob = await listedAccount(await openedPage(page), "bob");
  const alice = await newAccount(page, "alice");

  await openTab(page, "Profile");
  await expect(contactsItem(page)).toHaveAccessibleName("Contacts, 0 contacts");
  await openContacts(page);
  await expect(page.getByText("0 of 50 contacts")).toBeVisible();
  await addContact(page, `  ${bob.email.toUpperCase()} `);

  await expect(page.getByRole("status").filter({ hasText: "Contact added." })).toBeVisible();
  const row = contactRow(page, bob);
  await expect(row).toHaveCount(1);
  await expect(row.getByText(bob.name, { exact: true })).toBeVisible();
  await expect(row.getByText(bob.email, { exact: true })).toBeVisible();
  // No Google photo here, so the name's initial stands in for it.
  await expect(row.getByRole("img")).toHaveCount(0);
  await expect(row.locator("[aria-hidden='true']").first()).toHaveText("B");
  await expect(page.getByText("1 of 50 contacts")).toBeVisible();
  await eventually(() => storedContacts(alice.uid)).toEqual([contactOf(bob)]);

  await addContact(page, "nobody@example.com");
  await expect(page.getByRole("alert")).toHaveText(
    "Nobody can be found by that email. Ask them to turn on “Let people find me by email” in their Profile.",
  );
  await addContact(page, bob.email);
  await expect(page.getByRole("alert")).toHaveText("That person is already in your contacts.");
  // Only someone listed can be found, so the account lists itself before trying its own email.
  await findMe(page).click();
  await eventually(() => directoryEntry(alice.email)).toEqual(entryOf(alice));
  await addContact(page, alice.email);
  await expect(page.getByRole("alert")).toHaveText("That is your own email.");
  await expect(contactList(page).getByRole("listitem")).toHaveCount(1);
  expect(await storedContacts(alice.uid)).toEqual([contactOf(bob)]);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(contactsItem(page)).toHaveAccessibleName("Contacts, 1 contact");
  await expect(contactsItem(page)).toHaveText("Contacts · 1");

  await contactsItem(page).click();
  await row.getByRole("button", { name: /^Remove / }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toHaveAccessibleName(/^Remove .+ from your contacts\?$/);
  await expect(dialog).toContainText(bob.name);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(1);

  await row.getByRole("button", { name: /^Remove / }).click();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText(/^No contacts yet\./)).toBeVisible();
  await eventually(() => storedContacts(alice.uid)).toEqual([]);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(contactsItem(page)).toHaveAccessibleName("Contacts, 0 contacts");

  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await openContacts(page);
  await expect(page.getByText(/^No contacts yet\./)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // Removing a contact leaves their own entry alone.
  expect(await directoryEntry(bob.email)).toEqual(entryOf(bob));
});

test("signing out sends a pending contact, erases this device's copy and keeps the server's", async ({
  page,
  context,
}) => {
  const bob = await listedAccount(await openedPage(page), "bob");
  const alice = await newAccount(page, "alice");
  await openContacts(page);

  // The contact waits for the server until the test lets it through, after sign-out starts.
  const writes = await holdWrites(context);
  await addContact(page, bob.email);
  await expect(contactRow(page, bob)).toHaveCount(1);
  // Proves the checks of the device below can fail: the contact is held here now.
  await expect.poll(() => cacheContains(page, bob.email)).toBe(true);

  await openTab(page, "Profile");
  await markPage(page);
  await signOutButton(page).click();
  await expect(page.getByRole("status").filter({ hasText: "Signing out…" })).toBeVisible();
  // Still unsent when sign-out started, so sign-out is what sends it.
  expect(await storedContacts(alice.uid)).toEqual([]);
  await writes.release();
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible();

  expect(await storedContacts(alice.uid)).toEqual([contactOf(bob)]);
  expect(await cacheContains(page, bob.email)).toBe(false);
  expect(
    await page.evaluate(
      (needle) => Object.values(localStorage).some((value) => value.includes(needle)),
      bob.email,
    ),
  ).toBe(false);
  // Signing out never takes anyone out of the directory.
  expect(await directoryEntry(bob.email)).toEqual(entryOf(bob));

  await signInAs(page, alice.name);
  await openTab(page, "Profile");
  await expect(contactsItem(page)).toHaveAccessibleName("Contacts, 1 contact", {
    timeout: 30_000,
  });
  await contactsItem(page).click();
  await expect(contactRow(page, bob).getByText(bob.email, { exact: true })).toBeVisible();
});

test("deleting an account removes its directory entry and its contacts, not others' copies", async ({
  page,
}) => {
  const bob = await listedAccount(await openedPage(page), "bob");
  const alice = await newAccount(page, "alice");
  await openContacts(page);
  await addContact(page, bob.email);
  await eventually(() => storedContacts(alice.uid)).toEqual([contactOf(bob)]);
  await signOut(page);

  await signInAs(page, bob.name);
  await openTab(page, "Profile");
  await expect(findMe(page)).toBeChecked();
  await deleteAccount(page);
  expect(await accountExists(bob.uid)).toBe(false);
  expect(await directoryEntry(bob.email)).toBeNull();
  // Not even the marker Firestore keeps on this device for the deleted entry, named by his email.
  await expect.poll(() => cacheContains(page, bob.email)).toBe(false);
  // Alice keeps what she saw when she added him.
  expect(await storedContacts(alice.uid)).toEqual([contactOf(bob)]);

  await signInAs(page, alice.name);
  await openContacts(page);
  await expect(contactRow(page, bob).getByText(bob.email, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // The contact as stored data, not the id of a document the device knows is gone; proves the
  // search below can find it: without this it could never fail.
  const contactData = `"stringValue":"${bob.email}"`;
  await expect.poll(() => cacheContains(page, contactData)).toBe(true);

  // Alice was never listed, so her deletion finds no entry to remove.
  await deleteAccount(page);
  expect(await accountExists(alice.uid)).toBe(false);
  expect(await storedContacts(alice.uid)).toEqual([]);
  expect(await directoryEntry(alice.email)).toBeNull();
  await expect.poll(() => cacheContains(page, contactData)).toBe(false);
});

test("a switch change made in another tab while one signs out waits, and is saved when that tab stays", async ({
  page,
  context,
}) => {
  const bob = await newAccount(await openedPage(page), "bob");
  const other = await context.newPage();
  await other.goto("/");
  await openTab(other, "Profile");
  await expect(findMe(other)).toBeEnabled();
  await expect(findMe(other)).not.toBeChecked();

  // Something left to send on a stalled network keeps this tab signing out until the warning.
  await stallNetwork(context);
  await saveWorkout(page, "Stalled");
  await openTab(page, "Profile");
  await signOutButton(page).click();
  const notice = other.getByText("Signing out in another tab…");
  await expect(notice).toBeVisible();

  // A press that lands just as the other tab starts signing out.
  await expect(other.locator("[inert]").getByRole("switch")).toHaveCount(1);
  await findMe(other).dispatchEvent("click");
  // It waits for the sign-out, only in that tab's memory, so leaving the tab would ask first.
  await expect.poll(() => asksBeforeLeaving(other)).toBe(true);
  expect(await directoryEntry(bob.email)).toBeNull();

  const warning = page.getByRole("alertdialog");
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => asksBeforeLeaving(other)).toBe(false);
  await warning.getByRole("button", { name: "Stay" }).click();
  await expect(notice).toHaveCount(0);
  await expect(findMe(other)).toBeChecked();

  await restoreNetwork(context);
  await eventually(() => directoryEntry(bob.email)).toEqual(entryOf(bob));
  await eventually(() => storedNames(bob.uid)).toEqual(["Stalled"]);
  await expect(other.getByRole("alert")).toHaveCount(0);
  expect(await other.evaluate(() => window.currentUidForTest())).toBe(bob.uid);
});

test("a switch change the server never answered is reported lost when another tab signs out anyway", async ({
  page,
  context,
}) => {
  const bob = await newAccount(await openedPage(page), "bob");
  const other = await context.newPage();
  await other.goto("/");
  await openTab(other, "Profile");
  await expect(findMe(other)).toBeEnabled();

  // Stored on this device, so the switch shows it, but the server cannot answer it offline.
  await context.setOffline(true);
  await findMe(other).click();
  await expect(findMe(other)).toBeChecked();
  expect(await directoryEntry(bob.email)).toBeNull();

  await openTab(page, "Profile");
  await signOutButton(page).click();
  const warning = page.getByRole("alertdialog");
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await markPage(page);
  await markPage(other);
  // Watched from before the press: the message shows only until the other tab reloads, which
  // may come before the press returns, as a click waits for this tab's own reload. Under load
  // the sign-out can take longer than the default 5 s to reach the other tab.
  const lost = expect(
    other.getByRole("alert").filter({ hasText: "Couldn't save: you signed out in another tab." }),
  ).toBeVisible({ timeout: 30_000 });
  await warning.getByRole("button", { name: "Sign out anyway" }).click();
  await lost;
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible();
  await reloaded(other);
  await expect(googleButton(other)).toBeVisible();

  // Nothing of bob's is left on the device, the dropped change included.
  expect(await cacheContains(other, bob.uid)).toBe(false);

  // Pending writes belong to their account, so a kept one would be sent once bob is back.
  await context.setOffline(false);
  expect(await signInAs(other, bob.name)).toBe(bob.uid);
  // Writes reach the server in the order they were made, so once this one is there, a kept
  // switch change would be there too.
  await saveWorkout(other, "After");
  await eventually(() => storedNames(bob.uid)).toEqual(["After"]);
  expect(await directoryEntry(bob.email)).toBeNull();
  await openTab(other, "Profile");
  await expect(findMe(other)).toBeEnabled();
  await expect(findMe(other)).not.toBeChecked();
});
