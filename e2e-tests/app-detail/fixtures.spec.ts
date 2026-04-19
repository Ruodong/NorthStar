import { test, expect } from "@playwright/test";

/**
 * PR 4 — Fixture-driven variant rendering.
 *
 * Verifies that AnswerBlock's three edge-case branches render the right
 * copy when hit by real backend data from 71:
 *
 *   1. Sunset: A004410 (BOOS) — `decommissioned_at` set. Banner must
 *      show, status pill must read "SUNSET" even though CMDB still says
 *      Decommissioned/Active. Regression test for plan §13 PR 3 §3e +
 *      eng review Issue 7 (source-of-truth conflict).
 *
 *   2. Non-CMDB: X0002d683bfd2 (Axway MFT Gateway) — graph-only app,
 *      `cmdb_linked=false`. AnswerBlock renders the red "not in CMDB"
 *      strip; Overview tab still renders without crashing (partial
 *      graceful degradation per eng review).
 *
 *   3. Not found: A999999 — routes to not-found.tsx (Next 14 convention),
 *      HTTP 404, no React client error.
 *
 * If any of these fixture apps changes classification upstream (e.g.,
 * A004410 is revived out of decommissioned state) this file will fail
 * noisily — pick a different anchor from the same query below and
 * update the constant.
 */

// Fixture anchors. Sourced by the PR-4 author via:
//   SELECT app_id, name, decommissioned_at FROM northstar.ref_application
//   WHERE decommissioned_at IS NOT NULL ORDER BY decommissioned_at DESC;
//   -- and --
//   SELECT app_id FROM northstar.applications_history
//   WHERE app_id LIKE 'X%' LIMIT 5;
const SUNSET_APP = "A004410";      // BOOS, decommissioned 2026-02-06
const NON_CMDB_APP = "X0002d683bfd2"; // Axway MFT Gateway, cmdb_linked=false
const MISSING_APP = "A999999";     // Guaranteed-absent

test.describe("App Detail — sunset variant", () => {
  test("renders sunset banner with date", async ({ page }) => {
    await page.goto(`/apps/${SUNSET_APP}`);
    await page.waitForLoadState("networkidle");

    // Banner region exists + has "Sunset" strong + a YYYY-MM-DD date.
    const banner = page.locator('section[aria-labelledby="answer-block-name"] [role="status"]').first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Sunset");
    await expect(banner).toContainText(/\d{4}-\d{2}-\d{2}/);
  });

  test("status pill becomes SUNSET even for Decommissioned status", async ({ page }) => {
    await page.goto(`/apps/${SUNSET_APP}`);
    await page.waitForLoadState("networkidle");
    // Pill is inside the title row, next to the h1. Labeled by text.
    const headerPill = page
      .locator('section[aria-labelledby="answer-block-name"] span')
      .filter({ hasText: /^SUNSET$/ })
      .first();
    await expect(headerPill).toBeVisible();
  });
});

test.describe("App Detail — non-CMDB variant", () => {
  test("renders limited-info strip when cmdb_linked === false", async ({ page }) => {
    await page.goto(`/apps/${NON_CMDB_APP}`);
    await page.waitForLoadState("networkidle");

    const strip = page
      .locator('section[aria-labelledby="answer-block-name"] [role="status"]')
      .filter({ hasText: /not in CMDB/i })
      .first();
    await expect(strip).toBeVisible();
    await expect(strip).toContainText(/limited info|found in graph data/i);
  });

  test("does NOT show ✓ cmdb-linked green indicator", async ({ page }) => {
    await page.goto(`/apps/${NON_CMDB_APP}`);
    await page.waitForLoadState("networkidle");
    // The success indicator is aria-labeled "Linked in CMDB". It must
    // not exist on the non-CMDB page.
    const indicator = page.locator('span[aria-label="Linked in CMDB"]');
    expect(await indicator.count()).toBe(0);
  });

  test("Overview tab still renders sections without crashing", async ({ page }) => {
    await page.goto(`/apps/${NON_CMDB_APP}`);
    await page.waitForLoadState("networkidle");
    // OverviewTab is the default tab. The section headings live in h2s
    // with aria-labelledby links (see OverviewTab.SectionHeader).
    const headings = page.locator('h2[id^="overview-"]');
    expect(await headings.count()).toBeGreaterThan(0);
  });
});

test.describe("App Detail — missing app", () => {
  test("renders Next not-found.tsx with HTTP 404", async ({ page }) => {
    const response = await page.goto(`/apps/${MISSING_APP}`);
    expect(response?.status()).toBe(404);
    // The not-found.tsx body contains "App not found" per the rewrite
    // in PR 2 step 2f.
    await expect(page.locator("body")).toContainText("App not found");
  });
});
