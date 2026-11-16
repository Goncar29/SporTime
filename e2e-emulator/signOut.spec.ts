import { expect, test, type Page } from "@playwright/test";
import {
  asksBeforeLeaving,
  cacheContains,
  clearEmulatorData,
  eventually,
  finishStopwatch,
  googleButton,
  holdWrites,
  markPage,
  openTab,
  queuedWrites,
  reloaded,
  restoreNetwork,
  saveWorkout,
  savedButton,
  signIn,
  signInAs,
  signOut,
  stallNetwork,
  startButton,
  stored,
  storedNames,
  uniqueName,
} from "./helpers";

const openedPage = async (page: Page) => {
  await page.goto("/");
  await page.waitForFunction(() => "signInForTest" in window);
  return page;
};

const signOutButton = (page: Page) => page.getByRole("button", { name: "Sign out" });
const warning = (page: Page) => page.getByRole("alertdialog");

/** The account's outbox keys still in this browser's storage. */
const outboxKeys = (page: Page, uid: string) =>
  page.evaluate(
    (who) =>
      Object.keys(localStorage).filter(
        (key) => key.startsWith("sportime.outbox.") && key.endsWith(`.${who}`),
      ),
    uid,
  );

/** Text held anywhere on this device for the app: its Firestore cache or its own outbox. */
const deviceHolds = async (page: Page, text: string) =>
  (await cacheContains(page, text)) ||
  (await page.evaluate(
    (needle) => Object.values(localStorage).some((value) => value.includes(needle)),
    text,
  ));

const historyCount = async (uid: string) => (await stored(uid, "history")).length;

const otherTabNotice = (page: Page) => page.getByText("Signing out in another tab…");

/** Opens a second tab of the signed-in account, with a stopwatch running, to finish later. */
async function openTabWithStopwatch(page: Page) {
  const other = await page.context().newPage();
  await other.goto("/");
  await expect(startButton(other)).toBeVisible();
  await openTab(other, "Timer");
  await other.getByRole("button", { name: /^Stopwatch/ }).click();
  await startButton(other).click();
  await expect(other.getByRole("button", { name: "Finish" })).toBeVisible();
  return other;
}

/**
 * Finishes that stopwatch while the tab is blocked, as a press that lands just as another tab
 * starts signing out: the finished session is a change the tab now has to store.
 */
async function finishWhileBlocked(page: Page) {
  await expect(page.locator("[inert]").getByRole("button", { name: "Finish" })).toHaveCount(1);
  await page.getByRole("button", { name: "Finish" }).dispatchEvent("click");
  await expect(page.getByRole("button", { name: "New workout" })).toBeVisible();
}

test.beforeEach(clearEmulatorData);

test("signing out sends what is pending first, then erases the account from this device", async ({
  page,
  context,
}) => {
  const name = uniqueName("leaving");
  const uid = await signInAs(await openedPage(page), name);
  await page.evaluate(() => {
    localStorage.setItem("sportime.language", "en");
  });
  await saveWorkout(page, "Kept");
  await finishStopwatch(page);
  await eventually(() => storedNames(uid)).toEqual(["Kept"]);
  await eventually(() => historyCount(uid)).toBe(1);
  // Proves the searches below can find the account's data: without this they could never fail.
  await expect.poll(() => cacheContains(page, uid)).toBe(true);

  // Slows the channel writes travel on, so this one is still pending when sign-out starts.
  await context.route(/\/Write\/channel/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fallback().catch(() => undefined);
  });
  await saveWorkout(page, "In flight");
  await openTab(page, "Saved");
  await expect(savedButton(page, "In flight")).toBeVisible();
  expect(await storedNames(uid)).toEqual(["Kept"]);

  await openTab(page, "Profile");
  await markPage(page);
  await signOutButton(page).click();
  await expect(page.getByRole("status")).toHaveText("Signing out…");
  await expect(signOutButton(page)).toBeDisabled();
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible();

  expect(await storedNames(uid)).toEqual(["In flight", "Kept"]);
  expect(await historyCount(uid)).toBe(1);
  expect(await cacheContains(page, uid)).toBe(false);
  expect(await cacheContains(page, "Kept")).toBe(false);
  expect(await outboxKeys(page, uid)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("sportime.language"))).toBe("en");

  await context.unroute(/\/Write\/channel/);
  await signInAs(page, name);
  await openTab(page, "Saved");
  await expect(savedButton(page, "Kept")).toBeVisible({ timeout: 30_000 });
  await expect(savedButton(page, "In flight")).toBeVisible();
  await openTab(page, "History");
  await expect(page.getByRole("listitem")).toHaveCount(1, { timeout: 30_000 });
});

