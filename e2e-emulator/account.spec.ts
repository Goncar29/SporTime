import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import {
  accountExists,
  clearEmulatorData,
  eventually,
  finishStopwatch,
  saveWorkout,
  savedButton,
  signIn,
  startButton,
  stored,
  storedNames,
  uniqueName,
} from "./helpers";

const googleButton = (page: Page) => page.getByRole("button", { name: "Continue with Google" });
const confirmButton = (page: Page) => page.getByRole("button", { name: "Delete my account" });
const openDeleteScreen = (page: Page) =>
  page.getByRole("button", { name: "Delete account" }).click();

async function signInAs(page: Page, name: string): Promise<string> {
  await page.evaluate((who) => window.signInForTest(who), name);
  await expect(startButton(page)).toBeVisible();
  const uid = await page.evaluate(() => window.currentUidForTest());
  if (!uid) throw new Error("Sign-in reported no user");
  return uid;
}

const signOut = async (page: Page) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(googleButton(page)).toBeVisible();
};

/** Finds text anywhere in this browser's Firestore cache, including its queue of unsent writes. */
const cacheContains = (page: Page, text: string) =>
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

/** Holds requests until released, with `navigator.onLine` still true. */
function holdRequests(context: BrowserContext, pattern: RegExp) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = context.route(pattern, async (route) => {
    await released;
    await route.fallback().catch(() => undefined);
  });
  return {
    ready,
    release: () => {
      release();
    },
  };
}

const markSignInAsOld = (page: Page) =>
  page.evaluate(() => {
    localStorage.setItem("sportime.test.staleSignIn", "true");
  });
const markSignInAsRecent = (page: Page) =>
  page.evaluate(() => {
    localStorage.removeItem("sportime.test.staleSignIn");
  });

async function pickAccount(popup: Page, email: string) {
  await popup.waitForLoadState();
  await popup.locator(".js-reuse-account", { hasText: email }).first().click();
}

const openedPage = async (page: Page) => {
  await page.goto("/");
  await page.waitForFunction(() => "signInForTest" in window);
  return page;
};

test.beforeEach(clearEmulatorData);

test("deleting removes everything the account held, and nobody else's data", async ({ page }) => {
  const other = await signIn(page, "other");
  await saveWorkout(page, "Not yours");
  await eventually(() => storedNames(other)).toEqual(["Not yours"]);
  await signOut(page);

  const uid = await signInAs(page, uniqueName("leaving"));
  expect(await accountExists(uid)).toBe(true);
  await saveWorkout(page, "Synced");
  await finishStopwatch(page);
  await eventually(() => storedNames(uid)).toEqual(["Synced"]);
  // Proves the search below can find something: without this it could never fail.
  await expect.poll(() => cacheContains(page, "Synced")).toBe(true);

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });

  expect(await storedNames(uid)).toEqual([]);
  expect(await stored(uid, "history")).toEqual([]);
  expect(await accountExists(uid)).toBe(false);
  expect(await storedNames(other)).toEqual(["Not yours"]);
  await expect.poll(() => cacheContains(page, "Synced")).toBe(false);
  const leftovers = await page.evaluate(() =>
    Object.keys(localStorage).filter(
      (key) => key.startsWith("sportime.outbox") || key === "sportime.session",
    ),
  );
  expect(leftovers).toEqual([]);
});

test("deleting more than one batch of documents leaves nothing", async ({ page }) => {
  test.setTimeout(180_000);
  const uid = await signIn(page, "big");
  for (let start = 0; start < 850; start += 300) {
    const writes = Array.from({ length: Math.min(300, 850 - start) }, (_, index) => ({
      update: {
        name: `projects/demo-sportime/databases/(default)/documents/users/${uid}/workouts/w${start + index}`,
        fields: { name: { stringValue: "Seed" } },
      },
    }));
    const seeded = await fetch(
      "http://127.0.0.1:8080/v1/projects/demo-sportime/databases/(default)/documents:commit",
      {
        method: "POST",
        headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
        body: JSON.stringify({ writes }),
      },
    );
    if (!seeded.ok) throw new Error(await seeded.text());
  }
  expect((await stored(uid, "workouts")).length).toBeGreaterThan(0);

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 120_000 });
  expect(await stored(uid, "workouts")).toEqual([]);
  expect(await accountExists(uid)).toBe(false);
});

