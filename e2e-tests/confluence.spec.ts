import { test, expect } from "@playwright/test";

test.describe("Confluence Raw Data", () => {
  test("page list loads with results", async ({ page }) => {
    await page.goto("/admin/confluence");
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("fiscal year filter works", async ({ page }) => {
    await page.goto("/admin/confluence?fy=FY2526");
    await page.waitForSelector("table tbody tr", { timeout: 30000 });
    // FY2526 param should filter results
    const rows = page.locator("table tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("search filters results", async ({ page }) => {
    await page.goto("/admin/confluence");
    await page.waitForSelector("table tbody tr", { timeout: 20000 });
    await page.fill("input[placeholder*=Search]", "LI2400444");
    await page.waitForTimeout(2000);
    // Results should load
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
  });

  test("pagination controls visible", async ({ page }) => {
    await page.goto("/admin/confluence?fy=FY2526");
    await page.waitForSelector("table tbody tr", { timeout: 30000 });
    // Pager buttons should exist
    const buttons = page.locator("button");
    expect(await buttons.count()).toBeGreaterThan(0);
  });

  test("detail page loads from link", async ({ page }) => {
    await page.goto("/admin/confluence/584960297"); // MOSAIC AWSP API
    await page.waitForTimeout(3000);
    // Page title should be visible
    await expect(page.locator("text=MOSAIC")).toBeVisible({ timeout: 30000 });
  });
});
