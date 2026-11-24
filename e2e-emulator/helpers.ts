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
  kind: "workouts" | "history" | "routines" | "contacts",
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