test("offline, signing out warns, and Stay keeps the session and sends the change later", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "staying");
  await saveWorkout(page, "Online");
  await eventually(() => storedNames(uid)).toEqual(["Online"]);

  await context.setOffline(true);
  await saveWorkout(page, "Queued");
  await openTab(page, "Saved");
  await expect(savedButton(page, "Queued")).toBeVisible();

  await openTab(page, "Profile");
  await signOutButton(page).click();
  await expect(warning(page)).toBeVisible();
  await expect(warning(page).getByRole("heading")).toHaveText("Unsent changes");
  await expect(warning(page)).toHaveAccessibleDescription(
    "You have unsent changes. If you sign out now, they will be lost.",
  );
  await expect(warning(page).getByRole("button")).toHaveText(["Stay", "Sign out anyway"]);

  await warning(page).getByRole("button", { name: "Stay" }).click();
  await expect(warning(page)).toHaveCount(0);
  await expect(signOutButton(page)).toBeEnabled();
  expect(await page.evaluate(() => window.currentUidForTest())).toBe(uid);
  await openTab(page, "Saved");
  await expect(savedButton(page, "Queued")).toBeVisible();
  expect(await storedNames(uid)).toEqual(["Online"]);

  await context.setOffline(false);
  await eventually(() => storedNames(uid)).toEqual(["Online", "Queued"]);
  expect(await page.evaluate(() => window.currentUidForTest())).toBe(uid);
});

test("on a stalled network the warning comes after the time limit, in the app's language", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "stalled");
  await saveWorkout(page, "Online");
  await eventually(() => storedNames(uid)).toEqual(["Online"]);

  await stallNetwork(context);
  await saveWorkout(page, "Stalled");
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Español" }).click();
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("status")).toHaveText("Cerrando sesión…");

  await expect(warning(page)).toBeVisible({ timeout: 30_000 });
  await expect(warning(page)).toHaveAccessibleDescription(
    "Tienes cambios sin enviar. Si cierras sesión ahora, se perderán.",
  );
  await expect(warning(page).getByRole("button")).toHaveText(["Quedarme", "Cerrar sesión igual"]);

  await warning(page).getByRole("button", { name: "Quedarme" }).click();
  await expect(warning(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.currentUidForTest())).toBe(uid);
  await restoreNetwork(context);
  await eventually(() => storedNames(uid)).toEqual(["Online", "Stalled"]);
});

test("Sign out anyway discards the unsent changes and erases the account from this device", async ({
  page,
  context,
}) => {
  const name = uniqueName("discarding");
  const uid = await signInAs(await openedPage(page), name);
  await saveWorkout(page, "Synced");
  await eventually(() => storedNames(uid)).toEqual(["Synced"]);

  await context.setOffline(true);
  await saveWorkout(page, "Lost");
  await openTab(page, "Saved");
  await expect(savedButton(page, "Lost")).toBeVisible();
  await finishStopwatch(page);
  // Proves the searches below can find the unsent change: without this they could never fail.
  await expect.poll(() => deviceHolds(page, "Lost")).toBe(true);

  await openTab(page, "Profile");
  await signOutButton(page).click();
  await markPage(page);
  await warning(page).getByRole("button", { name: "Sign out anyway" }).click();
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible();

  expect(await deviceHolds(page, "Lost")).toBe(false);
  expect(await cacheContains(page, uid)).toBe(false);
  expect(await outboxKeys(page, uid)).toEqual([]);

  await context.setOffline(false);
  await signInAs(page, name);
  await openTab(page, "Saved");
  await expect(savedButton(page, "Synced")).toBeVisible({ timeout: 30_000 });
  await expect(savedButton(page, "Lost")).toHaveCount(0);
  await page.waitForTimeout(3_000);
  expect(await storedNames(uid)).toEqual(["Synced"]);
  expect(await historyCount(uid)).toBe(0);
});

