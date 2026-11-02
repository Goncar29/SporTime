import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    tones: number;
    wakeLocks: number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.tones = 0;
    window.wakeLocks = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.tones += 1;
      return start.apply(this, args);
    };
    if ("wakeLock" in navigator) {
      const request = navigator.wakeLock.request.bind(navigator.wakeLock);
      navigator.wakeLock.request = (type) => {
        window.wakeLocks += 1;
        return request(type);
      };
    }
  });
});

test("a Tabata advances through its phases with sound", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /^Tabata/ }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("heading", { name: "Get ready" })).toBeVisible();

  await page.clock.runFor(10_100);
  await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  await expect(page.getByText("Round 1/8")).toBeVisible();
  expect(await page.evaluate(() => window.tones)).toBeGreaterThan(0);

  await page.clock.runFor(20_100);
  await expect(page.getByRole("heading", { name: "Rest", exact: true })).toBeVisible();

  await page.clock.runFor(230_000);
  await expect(page.getByRole("region", { name: "Workout complete" })).toContainText("03:50");
});

test("the clock keeps correct time when timers stop firing", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /^Stopwatch/ }).click();
  await page.getByRole("button", { name: /^Start/ }).click();

  // Jumps the wall clock without running timers, as a suspended tab would.
  await page.clock.fastForward(125_000);
  await page.clock.runFor(200);
  await expect(page.getByRole("timer")).toHaveText("02:05");
});

test("requests the screen wake lock while running", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect.poll(() => page.evaluate(() => window.wakeLocks)).toBe(1);
});

test("still loads and runs with no network after the first visit", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: /^Stopwatch/ }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await expect(page.getByRole("timer")).toHaveText("00:01", { timeout: 3_000 });
});

for (const [name, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
  ["small phone", { width: 320, height: 568 }],
  ["TV", { width: 1920, height: 1080 }],
] as const) {
  test(`nothing overflows on a ${name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const fits = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);

    await page.getByRole("button", { name: /^Start/ }).click();
    const GUTTER = 16;
    const clock = await page.getByRole("timer").boundingBox();
    expect(clock?.x).toBeGreaterThanOrEqual(GUTTER);
    expect((clock?.x ?? 0) + (clock?.width ?? 0)).toBeLessThanOrEqual(viewport.width - GUTTER);
    const controls = await page.getByRole("button", { name: "Pause" }).boundingBox();
    expect((controls?.y ?? 0) + (controls?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    expect(await fits()).toBe(true);
  });
}
