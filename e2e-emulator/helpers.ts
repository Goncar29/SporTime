import { expect, type BrowserContext, type Page } from "@playwright/test";

const DOCUMENTS = "127.0.0.1:8080/v1/projects/demo-sportime/databases/(default)/documents";
const EMULATOR_CALLS = /127\.0\.0\.1:(8080|9099)/;

interface StoredDocument {
  fields: Record<string, { stringValue?: string }>;
}

/** Reads what the server really holds, bypassing the rules and the page. */
export async function stored(uid: string, kind: "workouts" | "history"): Promise<StoredDocument[]> {
  const response = await fetch(`http://${DOCUMENTS}/users/${uid}/${kind}?pageSize=300`, {
    headers: { Authorization: "Bearer owner" },
  });
  const body = (await response.json()) as { documents?: StoredDocument[] };
  return body.documents ?? [];
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
  (await stored(uid, "workouts")).map(({ fields }) => fields.name?.stringValue).sort();

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
  await page.getByRole("textbox", { name: "Workout name" }).fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

export async function finishStopwatch(page: Page) {
  await page.getByRole("button", { name: /^Stopwatch/ }).click();
  await startButton(page).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "New workout" }).click();
}

/** Calls hang with `navigator.onLine` still true, like a stalled gym network. */
export const stallNetwork = (context: BrowserContext) =>
  context.route(EMULATOR_CALLS, () => undefined);
export const restoreNetwork = (context: BrowserContext) => context.unroute(EMULATOR_CALLS);

export async function clearEmulatorData() {
  await fetch(
    "http://127.0.0.1:8080/emulator/v1/projects/demo-sportime/databases/(default)/documents",
    { method: "DELETE" },
  );
}
