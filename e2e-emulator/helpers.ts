import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { openTab } from "../e2e/helpers";

export { openTab };

const DOCUMENTS = "127.0.0.1:8080/v1/projects/demo-sportime/databases/(default)/documents";
const EMULATOR_CALLS = /127\.0\.0\.1:(8080|9099)/;

/** Firestore's REST encoding of a value; only the kinds these tests read. */
interface StoredValue {
  stringValue?: string;
  integerValue?: string;
  mapValue?: { fields?: Record<string, StoredValue> };
  arrayValue?: { values?: StoredValue[] };
}

interface StoredDocument {
  /** The full path, which ends with the document's id. */
  name: string;
  fields: Record<string, StoredValue>;
}

/** Reads what the server really holds, bypassing the rules and the page. */
export async function stored(
  uid: string,
  kind: "workouts" | "history" | "routines" | "contacts" | "inbox" | "blocked",
): Promise<StoredDocument[]> {
  const response = await fetch(`http://${DOCUMENTS}/users/${uid}/${kind}?pageSize=300`, {
    headers: { Authorization: "Bearer owner" },
  });
  const body = (await response.json()) as { documents?: StoredDocument[] };
  return body.documents ?? [];
}

/** The directory entry the server holds under a normalized email, or null when there is none. */
export async function storedEntry(email: string): Promise<Record<string, StoredValue> | null> {
  const response = await fetch(`http://${DOCUMENTS}/directory/${encodeURIComponent(email)}`, {
    headers: { Authorization: "Bearer owner" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore emulator answered ${response.status}`);
  return ((await response.json()) as StoredDocument).fields;
}

/**
 * Writes a document of string fields at a path under `documents`, bypassing the rules and the
 * page, as data the app did not write itself.
 */
export async function writeStored(path: string, fields: Record<string, string>) {
  const response = await fetch(`http://${DOCUMENTS}/${path}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, { stringValue: value }]),
      ),
    }),
  });
  if (!response.ok) throw new Error(`Firestore emulator answered ${response.status}`);
}

