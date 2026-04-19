import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * PR 4 axe-core accessibility scan on the App Detail page.
 *
 * Runs the full WCAG AA rule set against:
 *   - /apps/A002856 (OLMS) — the canonical reference app. Default tab
 *     (Overview) exercises AnswerBlock + CTA bar + tablist + MetadataList.
 *   - Capabilities tab — exercises the ARIA tree.
 *   - /apps/A004410 (BOOS, sunset) — sunset banner + status mismatch copy.
 *   - /apps/X0002d683bfd2 (Axway MFT Gateway) — non-CMDB path, renders the
 *     "limited info" strip instead of CMDB fields.
 *
 * Runs against the stack on 71 (see playwright.config.ts baseURL).
 *
 * Rule scope: include('wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa').
 * We do NOT include 'best-practice' or 'experimental' — those are signal
 * but not blockers.
 *
 * Scoped violation list: if axe surfaces something we can't fix today
 * (e.g., a Cmd+K palette contrast issue that's cross-cutting), add the
 * rule id to IGNORED below with a dated reason. This lets us gate CI on
 * "no new violations" without pretending the old ones don't exist.
 */

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Known-triaged violations, NOT introduced by PR 3. Keeping this list
 * empty means the page is clean at AA. Populate only with discussed
 * exceptions — every entry needs (a) rule id, (b) date, (c) reason.
 */
const IGNORED_RULES: Array<{ id: string; reason: string; date: string }> = [];

test.describe("App Detail — axe-core WCAG AA scan", () => {
  test("OLMS /apps/A002856 — Overview default tab clean", async ({ page }) => {
    await page.goto("/apps/A002856");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .disableRules(IGNORED_RULES.map((r) => r.id))
      .analyze();
    expectNoViolations(results);
  });

  test("OLMS Capabilities tab — ARIA tree clean", async ({ page }) => {
    await page.goto("/apps/A002856");
    await page.waitForLoadState("networkidle");
    // Click into Capabilities tab so role=tree renders.
    await page.locator('#tab-capabilities').click();
    await page.waitForSelector('[role="tree"]', { timeout: 10_000 });
    const results = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .disableRules(IGNORED_RULES.map((r) => r.id))
      .analyze();
    expectNoViolations(results);
  });

  test("Sunset /apps/A004410 — banner + decommissioned status clean", async ({ page }) => {
    await page.goto("/apps/A004410");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .disableRules(IGNORED_RULES.map((r) => r.id))
      .analyze();
    expectNoViolations(results);
  });

  test("Non-CMDB /apps/X0002d683bfd2 — limited-info strip clean", async ({ page }) => {
    await page.goto("/apps/X0002d683bfd2");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(AXE_TAGS)
      .disableRules(IGNORED_RULES.map((r) => r.id))
      .analyze();
    expectNoViolations(results);
  });
});

// ---- Helpers ------------------------------------------------------------

function expectNoViolations(results: {
  violations: Array<{
    id: string;
    impact?: string | null;
    description: string;
    nodes: Array<{ target?: string[]; html?: string; failureSummary?: string }>;
  }>;
}) {
  if (results.violations.length === 0) {
    expect(results.violations.length).toBe(0);
    return;
  }

  // Format a readable report so CI failures are debuggable.
  const lines: string[] = [];
  lines.push(`axe-core found ${results.violations.length} violation(s):`);
  for (const v of results.violations) {
    lines.push(`\n  [${v.impact || "?"}] ${v.id} — ${v.description}`);
    for (const n of v.nodes.slice(0, 3)) {
      const target = (n.target || []).join(" > ");
      const summary = (n.failureSummary || "").split("\n").slice(0, 2).join(" | ");
      lines.push(`    · ${target}`);
      lines.push(`      ${summary}`);
    }
    if (v.nodes.length > 3) {
      lines.push(`    … +${v.nodes.length - 3} more occurrence(s)`);
    }
  }
  throw new Error(lines.join("\n"));
}
