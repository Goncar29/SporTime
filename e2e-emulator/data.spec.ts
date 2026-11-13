import { expect, test } from "@playwright/test";
import {
  clearEmulatorData,
  deleteStored,
  eventually,
  finishStopwatch,
  openTab,
  restoreNetwork,
  saveWorkout,
  savedButton,
  signIn,
  stallNetwork,
  startButton,
  stored,
  storedNames,
  uniqueName,
} from "./helpers";

test.beforeEach(clearEmulatorData);

test("saved workouts and finished sessions reach the server and come back", async ({ page }) => {
  const uid = await signIn(page, "alice");

  await saveWorkout(page, "Leg day");
  await finishStopwatch(page);

  await eventually(() => storedNames(uid)).toEqual(["Leg day"]);
  await eventually(async () => (await stored(uid, "history")).length).toBe(1);

  await page.reload();
  await openTab(page, "Saved");
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
  await openTab(page, "Saved");
  await expect(savedButton(page, "Offline")).toBeVisible();
  await finishStopwatch(page);

  await page.reload();
  await openTab(page, "Saved");
  await expect(savedButton(page, "Offline")).toBeVisible();
  await openTab(page, "Saved");
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
  await openTab(page, "Saved");
  await expect(page.getByText("Loading…")).toBeVisible();
  await expect(page.getByText(/Save your settings here/)).toHaveCount(0);

  await saveWorkout(page, "During stall");
  await openTab(page, "Saved");
  await expect(savedButton(page, "During stall")).toBeVisible();
  await saveWorkout(page, "Changed my mind");
  await openTab(page, "Saved");
  await page.getByRole("button", { name: "Delete Changed my mind" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await openTab(page, "Saved");
  await expect(savedButton(page, "Changed my mind")).toHaveCount(0);
  await finishStopwatch(page);

  await page.reload();
  await openTab(page, "Saved");
  await expect(savedButton(page, "During stall")).toBeVisible();
  await openTab(page, "Saved");
  await expect(savedButton(page, "Changed my mind")).toHaveCount(0);

  await restoreNetwork(context);
  await eventually(() => storedNames(uid)).toEqual(["During stall", "Existing"]);
  await eventually(async () => (await stored(uid, "history")).length).toBe(1);
  await openTab(page, "Saved");
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

  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.evaluate((who) => window.signInForTest(who), uniqueName("bob"));
  await expect(startButton(page)).toBeVisible();
  const bob = await page.evaluate(() => window.currentUidForTest());
  expect(bob).not.toBe(alice);

  await openTab(page, "Saved");
  await expect(page.getByText(/Save your settings here/)).toBeVisible();
  await openTab(page, "Saved");
  await expect(savedButton(page, "Alice only")).toHaveCount(0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByText("No finished workouts yet.")).toBeVisible();
  expect(await storedNames(alice)).toEqual(["Alice only"]);
});

test("an edit reaches the server over the same workout and keeps its place", async ({ page }) => {
  const uid = await signIn(page, "alice");
  await saveWorkout(page, "Leg day");
  await eventually(() => storedNames(uid)).toEqual(["Leg day"]);
  const [before] = await stored(uid, "workouts");

  await openTab(page, "Saved");
  await page.getByRole("button", { name: "Edit Leg day" }).click();
  await page.getByRole("button", { name: /^EMOM/ }).click();
  await page.getByRole("textbox", { name: "Workout name" }).fill("Leg day, harder");
  await page.getByRole("button", { name: "Save changes" }).click();

  await eventually(() => storedNames(uid)).toEqual(["Leg day, harder"]);
  const [after] = await stored(uid, "workouts");
  expect(after?.name).toBe(before?.name);
  expect(after?.fields.createdAt).toEqual(before?.fields.createdAt);
  expect(after?.fields.config?.mapValue?.fields?.mode?.stringValue).toBe("emom");

  await page.reload();
  await openTab(page, "Saved");
  await expect(savedButton(page, "Leg day, harder")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an edit never brings back a workout deleted on another device", async ({ page, context }) => {
  const uid = await signIn(page, "alice");
  await saveWorkout(page, "Leg day");
  await eventually(() => storedNames(uid)).toEqual(["Leg day"]);
  const [saved] = await stored(uid, "workouts");
  if (!saved) throw new Error("Nothing was stored");

  await openTab(page, "Saved");
  await page.getByRole("button", { name: "Edit Leg day" }).click();
  // This device does not hear about the deletion until it is back online.
  await context.setOffline(true);
  await deleteStored(saved.name);
  await page.getByRole("textbox", { name: "Workout name" }).fill("Leg day, harder");
  await page.getByRole("button", { name: "Save changes" }).click();
  const logged: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") logged.push(message.text());
  });
  await context.setOffline(false);

  // The real SDK reports the server's refusal with Firestore's own code, not an HTTP status.
  await expect(page.getByRole("alert")).toContainText(
    "That workout no longer exists: it was deleted on another device.",
    { timeout: 60_000 },
  );
  expect(logged).toContain("Updating a saved workout failed: not-found");
  // The typed name stays, ready to save as a new workout.
  await expect(page.getByRole("textbox", { name: "Workout name" })).toHaveValue("Leg day, harder");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(await storedNames(uid)).toEqual([]);
});