test("deletion needs a connection and touches nothing without one", async ({ page, context }) => {
  const uid = await signIn(page, "offline");
  await saveWorkout(page, "Synced");
  await eventually(() => storedNames(uid)).toEqual(["Synced"]);
  await context.setOffline(true);
  await saveWorkout(page, "Queued");
  await expect(savedButton(page, "Queued")).toBeVisible();

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(page.getByRole("alert")).toContainText("connection", { timeout: 5_000 });
  expect(await storedNames(uid)).toEqual(["Synced"]);
  expect(await accountExists(uid)).toBe(true);

  await context.setOffline(false);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  expect(await storedNames(uid)).toEqual([]);
});

test("a write still on its way when deletion starts is not left behind", async ({
  page,
  context,
}) => {
  const uid = await signIn(page, "leaving");
  await saveWorkout(page, "First");
  await eventually(() => storedNames(uid)).toEqual(["First"]);

  // Holds only the channel writes travel on, so listing documents still answers at once.
  await context.route(/\/Write\/channel/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.fallback();
  });
  await saveWorkout(page, "Still on its way");
  await expect(savedButton(page, "Still on its way")).toBeVisible();
  // Proves the hold works: without it this test could not fail.
  expect(await storedNames(uid)).toEqual(["First"]);
  await openDeleteScreen(page);
  await confirmButton(page).click();

  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(5_000);
  expect(await storedNames(uid)).toEqual([]);
  expect(await accountExists(uid)).toBe(false);
});

test("after a reported failure, nothing the user saves later gets deleted", async ({
  page,
  context,
}) => {
  test.setTimeout(200_000);
  const uid = await signIn(page, "keeping");
  await saveWorkout(page, "Before");
  await eventually(() => storedNames(uid)).toEqual(["Before"]);

  const hold = holdRequests(context, /\/Write\/channel/);
  await hold.ready;
  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("alert")).toContainText("may still exist");
  expect(await accountExists(uid)).toBe(true);

  await page.getByRole("button", { name: "Keep my account" }).click();
  await saveWorkout(page, "After keeping");
  hold.release();
  await context.unroute(/\/Write\/channel/);

  await eventually(async () => await storedNames(uid)).toContain("After keeping");
  await page.waitForTimeout(10_000);
  expect(await storedNames(uid)).toContain("After keeping");
  expect(await accountExists(uid)).toBe(true);
});

for (const bobDeletes of [true, false]) {
  test(`another account's unsent writes survive when Bob ${bobDeletes ? "deletes his account" : "signs out"}`, async ({
    page,
    context,
  }) => {
    const aliceName = uniqueName("alice");
    const alice = await signInAs(await openedPage(page), aliceName);
    await context.setOffline(true);
    await saveWorkout(page, "Alice offline");
    await expect(savedButton(page, "Alice offline")).toBeVisible();
    await page.waitForTimeout(1_500);
    await signOut(page);
    await context.setOffline(false);

    await signInAs(page, uniqueName("bob"));
    if (bobDeletes) {
      await openDeleteScreen(page);
      await confirmButton(page).click();
      await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
    } else {
      await signOut(page);
    }

    await signInAs(page, aliceName);
    await eventually(() => storedNames(alice)).toEqual(["Alice offline"]);
    await expect(savedButton(page, "Alice offline")).toBeVisible();
  });
}

test("another open tab keeps working after an account is deleted", async ({ page, context }) => {
  await signIn(page, "leaving");
  const other = await context.newPage();
  await other.goto("/");
  await expect(startButton(other)).toBeVisible();

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  await expect(googleButton(other)).toBeVisible({ timeout: 30_000 });

  const uid = await signInAs(other, uniqueName("next"));
  await saveWorkout(other, "From the other tab");
  await finishStopwatch(other);
  await eventually(() => storedNames(uid)).toEqual(["From the other tab"]);
  await eventually(async () => (await stored(uid, "history")).length).toBe(1);
});

test("a removal refused for an old sign-in asks again, then finishes", async ({ page }) => {
  const who = uniqueName("tooold");
  const uid = await signInAs(await openedPage(page), who);
  await saveWorkout(page, "W");
  await eventually(() => storedNames(uid)).toEqual(["W"]);
  let refusals = 1;
  await page.route(/accounts:delete/, async (route) => {
    if (refusals-- > 0) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: 400, message: "CREDENTIAL_TOO_OLD_LOGIN_AGAIN" } }),
      });
    } else {
      await route.fallback();
    }
  });

  await openDeleteScreen(page);
  const [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await pickAccount(popup, `${who}@example.com`);

  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  expect(await accountExists(uid)).toBe(false);
});

