import { test, expect } from "@playwright/test";

const TEST_APP = "A000394"; // LBP — known to have integrations + deployment

test.describe("Application Detail Page", () => {
  test("overview tab loads", async ({ page }) => {
    await page.goto(`/apps/${TEST_APP}`);
    await page.waitForTimeout(3000);
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 15000 });
  });

  test("integrations tab shows data", async ({ page }) => {
    await page.goto(`/apps/${TEST_APP}`);
    await page.waitForTimeout(3000);
    const intTab = page.locator("button, [role=tab]", { hasText: /Integrations/ }).first();
    await intTab.click();
    await page.waitForTimeout(2000);
    const tables = page.locator("table");
    expect(await tables.count()).toBeGreaterThan(0);
  });

  test("deployment tab shows infrastructure", async ({ page }) => {
    await page.goto(`/apps/${TEST_APP}`);
    await page.waitForTimeout(3000);
    const depTab = page.locator("button, [role=tab]", { hasText: /Deployment/ }).first();
    await depTab.click();
    await page.waitForTimeout(3000);
    await expect(page.locator("text=servers").first()).toBeVisible({ timeout: 10000 });
  });

  test("deployment city table has env column", async ({ page }) => {
    await page.goto(`/apps/${TEST_APP}`);
    await page.waitForTimeout(3000);
    const depTab = page.locator("button, [role=tab]", { hasText: /Deployment/ }).first();
    await depTab.click();
    await page.waitForTimeout(3000);
    await expect(page.locator("th:has-text('Environment')").first()).toBeVisible({ timeout: 10000 });
  });

  test("investments tab loads", async ({ page }) => {
    await page.goto(`/apps/${TEST_APP}`);
    const invTab = page.locator("button, a, [role=tab]", { hasText: /Investments/ });
    if (await invTab.isVisible()) {
      await invTab.click();
      await page.waitForTimeout(1000);
    }
  });

  test("confluence tab loads", async ({ page }) => {
    await page.goto(`/apps/${TEST_APP}`);
    const tab = page.locator("button, a, [role=tab]", { hasText: /Confluence/ });
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForTimeout(1000);
    }
  });
});
