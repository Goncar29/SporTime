import { expect, test } from "@playwright/test";

test("signing in unlocks the app, and it stays signed in after a reload", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("sportime.fakeAuth", "signed-out");
      sessionStorage.setItem("seeded", "true");
    }
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Start/ })).toBeHidden();

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("a signed-in user can still reload and train with no network", async ({ page, context }) => {
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("timer")).toBeVisible();
});

test("the service worker never answers Firebase's auth pages", async ({ page }) => {
  const worker = await page.request.get("/sw.js");
  expect(await worker.text()).toContain("__");
  expect(await worker.text()).toMatch(/denylist:\[[^\]]*__/);
});