test("a lost answer is never reported as 'your account is still here'", async ({ page }) => {
  const uid = await signIn(page, "lost");
  await saveWorkout(page, "W");
  await eventually(() => storedNames(uid)).toEqual(["W"]);
  await page.route(/accounts:delete/, async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  });

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 40_000 });
  expect(await accountExists(uid)).toBe(false);
  await expect(page.getByRole("alert")).toContainText("may still exist");
  await expect(page.getByRole("alert")).not.toContainText("is still here");

  await page.unroute(/accounts:delete/);
  await page.getByRole("button", { name: "Keep my account" }).click();
  await saveWorkout(page, "Saved in between");
  await eventually(() => storedNames(uid)).toContain("Saved in between");

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 30_000 });
  // The provider's answer for a removed account is the same as for an expired session.
  await expect(page.getByRole("alert")).toContainText("session ended");
  expect(await storedNames(uid)).toEqual([]);
  await expect.poll(() => cacheContains(page, "Saved in between")).toBe(false);
  await expect.poll(() => cacheContains(page, '"W"')).toBe(false);
});

const failRemovalBeforeItArrives = (page: Page) =>
  page.route(/accounts:delete/, (route) => route.abort("connectionreset"));

test("a failed removal never reaching the server does not skip the confirmation later", async ({
  page,
}) => {
  const who = uniqueName("alive");
  const uid = await signInAs(await openedPage(page), who);
  await failRemovalBeforeItArrives(page);
  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 40_000 });
  expect(await accountExists(uid)).toBe(true);
  await page.unroute(/accounts:delete/);

  await page.getByRole("button", { name: "Keep my account" }).click();
  await saveWorkout(page, "Made later");
  await eventually(() => storedNames(uid)).toEqual(["Made later"]);
  await markSignInAsOld(page);
  await openDeleteScreen(page);
  const [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await popup.waitForLoadState();
  expect(await storedNames(uid)).toEqual(["Made later"]);
  await popup.close();
  await expect(confirmButton(page)).toBeEnabled({ timeout: 30_000 });
  expect(await storedNames(uid)).toEqual(["Made later"]);
  expect(await accountExists(uid)).toBe(true);
});

for (const answer of ["TOKEN_EXPIRED", "INVALID_ID_TOKEN"]) {
  test(`${answer} after a failed removal never reads as a finished deletion`, async ({ page }) => {
    const uid = await signInAs(await openedPage(page), uniqueName("alive"));
    await failRemovalBeforeItArrives(page);
    await openDeleteScreen(page);
    await confirmButton(page).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 40_000 });
    await page.unroute(/accounts:delete/);

    await page.route(/accounts:delete/, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: 400, message: answer } }),
      }),
    );
    await confirmButton(page).click();
    await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert")).toContainText("session ended");
    expect(await accountExists(uid)).toBe(true);
  });
}

const refuseRemovalAsStale = (page: Page) =>
  page.route(/accounts:delete/, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 400, message: "CREDENTIAL_TOO_OLD_LOGIN_AGAIN" } }),
    }),
  );

