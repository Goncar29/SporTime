import { expect, test, type Page } from "@playwright/test";

const notice = (page: Page) => page.getByRole("region", { name: "Install Sportime" });

/** Hands the page the install offer Chrome sends when the app can be installed. */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        (window as unknown as { prompted: number }).prompted =
          ((window as unknown as { prompted?: number }).prompted ?? 0) + 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" }),
    });
    window.dispatchEvent(event);
  });
}

test("offers installing on entry, opens the browser's dialog, and stays on Profile", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();
  await offerInstall(page);
  await expect(notice(page)).toContainText("Install Sportime on your phone");

  await notice(page).getByRole("button", { name: "Install" }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
});

test("'Not now' keeps it away after a reload, and Profile still offers it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();
  await offerInstall(page);
  await notice(page).getByRole("button", { name: "Not now" }).click();
  await expect(notice(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: /^Start/ })).toBeVisible();
  await offerInstall(page);
  await expect(notice(page)).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("button", { name: "Profile" })
    .click();
  await page.getByRole("button", { name: "Install app" }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: number }).prompted)).toBe(1);
});

test.describe("on an iPhone", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  });

  test("explains the steps, since Safari has no install dialog", async ({ page }) => {
    await page.goto("/");
    await expect(notice(page)).toContainText("tap Share, then “Add to Home Screen”");
    await expect(notice(page).getByRole("button", { name: "Install" })).toHaveCount(0);
  });
});
