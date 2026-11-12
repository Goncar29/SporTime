import { expect, test, type Page } from "@playwright/test";
import { openTab } from "./helpers";

declare global {
  interface Window {
    phrases: { text: string; lang: string }[];
    toneCount: number;
  }
}

// Chrome has no voices when headless, so the system voice is replaced by a recorder.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.phrases = [];
    window.toneCount = 0;
    // oxlint-disable-next-line typescript/unbound-method -- called below with apply(this), so it keeps the node as this
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.toneCount += 1;
      return start.apply(this, args);
    };
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        getVoices: () => [{ lang: "en-US" }, { lang: "es-ES" }],
        cancel: () => undefined,
        speak: (utterance: { text: string; lang: string }) => {
          if (utterance.text) window.phrases.push({ text: utterance.text, lang: utterance.lang });
        },
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        lang = "";
        voice = null;
        onerror = null;
        constructor(readonly text: string) {}
      },
    });
  });
});

const option = (page: Page, name: string) => page.getByRole("switch", { name });
const said = (page: Page) => page.evaluate(() => window.phrases.map(({ text }) => text));

test("with the voice off a workout says nothing and keeps its tones", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: /^Tabata/ }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.clock.runFor(10_100);
  await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  expect(await said(page)).toEqual([]);
  expect(await page.evaluate(() => window.toneCount)).toBeGreaterThan(0);
});

test("the chosen announcements are spoken, and the choice survives a reload", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Settings" }).click();
  await option(page, "Voice announcements").check();
  await option(page, "Interval sound").uncheck();
  await page.reload();
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(option(page, "Voice announcements")).toBeChecked();
  await expect(option(page, "Interval sound")).not.toBeChecked();
  await openTab(page, "Timer");

  await page.getByRole("button", { name: /^Tabata/ }).click();
  await page.getByRole("button", { name: /^Start/ }).click();
  await page.clock.runFor(10_100);
  await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
  // Work lasts 20 seconds, so its halfway and its 10 seconds left share one moment.
  await page.clock.runFor(10_100);
  await page.clock.runFor(10_100);
  await expect(page.getByRole("heading", { name: "Rest", exact: true })).toBeVisible();

  expect(await said(page)).toEqual([
    "Get ready",
    "3",
    "2",
    "1",
    "Work",
    "10 seconds left",
    "3",
    "2",
    "1",
    "Rest",
  ]);
  expect(await page.evaluate(() => window.toneCount)).toBe(0);
});

test("the voice speaks the app's language", async ({ page }) => {
  await page.clock.install();
  await page.goto("/");
  await openTab(page, "Profile");
  await page.getByRole("button", { name: "Settings" }).click();
  await option(page, "Voice announcements").check();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Español" }).click();
  await openTab(page, "Timer");
  await page.getByRole("button", { name: /^Iniciar/ }).click();
  expect(await page.evaluate(() => window.phrases)).toEqual([{ text: "Prepárate", lang: "es" }]);
});
