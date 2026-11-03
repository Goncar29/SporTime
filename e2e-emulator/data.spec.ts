import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DOCUMENTS = "127.0.0.1:8080/v1/projects/demo-sportime/databases/(default)/documents";
const EMULATOR_CALLS = /127\.0\.0\.1:(8080|9099)/;

interface StoredDocument {
  fields: Record<string, { stringValue?: string }>;
}

/** Reads what the server really holds, bypassing the rules and the page. */
async function stored(uid: string, kind: "workouts" | "history"): Promise<StoredDocument[]> {
  const response = await fetch(`http://${DOCUMENTS}/users/${uid}/${kind}?pageSize=300`, {
    headers: { Authorization: "Bearer owner" },
  });
  const body = (await response.json()) as { documents?: StoredDocument[] };
  return body.documents ?? [];
}

const storedNames = async (uid: string) =>
  (await stored(uid, "workouts")).map(({ fields }) => fields.name?.stringValue).sort();

/** A new account each time: a late write from one test can never reach another. */
let accounts = 0;
const uniqueName = (name: string) => `${name}-${Date.now()}-${++accounts}`;

async function signIn(page: Page, name: string): Promise<string> {
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
const eventually = <T>(read: () => Promise<T>) => expect.poll(read, { timeout: 60_000 });

const startButton = (page: Page) => page.getByRole("button", { name: /^Start/ });
const savedButton = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

async function saveWorkout(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Workout name" }).fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

async function finishStopwatch(page: Page) {
  await page.getByRole("button", { name: /^Stopwatch/ }).click();
  await startButton(page).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("button", { name: "New workout" }).click();
}

/** Calls hang with `navigator.onLine` still true, like a stalled gym network. */
const stallNetwork = (context: BrowserContext) => context.route(EMULATOR_CALLS, () => undefined);
const restoreNetwork = (context: BrowserContext) => context.unroute(EMULATOR_CALLS);

test.beforeEach(async () => {
  await fetch(
    `http://127.0.0.1:8080/emulator/v1/projects/demo-sportime/databases/(default)/documents`,
    {
      method: "DELETE",
    },
  );
});

test("saved workouts and finished sessions reach the server and come back", async ({ page }) => {
  const uid = await signIn(page, "alice");

  await saveWorkout(page, "Leg day");
  await finishStopwatch(page);

  await eventually(() => storedNames(uid)).toEqual(["Leg day"]);
  await eventually(async () => (await stored(uid, "history")).length).toBe(1);

  await page.reload();
  await expect(savedButton(page, "Leg day")).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("writes made offline survive a reload and sync once", async ({ page, context }) => {
  const uid = await signIn(page, "alice");
  await saveWorkout(page, "Online");
  await eventually(() => storedNames(uid)).toEqual(["Online"]);

  await context.setOffline(true);
  await saveWorkout(page, "Offline");
  await expect(savedButton(page, "Offline")).toBeVisible();
  await finishStopwatch(page);

  await page.reload();
  await expect(savedButton(page, "Offline")).toBeVisible();
  await expect(savedButton(page, "Online")).toBeVisible();
  expect(await storedNames(uid)).toEqual(["Online"]);

  await context.setOffline(false);
  await eventually(() => storedNames(uid)).toEqual(["Offline", "Online"]);
  await eventually(async () => (await stored(uid, "history")).length).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a stalled sign-in check loses nothing and invents nothing", async ({ page, context }) => {
  const uid = await signIn(page, "alice");
  await saveWorkout(page, "Existing");
  await eventually(() => storedNames(uid)).toEqual(["Existing"]);
  // Lets the client record the server's answer, so this reload cannot resend the write.
  await page.waitForTimeout(2_500);

  await stallNetwork(context);
  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await expect(page.getByText("Loading…")).toBeVisible();
  await expect(page.getByText(/Save your settings here/)).toHaveCount(0);

  await saveWorkout(page, "During stall");
  await expect(savedButton(page, "During stall")).toBeVisible();
  await saveWorkout(page, "Changed my mind");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete Changed my mind" }).click();
  await expect(savedButton(page, "Changed my mind")).toHaveCount(0);
  await finishStopwatch(page);

  await page.reload();
  await expect(savedButton(page, "During stall")).toBeVisible();
  await expect(savedButton(page, "Changed my mind")).toHaveCount(0);

  await restoreNetwork(context);
  await eventually(() => storedNames(uid)).toEqual(["During stall", "Existing"]);
  await eventually(async () => (await stored(uid, "history")).length).toBe(1);
  await expect(savedButton(page, "Existing")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a write resent after its answer was lost raises no false alert", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "alice");
  await saveWorkout(page, "Answer lost");
  await expect
    .poll(() => storedNames(uid), { intervals: [20], timeout: 60_000 })
    .toEqual(["Answer lost"]);

  // Reloading now can leave the write queued locally, so it goes out a second time.
  await stallNetwork(context);
  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await saveWorkout(page, "Next one");
  await restoreNetwork(context);

  await eventually(() => storedNames(uid)).toEqual(["Answer lost", "Next one"]);
  await page.waitForTimeout(2_000);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("each account only ever sees its own data", async ({ page }) => {
  const alice = await signIn(page, "alice");
  await saveWorkout(page, "Alice only");
  await finishStopwatch(page);
  await eventually(() => storedNames(alice)).toEqual(["Alice only"]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.evaluate((who) => window.signInForTest(who), uniqueName("bob"));
  await expect(startButton(page)).toBeVisible();
  const bob = await page.evaluate(() => window.currentUidForTest());
  expect(bob).not.toBe(alice);

  await expect(page.getByText(/Save your settings here/)).toBeVisible();
  await expect(savedButton(page, "Alice only")).toHaveCount(0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("No finished workouts yet.")).toBeVisible();
  expect(await storedNames(alice)).toEqual(["Alice only"]);
});