/** Deletes a stored document as another device would, bypassing the rules and the page. */
export async function deleteStored(documentName: string) {
  const response = await fetch(`http://127.0.0.1:8080/v1/${documentName}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer owner" },
  });
  if (!response.ok) throw new Error(`Firestore emulator answered ${response.status}`);
}

/** Asks the Auth emulator directly, so a page that merely looks signed out cannot pass. */
export async function accountExists(uid: string): Promise<boolean> {
  const response = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-sportime/accounts:lookup",
    {
      method: "POST",
      headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  if (!response.ok) throw new Error(`Auth emulator answered ${response.status}`);
  const body = (await response.json()) as { users?: unknown[] };
  return (body.users?.length ?? 0) > 0;
}

export const storedNames = async (uid: string) =>
  (await stored(uid, "workouts"))
    .map(({ fields }) => fields.name?.stringValue)
    .sort((a = "", b = "") => (a < b ? -1 : a > b ? 1 : 0));

/** A new account each time: a late write from one test can never reach another. */
let accounts = 0;
export const uniqueName = (name: string) => `${name}-${Date.now()}-${++accounts}`;

export async function signIn(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.waitForFunction(() => "signInForTest" in window);
  await page.evaluate((who) => window.signInForTest(who), uniqueName(name));
  await expect(startButton(page)).toBeVisible();
  const uid = await page.evaluate(() => window.currentUidForTest());
  if (!uid) throw new Error("Sign-in reported no user");
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  return uid;
}

/** The emulator's first write after starting can take many seconds on a slow machine. */
export const eventually = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: 60_000 });

export const startButton = (page: Page) => page.getByRole("button", { name: /^Start/ });
export const savedButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

export async function saveWorkout(page: Page, name: string) {
  await openTab(page, "Timer");
  await page.getByRole("textbox", { name: "Workout name" }).fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

export async function finishStopwatch(page: Page) {
  await openTab(page, "Timer");
  await page.getByRole("button", { name: /^Stopwatch/ }).click();
  await startButton(page).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "New workout" }).click();
}

/** Calls hang with `navigator.onLine` still true, like a stalled gym network. */
export const stallNetwork = (context: BrowserContext) =>
  context.route(EMULATOR_CALLS, () => undefined);
export const restoreNetwork = (context: BrowserContext) => context.unroute(EMULATOR_CALLS);

const WRITES = /\/Write\/channel/;

/**
 * Holds every request that carries writes to the server until `release`, which lets them go on
 * as they were, so the writes then reach the server when the test decides.
 */
export async function holdWrites(context: BrowserContext) {
  const held: Route[] = [];
  await context.route(WRITES, (route) => {
    held.push(route);
  });
  return {
    async release() {
      await context.unroute(WRITES);
      await Promise.all(held.splice(0).map((route) => route.continue().catch(() => undefined)));
    },
  };
}

/** Writes this browser's Firestore still holds to send, from every tab (its "mutations" store). */
export const queuedWrites = (page: Page) =>
  page.evaluate(async () => {
    let count = 0;
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("firestore/")) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error("Could not open the cache"));
        };
      });
      if (db.objectStoreNames.contains("mutations")) {
        count += await new Promise<number>((resolve, reject) => {
          const request = db.transaction("mutations").objectStore("mutations").count();
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(new Error("Could not read the cache"));
          };
        });
      }
      db.close();
    }
    return count;
  });

/**
 * True when leaving the page now would make the browser ask first. A synthetic event, so no
 * dialog opens; the page's own handler decides as it would for a real close or reload.
 */
export const asksBeforeLeaving = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

export async function clearEmulatorData() {
  await fetch(
    "http://127.0.0.1:8080/emulator/v1/projects/demo-sportime/databases/(default)/documents",
    { method: "DELETE" },
  );
}

export const googleButton = (page: Page) =>
  page.getByRole("button", { name: "Continue with Google" });

/** Signs in on a page that is already open, without loading it again. */
export async function signInAs(page: Page, name: string): Promise<string> {
  await page.evaluate((who) => window.signInForTest(who), name);
  await expect(startButton(page)).toBeVisible();
  const uid = await page.evaluate(() => window.currentUidForTest());
  if (!uid) throw new Error("Sign-in reported no user");
  return uid;
}

/** Marks the page that is loaded now, so `reloaded` can tell a fresh one from it. */
export const markPage = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { beforeReload?: boolean }).beforeReload = true;
  });

/** Settles once the marked page was replaced by a freshly loaded one, ready to sign in. */
export const reloaded = (page: Page) =>
  expect
    .poll(
      () =>
        page
          .evaluate(() => !("beforeReload" in window) && "signInForTest" in window)
          .catch(() => false),
      { timeout: 60_000 },
    )
    .toBe(true);

/** Signs out with nothing left to send: the page erases the account and reloads. */
export async function signOut(page: Page) {
  await openTab(page, "Profile");
  await markPage(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible();
}

/** A signed-in test account; the emulator's email is `{name}@example.com`. */
export interface Account {
  name: string;
  email: string;
  uid: string;
}

/** Opens the app on a page, ready to sign in. */
export const openedPage = async (page: Page) => {
  await page.goto("/");
  await page.waitForFunction(() => "signInForTest" in window);
  return page;
};

/** Signs in a new account on an open page; the emulator's email is `{name}@example.com`. */
export async function newAccount(page: Page, who: string): Promise<Account> {
  const name = uniqueName(who);
  const uid = await signInAs(page, name);
  return { name, email: `${name}@example.com`, uid };
}

/** What the server holds under an email in the directory, or null. */
export const directoryEntry = async (email: string) => {
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
export const storedContacts = async (uid: string) =>
  (await stored(uid, "contacts")).map(({ name, fields }) => ({
    id: name.split("/").pop(),
    uid: fields.uid?.stringValue,
    name: fields.name?.stringValue,
    photo: fields.photo?.stringValue,
    email: fields.email?.stringValue,
  }));

export const contactOf = ({ uid, name, email }: Account) => ({
  id: uid,
  uid,
  name,
  photo: "",
  email,
});
export const entryOf = ({ uid, name }: Account) => ({ uid, name, photo: "" });

export const findMe = (page: Page) =>
  page.getByRole("switch", { name: "Let people find me by email" });
export const contactsItem = (page: Page) => page.getByRole("button", { name: /^Contacts/ });

export async function openContacts(page: Page) {
  await openTab(page, "Profile");
  await contactsItem(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
}

export async function addContact(page: Page, email: string) {
  await page.getByRole("textbox", { name: "Contact's email" }).fill(email);
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

export async function deleteAccount(page: Page) {
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Delete account" }).click();
  await markPage(page);
  await page.getByRole("button", { name: "Delete my account" }).click();
  // Sign-in shows as soon as the account is gone; the page reloads once this device's cache is
  // cleared, so anything read from the page waits for that.
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
}

/** Turns on "Let people find me by email" from Profile and waits for the server's entry. */
export async function listMe(page: Page, account: Account) {
  await openTab(page, "Profile");
  await expect(findMe(page)).toBeEnabled();
  await findMe(page).click();
  await eventually(() => directoryEntry(account.email)).toEqual(entryOf(account));
}

/**
 * Signs in a new account, lets people find it by email from Profile, and signs it out again:
 * its directory entry stays on the server, so others can add it.
 */
export async function listedAccount(page: Page, who: string): Promise<Account> {
  const account = await newAccount(page, who);
  await listMe(page, account);
  await signOut(page);
  expect(await directoryEntry(account.email)).toEqual(entryOf(account));
  return account;
}

/** Finds text anywhere in this browser's Firestore cache, including its queue of unsent writes. */
export const cacheContains = (page: Page, text: string) =>
  page.evaluate(async (needle) => {
    const databases = await indexedDB.databases();
    for (const { name } of databases) {
      if (!name?.startsWith("firestore/")) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(new Error("Could not open the cache"));
        };
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const items = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => {
            resolve(request.result as unknown[]);
          };
          request.onerror = () => {
            reject(new Error("Could not read the cache"));
          };
        });
        if (JSON.stringify(items).includes(needle)) {
          db.close();
          return true;
        }
      }
      db.close();
    }
    return false;
  }, text);