test("an unfinished confirmation after erasing says the data is gone and the account is not", async ({
  page,
}) => {
  const stranger = uniqueName("stranger");
  await signInAs(await openedPage(page), stranger);
  await signOut(page);
  const who = uniqueName("halfway");
  const uid = await signInAs(page, who);
  await saveWorkout(page, "W");
  await eventually(() => storedNames(uid)).toEqual(["W"]);
  await refuseRemovalAsStale(page);
  await openDeleteScreen(page);

  // Cancelled.
  let [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await popup.waitForLoadState();
  await popup.close();
  await expect(page.getByRole("alert")).toContainText("already erased", { timeout: 30_000 });
  expect(await storedNames(uid)).toEqual([]);
  expect(await accountExists(uid)).toBe(true);

  // Wrong account.
  [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await pickAccount(popup, `${stranger}@example.com`);
  await expect(page.getByRole("alert")).toContainText("already erased", { timeout: 30_000 });
  await expect(page.getByRole("alert")).toContainText("same Google account");
  expect(await accountExists(uid)).toBe(true);

  // Cancelling the check that comes first on a retry must not hide what already happened.
  await markSignInAsOld(page);
  [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await popup.waitForLoadState();
  await popup.close();
  await expect(confirmButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("alert")).toContainText("already erased");

  await markSignInAsRecent(page);
  await page.unroute(/accounts:delete/);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  expect(await accountExists(uid)).toBe(false);
});

for (const answer of ["TOKEN_EXPIRED", "INVALID_ID_TOKEN"]) {
  const refuse = (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 400, message: answer } }),
    });

  test(`${answer} when removing never reads as a finished deletion`, async ({ page }) => {
    const who = uniqueName("expired");
    const uid = await signInAs(await openedPage(page), who);
    await saveWorkout(page, "W");
    await eventually(() => storedNames(uid)).toEqual(["W"]);
    await page.route(/accounts:delete/, refuse);

    await openDeleteScreen(page);
    await confirmButton(page).click();

    await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert")).toContainText("session ended");
    expect(await accountExists(uid)).toBe(true);

    await page.unroute(/accounts:delete/);
    await signInAs(page, who);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await openDeleteScreen(page);
    await confirmButton(page).click();
    await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await accountExists(uid)).toBe(false);
  });

  test(`${answer} when checking the sign-in erases nothing and says so`, async ({ page }) => {
    const who = uniqueName("expired");
    const uid = await signInAs(await openedPage(page), who);
    await saveWorkout(page, "W");
    await eventually(() => storedNames(uid)).toEqual(["W"]);
    await page.route(/securetoken\.googleapis\.com/, refuse);

    await openDeleteScreen(page);
    await confirmButton(page).click();

    await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("alert")).toContainText("session ended");
    expect(await accountExists(uid)).toBe(true);
    expect(await storedNames(uid)).toEqual(["W"]);
  });
}

test("an old sign-in is confirmed first: cancelling or the wrong account delete nothing", async ({
  page,
}) => {
  const stranger = uniqueName("stranger");
  await signInAs(await openedPage(page), stranger);
  await signOut(page);
  const who = uniqueName("old");
  const uid = await signInAs(page, who);
  await saveWorkout(page, "W");
  await eventually(() => storedNames(uid)).toEqual(["W"]);
  await markSignInAsOld(page);
  await openDeleteScreen(page);

  let [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await popup.waitForLoadState();
  await popup.close();
  await expect(confirmButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await storedNames(uid)).toEqual(["W"]);

  [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await pickAccount(popup, `${stranger}@example.com`);
  await expect(page.getByRole("alert")).toContainText("same Google account", { timeout: 30_000 });
  await expect(page.getByRole("alert")).not.toContainText("may already be gone");
  expect(await storedNames(uid)).toEqual(["W"]);
  expect(await accountExists(uid)).toBe(true);

  [popup] = await Promise.all([page.waitForEvent("popup"), confirmButton(page).click()]);
  await pickAccount(popup, `${who}@example.com`);
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  expect(await storedNames(uid)).toEqual([]);
  expect(await accountExists(uid)).toBe(false);
});

test("returning from a redirect deletes nothing until the button is pressed again", async ({
  page,
}) => {
  const who = uniqueName("redirect");
  const uid = await signInAs(await openedPage(page), who);
  await saveWorkout(page, "W");
  await eventually(() => storedNames(uid)).toEqual(["W"]);
  await markSignInAsOld(page);
  // A blocked popup falls back to a redirect, the route phones and installed apps use.
  await page.evaluate(() => {
    window.open = () => null;
  });
  await openDeleteScreen(page);
  await confirmButton(page).click();
  await page.waitForURL(/emulator\/auth\/handler/, { timeout: 30_000 });
  await markSignInAsRecent(page).catch(() => undefined);
  await page
    .locator(".js-reuse-account", { hasText: `${who}@example.com` })
    .first()
    .click();

  await expect(startButton(page)).toBeVisible({ timeout: 60_000 });
  await markSignInAsRecent(page);
  await eventually(async () => await page.evaluate(() => window.currentUidForTest())).toBe(uid);
  await page.waitForTimeout(3_000);
  expect(await accountExists(uid)).toBe(true);
  expect(await storedNames(uid)).toEqual(["W"]);

  await openDeleteScreen(page);
  await confirmButton(page).click();
  await expect(googleButton(page)).toBeVisible({ timeout: 60_000 });
  expect(await accountExists(uid)).toBe(false);
});