test("another open tab is blocked while one signs out, and usable again after Stay", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "blocked-tab");
  await saveWorkout(page, "Online");
  await eventually(() => storedNames(uid)).toEqual(["Online"]);
  const other = await context.newPage();
  await other.goto("/");
  await expect(startButton(other)).toBeVisible();

  // Something left to send on a stalled network keeps the first tab signing out until the warning.
  await stallNetwork(context);
  await saveWorkout(page, "Stalled");
  await openTab(page, "Profile");
  await signOutButton(page).click();
  await expect(page.getByText("Signing out…", { exact: true })).toBeVisible();

  const notice = other.getByText("Signing out in another tab…");
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("role", "status");
  await expect(other.locator("[inert]").getByRole("button", { name: "Saved" })).toHaveCount(1);

  await expect(warning(page)).toBeVisible({ timeout: 30_000 });
  await warning(page).getByRole("button", { name: "Stay" }).click();
  await expect(warning(page)).toHaveCount(0);

  await expect(notice).toHaveCount(0);
  await expect(other.locator("[inert]")).toHaveCount(0);
  await openTab(other, "Saved");
  await expect(savedButton(other, "Online")).toBeVisible();
  expect(await other.evaluate(() => window.currentUidForTest())).toBe(uid);

  await restoreNetwork(context);
  await eventually(() => storedNames(uid)).toEqual(["Online", "Stalled"]);
});

test("a change made in another tab while one signs out is saved when that tab stays", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "stay-other-change");
  await saveWorkout(page, "Online");
  await eventually(() => storedNames(uid)).toEqual(["Online"]);
  const other = await openTabWithStopwatch(page);

  // Something left to send on a stalled network keeps this tab signing out until the warning.
  await stallNetwork(context);
  await saveWorkout(page, "Stalled");
  await openTab(page, "Profile");
  await signOutButton(page).click();
  await expect(otherTabNotice(other)).toBeVisible();

  await finishWhileBlocked(other);
  // It waits for the sign-out, only in that tab's memory, so leaving the tab would ask first.
  await expect.poll(() => asksBeforeLeaving(other)).toBe(true);
  expect(await historyCount(uid)).toBe(0);

  await expect(warning(page)).toBeVisible({ timeout: 30_000 });
  // The account stayed signed in, so the change was stored, and nothing is left to lose.
  await expect.poll(() => asksBeforeLeaving(other)).toBe(false);
  await warning(page).getByRole("button", { name: "Stay" }).click();
  await expect(otherTabNotice(other)).toHaveCount(0);
  await expect(other.getByRole("alert")).toHaveCount(0);

  await restoreNetwork(context);
  await eventually(() => historyCount(uid)).toBe(1);
  await eventually(() => storedNames(uid)).toEqual(["Online", "Stalled"]);
  expect(await other.evaluate(() => window.currentUidForTest())).toBe(uid);
  expect(await page.evaluate(() => window.currentUidForTest())).toBe(uid);
  await other.getByRole("button", { name: "New workout" }).click();
  await openTab(other, "History");
  await expect(other.getByRole("listitem")).toHaveCount(1);
});

test("a change made in another tab while one signs out is refused, with a message, when it signs out", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "refused-other-change");
  await saveWorkout(page, "Online");
  await eventually(() => storedNames(uid)).toEqual(["Online"]);
  const other = await openTabWithStopwatch(page);

  // This tab's own change waits for the server until the test lets it through.
  const writes = await holdWrites(context);
  await saveWorkout(page, "Sent late");
  // Proves the check of the device below can fail: the held write is queued there now.
  await expect.poll(() => queuedWrites(page)).toBeGreaterThan(0);
  await openTab(page, "Profile");
  await markPage(page);
  await markPage(other);
  await signOutButton(page).click();
  await expect(otherTabNotice(other)).toBeVisible();

  await finishWhileBlocked(other);
  await expect.poll(() => asksBeforeLeaving(other)).toBe(true);

  // Everything this tab had reaches the server, so it signs out while that change still waits.
  await writes.release();
  await reloaded(page);
  await expect(googleButton(page)).toBeVisible();

  const lost = other.getByText("Couldn't save: you signed out in another tab.");
  await expect(lost).toBeVisible();
  await expect(lost).toHaveAttribute("role", "alert");
  // The app's own reload to the sign-in screen never asks.
  expect(await asksBeforeLeaving(other)).toBe(false);
  await reloaded(other);
  await expect(googleButton(other)).toBeVisible();

  expect(await storedNames(uid)).toEqual(["Online", "Sent late"]);
  await other.waitForTimeout(3_000);
  expect(await historyCount(uid)).toBe(0);
  expect(await outboxKeys(other, uid)).toEqual([]);
  expect(await queuedWrites(other)).toBe(0);
});

test("another open tab reloads to the sign-in screen when the account signs out", async ({
  page,
  context,
}) => {
  await signIn(page, "two-tabs");
  const other = await context.newPage();
  await other.goto("/");
  await expect(startButton(other)).toBeVisible();
  await markPage(other);

  await signOut(page);
  await reloaded(other);
  await expect(googleButton(other)).toBeVisible();
  await expect(other.getByRole("alert")).toHaveCount(0);
});
