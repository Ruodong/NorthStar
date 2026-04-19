import { test, expect } from "@playwright/test";

test("A2 mockup parity: AnswerBlock + ARIA tablist + tree render correctly", async ({ page }) => {
  await page.goto("/apps/A002856");
  await page.waitForLoadState("networkidle");

  // ---- AnswerBlock ----
  await expect(page.locator("#answer-block-name")).toHaveText("OLMS");
  // KPI strip — three numbers, tabular-nums.
  const kpis = page.locator('section[aria-labelledby="answer-block-name"] [aria-label="Summary counts"] >> div').filter({ hasText: /^\d+$|^—$/ });
  expect(await kpis.count()).toBeGreaterThanOrEqual(3);

  // ---- Single tablist with 9 tabs ----
  const tablist = page.locator('[role="tablist"][aria-label="Application detail sections"]');
  await expect(tablist).toBeVisible();
  const tabs = tablist.locator('[role="tab"]');
  expect(await tabs.count()).toBe(9);

  // ---- Roving tabindex invariant: exactly one tab has tabindex=0 ----
  const tabindexes = await tabs.evaluateAll((els) => els.map((e) => (e as HTMLElement).tabIndex));
  const zeros = tabindexes.filter((t) => t === 0).length;
  const negs = tabindexes.filter((t) => t === -1).length;
  expect(zeros).toBe(1);
  expect(negs).toBe(8);

  // ---- Arrow-right keyboard nav switches tabs ----
  const overviewTab = page.locator('#tab-overview');
  await overviewTab.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  const selectedNow = await page.locator('[role="tab"][aria-selected="true"]').getAttribute("id");
  expect(selectedNow).toBe("tab-capabilities");

  // ---- Tree renders inside Capabilities panel with role=tree + treeitems ----
  await expect(page.locator('[role="tree"]')).toBeVisible();
  const treeitems = page.locator('[role="treeitem"]');
  expect(await treeitems.count()).toBeGreaterThan(0);
  // aria-level set per level
  const levels = await treeitems.evaluateAll((els) => els.map((e) => e.getAttribute("aria-level")));
  expect(levels.every((l) => l === "1" || l === "2" || l === "3")).toBeTruthy();

  // ---- Skip link present in layout ----
  const skip = page.locator(".skip-link");
  await expect(skip).toBeAttached();
  expect(await skip.getAttribute("href")).toBe("#main-content");
});
