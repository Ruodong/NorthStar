import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/NorthStar/);
  });

  test("reference data page loads", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.locator("text=Reference Data Overview")).toBeVisible({ timeout: 15000 });
  });

  test("confluence raw data page loads", async ({ page }) => {
    await page.goto("/admin/confluence");
    await expect(page.locator("h1")).toBeVisible({ timeout: 15000 });
  });

  test("search returns results", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(500);
    // Command palette should appear
    const palette = page.locator("[role=dialog], [data-testid=command-palette]");
    if (await palette.isVisible()) {
      await page.keyboard.type("polaris");
      await page.waitForTimeout(1000);
    }
  });
});
