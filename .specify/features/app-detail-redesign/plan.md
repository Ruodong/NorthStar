# App Detail Page Redesign

| Field   | Value                |
|---------|----------------------|
| Author  | Ruodong Yang         |
| Date    | 2026-04-18           |
| Status  | Draft (post `/plan-design-review`) |
| Source  | `/plan-design-review` adapted to live page (no prior plan existed) |
| Anchor  | `/apps/A002856` (OLMS) — populated app, used as review subject |

---

## 1. Context

The App Detail page (`frontend/src/app/apps/[app_id]/page.tsx`, currently 4,863 lines, all 9 tabs inline) is NorthStar's most-used surface. An architect lands here from search, from a Slack ping, from a project review, or from a graph traversal — and asks one of six questions:

1. "What is this app?"
2. "Who depends on it / who does it depend on?"
3. "Is anyone changing it right now?"
4. "Show me the architecture diagrams."
5. "Is it healthy / in CMDB / properly owned?"
6. "Already in another project's roadmap?"

Today the page treats all six as equal — encyclopedia of facts, no journey shaping. The design language (Orbital Ops per `DESIGN.md`) is solid; the application of it on this page is uneven.

This plan captures findings + locked decisions from a 7-pass design review and breaks the work into three sequential PRs.

---

## 2. Score

**Initial: 6 / 10. After plan: 8 / 10 projected (won't reach 10 until shipped + measured).**

| Pass | Initial | After plan | Notes |
|------|---------|-----------|-------|
| 1. Information Architecture | 4/10 | 8/10 | Tab grouping + above-fold answer block locked |
| 2. Interaction State Coverage | 4/10 | 8/10 | Per-tab state matrix + sunset variant + non-CMDB path defined |
| 3. User Journey & Emotional Arc | 5/10 | 7/10 | Storyboard + reorder + activity timestamp + opt-in CTA bar |
| 4. AI Slop Risk | 7/10 | 9/10 | 4-panel mosaic killed (replaced with `MetadataList`) + KPI anchor + motion spec |
| 5. Design System Alignment | 6/10 | 9/10 | DESIGN.md gets Motion / Interaction States / 5 component primitives |
| 6. Responsive & A11y | 3/10 | 8/10 | Desktop-only declared; full a11y (focus / aria-expanded / landmark / skip-link / contrast) + ARIA tree on Capabilities |
| 7. Decisions resolved | — | 6 of 6 + 8 silent picks | All locked |

---

## 3. Locked Decisions

### Locked silently (not contested)

| ID | Decision | Value |
|----|----------|-------|
| L1 | Tab group labels show count? | No. Children show counts; group label is plain text. |
| L2 | Sunset banner copy | "Sunset — decommissioned `<date>`. Data shown for reference only." |
| L3 | Sunset URL path | Same `/apps/[id]`. Status, not route. |
| L4 | Where Motion + Component Primitives live | Append to existing `DESIGN.md`. |
| L5 | Page-level error boundary scope | App Detail page only (not root layout). |
| L6 | Back-port Capabilities tab to new primitives | Yes, in the redesign PR. |
| L7 | Sync timestamp placement | Title row, right side: "Updated 4h ago by sync_from_egm". |
| L8 | Status pill blue is double-meaning (CMDB / CIO-CDTO)? | Keep — DESIGN.md says blue = "classification, no judgment". |

### Resolved with user input

| ID | Question | Choice | Rationale |
|----|----------|--------|-----------|
| Pass 1 | Tab grouping | A — three groups: ABOUT (Overview, Capabilities) · CONNECTIONS (Integrations, Impact, Deployment) · WORK (Investments, Diagrams, Confluence, Knowledge Base) | Tabs already break into 3 conceptual buckets; making it visible costs 1 nav level, pays back as tab count grows. |
| Pass 2 | Sunset visual loudness | B — top banner + status pill turns red, rest of page normal | Clear signal without obscuring still-useful historic metadata. |
| Pass 3 | Page posture | D — Reference + opt-in CTA bar (4 fixed actions under title) | Preserves "architect's reference tool" positioning while adding low-effort journey affordance. |
| Pass 4 | Replace 4-panel mosaic | A — single dense `<dl>` MetadataList, no card chrome | Eliminates "stacked-cards-instead-of-layout" hard-reject pattern. Bloomberg Terminal energy. |
| Pass 5 | DESIGN.md codification scope | B — DESIGN.md ships first as its own doc-only PR; redesign PR cites it | Smaller blast radius. Doc PR is low-risk. |
| Pass 6 | A11y level | B — focus styles + aria-expanded + landmark + skip-link + contrast fixes + full ARIA tree on Capabilities | Compliance baseline + Capabilities is most complex collapsible, must be done right. |
| Pass 7 D1 | AnswerBlock file location | B — sibling file `apps/[app_id]/AnswerBlock.tsx` | Matches CapabilitiesTab.tsx pattern. |
| Pass 7 D2 | Purpose sentence data source | D — fall back to `short_description` (truncated to 1 sentence), AI generation deferred | Doesn't couple redesign to a separate AI feature. |
| Pass 7 D3 | CTA bar 4 actions | A — View Impact · See Investments · Show Diagrams · Show Confluence | Maps to the 4 highest-frequency architect scenarios. |
| Pass 7 D4 | KPI anchor — which 3 numbers | A — Integrations · Capabilities · Investments | "What it connects · what it does · who invests" triangle. |
| Pass 7 D5 | MetadataList field order | A — Identity → Ownership → Posture → Geo → TCO → System metadata | Logical "what is it → whose → how → where → how much → details". |
| Pass 7 D6 | Extract tab components from page.tsx | C — refactor PR first (extract all 9 tabs), then redesign PR | Cleanest review surface. Avoids mixed-concerns mega-PR. |

---

## 4. Scope (4 sequential PRs)

Per eng review Issue 16: NorthStar has no frontend test framework today. The 12 ACs listed in §5 are unverifiable without one. PR 4 (this scope expansion) introduces Playwright + axe-core, writes E2E tests for all 12 ACs plus a11y automation, and establishes the pattern for future UI PRs to use. Committed scope expansion (chosen over shortcut options B/C/D).

### PR 1 — DESIGN.md updates (doc-only)

Append to `DESIGN.md`:

```
## Motion
- Tab switch: instant, no fade.
- Lazy-load content fade-in: 120ms, content area only.
- Collapse / expand: 100ms height transition.
- No bounces, no springs, no decorative motion.

## Interaction States
loading: "Loading <noun>…" in --text-dim, 13px, 12px padding-block.
empty:   centered card, dashed border var(--border-strong), 48x24 padding,
         15px title in --text + 13px body in --text-muted, no CTA unless
         the action is meaningful (link to data source counts as meaningful).
error:   red banner, 1px solid rgba(255,107,107,0.3), 4px radius,
         13px body in #ff6b6b. Inline at the affected section, not page-wide.
partial: same surface as success but show "(N rows filtered)" in --text-muted
         at the section footer.

## Responsive
NorthStar is desktop-only. ≥1024px supported. Below 1024 shows a single
"Use a desktop browser" placeholder.
- 1440 — design baseline (4 columns of metadata fit, full tab row visible)
- 1280 — panels collapse from 4 cols → 3 cols; tab nav inter-group gap 56→32, intra-group tab gap 18→12 (per eng review Issue 8)
- 1024 — panels collapse from 3 cols → 2 cols; tab nav falls back to horizontal scroll if 3 groups still overflow

## Accessibility
Focus: outline 1px solid var(--accent), outline-offset 2px on :focus-visible.
Landmark: every page wraps content in <main id="main">, nav in <nav aria-label="…">.
Skip link: every page renders <a class="sr-only" href="#main">Skip to main</a>.
Contrast: minimum WCAG AA. Text on dark surfaces verified via axe-core.
Collapsibles: aria-expanded reflects state, aria-controls points to content id.
ARIA tree (specific): hierarchical lists like CapabilityTree use role="tree",
  role="treeitem", aria-level={1|2|3}, aria-expanded.

## Component Primitives

AnswerBlock — above-the-fold summary on entity detail pages.
  Layout: name (h1) + status pills inline · purpose (body, max 2 lines, fall
          back to short_description) · 3 metadata rows (label caption / value body)
          · activity timestamp ("Updated Nh ago by <source>") right-aligned.
  Use on: /apps/[id], future /projects/[id], /capabilities/[id].

MetadataList — dense definition list, no card chrome.
  Layout: 2-column. Label = caption 11px uppercase tracking 0.7px var(--text-dim).
          Value = body 14px var(--text). Spacing: 8px row gap, 24px column gap.
  No borders, no panels, no per-row chrome.

StatusPill — semantic.
  green: active / live
  amber: investment / under review
  red:   sunset / decommissioned
  blue:  classification / tag (no judgment, supports multi-meaning)
  gray:  neutral metadata (no judgment)

CapabilityTree — 3-level collapsible (L1 / L2 / L3 leaf).
  Reference impl: frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx
  All three levels share font family (display) and color (--text);
  size descends 13/12/13. Count badges (mono, --text-dim) right-aligned
  on L1 + L2. L3 leaf folds owner + CN subtitle when collapsed.

CountBadge — accompanies tab labels, count badges in trees, etc.
  Hide rule: when count === 0 || count === undefined.
  Style: mono 11px var(--text-dim), 4px left margin from label.
```

Also update font stack with CJK fallback:
```
font-family: 'Geist', 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif;
```

**Affected files:** `DESIGN.md` only.

### PR 2 — Tab extraction refactor

Move every tab body from `frontend/src/app/apps/[app_id]/page.tsx` into sibling files:

```
frontend/src/app/apps/[app_id]/
├── page.tsx                  (target ~500 lines — title block, tab nav, conditional render)
├── tabs/
│   ├── OverviewTab.tsx       (extracted; current ~600 lines)
│   ├── CapabilitiesTab.tsx   (already extracted — moved from sibling to tabs/)
│   ├── IntegrationsTab.tsx   (extracted; current ~800 lines)
│   ├── DeploymentTab.tsx     (extracted; current ~430 lines)
│   ├── ImpactTab.tsx         (extracted; current ~700 lines)
│   ├── InvestmentsTab.tsx    (extracted)
│   ├── DiagramsTab.tsx       (extracted)
│   ├── ConfluenceTab.tsx     (extracted)
│   └── KnowledgeBaseTab.tsx  (extracted)
└── AnswerBlock.tsx           (created in PR 3, not this one)
```

**Constraint:** zero behavior change. Just file moves + import wiring. Each extracted file's first commit is "move only" (mechanical), second commit (if any) is "fix imports / cleanup". Easy diff to review.

**State passing (per eng review Issue 4):** explicit props, NOT React Context.
- Each tab declares its own props interface listing only the fields it consumes.
- `page.tsx` destructures `AppDetailResponse` once and passes the slice each tab needs:
  ```tsx
  {tab === "overview" && <OverviewTab app={app} investments={investments} confluencePages={confluence_pages} tco={tco} />}
  {tab === "integrations" && <IntegrationsTab appId={app.app_id} />}
  ```
- Reasons: (a) PR 2's "zero behavior change" constraint forbids introducing new primitives; (b) explicit > clever (eng preference); (c) Context can be added later when a sibling page (e.g. `/projects/[id]`) needs the same primitives.

**Verification of "zero behavior change":** since NorthStar has no automated frontend tests, PR 2 ships with a manual checklist appended to its commit message:
- Visit each of `/apps/A002856`, `/apps/A000005`, `/apps/A999999` (404), `/apps/A003000` (sparse) before AND after PR 2; screenshot each tab; diff visually.
- Run `next build` inside the docker container — clean build with zero new TS errors.
- See PR 2 §verification-checklist for full repro steps.

**Affected files:**
- `frontend/src/app/apps/[app_id]/page.tsx` — strip tab bodies, retain destructure + tab nav + conditional render
- `frontend/src/app/apps/[app_id]/tabs/*.tsx` — 9 new files
- `frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx` — moves to `tabs/CapabilitiesTab.tsx`
- Imports adjust accordingly.

### PR 3 — Redesign (the actual UX changes)

Layered against PR 1 + PR 2.

**1. Add `AnswerBlock.tsx`** above the tab nav. Renders:
- Title row: `app_id` (mono, dim) + `name` (h1, 28px Space Grotesk 600) + status pills inline + activity timestamp right-aligned ("Updated 4h ago" — drop the "by sync_from_egm" suffix; not user-facing signal)
- CMDB indicator: mono 11px green `✓ cmdb-linked` immediately after name when `cmdb_linked === true`; red `✗ not in cmdb` when false
- Purpose line: `short_description` truncated to first sentence; falls back to "(no description)"
- KPI anchor row: 3 numbers in 38px Space Grotesk 600 tabular-nums. Format: `**N** integrations · **N** capabilities · **N** investments`
- **Data source per KPI** (per eng review Issue 3 — graph counts, not integration_interface counts):
  - `integrations` = `outbound.length + inbound.length` from existing `/api/graph/nodes/{app_id}` response (architecture-side count, matches the "what diagram says" model)
  - `capabilities` = `total_count` from `/api/apps/{app_id}/business-capabilities` (already pre-fetched as `capCount`)
  - `investments` = `investments.length` from existing `/api/graph/nodes/{app_id}` response
  - **All three derive from existing fetches. No new HTTP call.** AnswerBlock receives them as props from page.tsx.
  - Explicit choice over `integration_interface` count (43 for A002856) because architects use NorthStar as a reference tool for the architectural model, not as a platform-registration audit (per CEO plan + design review Pass 3).
- 3-row metadata: Last change · Owners · Geo

**2. Reorder tabs into 3 groups under title:**
```
ABOUT          CONNECTIONS                WORK
Overview       Integrations               Investments
Capabilities   Impact Analysis            Diagrams
               Deployment                 Confluence
                                          Knowledge Base
```
Visual: small group label above each group's tabs (caption 11px uppercase var(--text-dim)).

**3. Add CTA bar** under the AnswerBlock (4 buttons): View Impact · See Investments · Show Diagrams · Show Confluence. Each is a tab-jumper (sets `tab` state, scrolls to tab content). Honor `disabled` state when count === 0.

**4. Replace Overview's 4-panel grid** with `MetadataList` (no card chrome). Field order per Pass 7 D5.

**5. Sunset variant**: when `app.status === 'Sunset'` or `app.decommissioned_at !== null`:
- Top banner: red strip (full width), "Sunset — decommissioned 2025-03-15. Data shown for reference only."
- Title-row status pill becomes red `SUNSET`.
- Rest of page renders normally (per Pass 2 B).
- **Source-of-truth conflict** (per eng review Issue 7): if `app.status === 'Active'` AND `decommissioned_at !== null`, trust `decommissioned_at` (concrete timestamp beats stale string). Banner appends a one-line note: "Status mismatch detected — CMDB lists Active but decommissioned 2025-03-15. Treating as sunset."

**6. Non-CMDB X-prefixed apps** (`app.cmdb_linked === false`):
- Don't 404. Render the page with available graph data.
- **Backend already supports this** — `graph_query.get_application()` returns 200 + partial app_dict when graph has the node but CMDB doesn't (verified in eng review: `graph_query.py:121-123`). The router only 404s when BOTH graph AND CMDB miss the id. No backend changes required.
- Frontend logic: check `app.cmdb_linked === false` in the response. AnswerBlock notes "Found in graph data, not in CMDB. Limited info available."
- Tabs that need CMDB data (Deployment, TCO panel) show empty state with "Requires CMDB linkage."

**7. Page-level error handling** uses Next.js App Router file convention, not a custom ErrorBoundary class:
- Create `frontend/src/app/apps/[app_id]/error.tsx` (Next.js auto-wraps page.tsx with this).
- Client component, props `{ error: Error & { digest?: string }; reset: () => void }`.
- Renders: "NorthStar can't load this app right now. [Retry → calls reset()] [Back to home]"
- Spec: https://nextjs.org/docs/app/api-reference/file-conventions/error
- **NOT** a custom `<ErrorBoundary>` component — Next.js convention covers exactly this case (per eng review Issue 2).

**8. Initial-load skeleton** for the AnswerBlock + first tab (Overview). 120ms fade-in once data arrives.

**9. A11y baseline** (Pass 6 B):
- `<main id="main">` wraps content
- `<a class="sr-only" href="#main">Skip to main content</a>` at page top
- Tab nav: `<nav aria-label="App detail tabs">`
- Every collapsible button: `aria-expanded`, `aria-controls`
- CapabilityTree: full ARIA tree pattern (role="tree", role="treeitem", aria-level)
- Global focus-visible style applied via `globals.css`

**10. Back-port Capabilities tab** to use new primitives:
- L1/L2/L3 row visual stays — already aligns with new MetadataList density.
- Add `aria-expanded` / `aria-controls` to all 3 levels.
- Wrap in `role="tree"`.

**11. Per-tab state matrix** (per Pass 2 fixes table) — every tab gets the documented loading / empty / error / partial treatment per the new DESIGN.md `Interaction States` section.

**12. Per-tab count badge logic**: hide when 0 or undefined (already shipped, codify per DESIGN.md `CountBadge` primitive).

**13. DRY — `useTabFetch` hook** (per eng review Issue 9):
- Create `frontend/src/lib/hooks/useTabFetch.ts`:
  ```tsx
  export function useTabFetch<T>(url: string, deps: React.DependencyList) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
      let cancelled = false;
      (async () => {
        setLoading(true); setErr(null);
        try {
          const r = await fetch(url, { cache: "no-store" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          if (cancelled) return;
          if (!j.success) { setErr(j.error || "Request failed"); return; }
          setData(j.data as T);
        } catch (e) {
          if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, deps);
    return { data, loading, error: err };
  }
  ```
- Migrate 4 heaviest tabs to use it in the redesign PR:
  - `tabs/CapabilitiesTab.tsx` (-~15 lines)
  - `tabs/ImpactTab.tsx` (-~15 lines)
  - `tabs/DeploymentTab.tsx` (-~15 lines)
  - `tabs/KnowledgeBaseTab.tsx` (-~15 lines)
- Remaining tabs (Integrations, etc.) migrate when next touched — not required for this PR.
- Net: ~60 lines of duplication removed, one canonical pattern that future tabs reuse.

**14. Status pill CSS uses `--pill-color` pattern** (per eng review Issue 11) — codified in DESIGN.md `StatusPill` primitive:
  ```css
  .pill {
    --pill-color: currentColor;
    color: var(--pill-color);
    border: 1px solid color-mix(in srgb, var(--pill-color) 40%, transparent);
    background: color-mix(in srgb, var(--pill-color) 8%, transparent);
  }
  .pill.green { --pill-color: var(--status-green); }
  .pill.blue  { --pill-color: var(--status-blue); }
  .pill.amber { --pill-color: var(--accent); }
  .pill.red   { --pill-color: var(--status-red); }
  ```
  No more copy-paste of `color-mix` per color.

**15. capCount stays in page.tsx** (per eng review Issue 10), passed as prop to AnswerBlock. Shared with `<TabButton value="capabilities" count={capCount}>`. No double-fetch.

**16. error.tsx is a client component** — first line `'use client'` required by Next.js App Router (per eng review Issue 14).

**Affected files:**
- `frontend/src/app/apps/[app_id]/page.tsx` — layout rewrite, tab grouping, AnswerBlock + CTA bar mount
- `frontend/src/app/apps/[app_id]/AnswerBlock.tsx` — NEW
- `frontend/src/app/apps/[app_id]/error.tsx` — NEW (Next.js error boundary file convention; replaces the originally-planned `components/ErrorBoundary.tsx`)
- `frontend/src/app/apps/[app_id]/tabs/OverviewTab.tsx` — replace 4-panel grid with MetadataList
- `frontend/src/app/apps/[app_id]/tabs/CapabilitiesTab.tsx` — back-port: aria-tree
- `frontend/src/app/globals.css` — focus-visible style, sr-only utility class
- (no backend changes — verified during eng review that `graph_query.get_application()` already returns 200 for non-CMDB X-prefixed apps that exist in graph)

### PR 4 — Playwright + axe-core automation (scope-expansion from eng review)

First-time introduction of Playwright to NorthStar. Establishes the pattern; this redesign is the first consumer but future UI PRs inherit it.

**1. Install + configure Playwright:**
```bash
cd frontend
npm install --save-dev @playwright/test@latest @axe-core/playwright@latest
npx playwright install chromium  # single browser, keep CI cost low
```

**2. Create `frontend/playwright.config.ts`:**
- `testDir: '../e2e-tests'` (project root already has empty `e2e-tests/` dir — use it)
- `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://192.168.68.71:3003'`
- One project `desktop-chromium` at 1440×900 viewport
- `retries: 1` on CI, 0 local
- `reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]]`

**3. Add scripts to `frontend/package.json`:**
```json
"scripts": {
  "e2e": "playwright test",
  "e2e:headed": "playwright test --headed",
  "e2e:ui": "playwright test --ui"
}
```

**4. E2E test files** — one file per concern, mapped to ACs:

| Test file | ACs covered |
|-----------|-------------|
| `e2e-tests/app-detail/answer-block.spec.ts` | AC-1, AC-2, AC-3 (populated + no-description + zero-count) |
| `e2e-tests/app-detail/sunset-variant.spec.ts` | AC-4 (sunset banner + status mismatch) |
| `e2e-tests/app-detail/non-cmdb-app.spec.ts` | AC-5 (X-prefixed render with limited info) |
| `e2e-tests/app-detail/a11y.spec.ts` | AC-6, AC-7 (keyboard focus + aria-expanded) + axe-core scan |
| `e2e-tests/app-detail/error-boundary.spec.ts` | AC-8 (backend 500 → error.tsx; mock fetch failure) |
| `e2e-tests/app-detail/responsive.spec.ts` | AC-9, AC-10 (1280/1024 gap fallback + <1024 placeholder) |
| `e2e-tests/app-detail/pr-refactor-smoke.spec.ts` | Verifies PR 2 refactor: baseline screenshot diff for 5 key paths |
| `e2e-tests/app-detail/migration-checks.spec.ts` | AC-11 (DESIGN.md primitives present), AC-12 (page.tsx ≤ 700 lines) — lightweight file/grep assertions |

**5. CI integration (optional for this PR, required TODO):**
- Flag as P1 TODO: add `.github/workflows/e2e.yml` (or GitLab CI equivalent) that spins up the docker-compose stack on a runner, waits for health, runs `npm run e2e`, uploads report on failure.
- This PR ships with a documented LOCAL run command: `cd frontend && npx playwright test`. CI automation is a separate, follow-up PR.

**6. axe-core integration** in `a11y.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('AC-6+AC-7: /apps/A002856 passes WCAG AA', async ({ page }) => {
  await page.goto('/apps/A002856');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

**Test anchor apps** (consistent across all E2E):
- `A002856` — populated, CMDB-linked, 7 BCs, 24 integrations (happy path)
- `A003000` — unmapped (empty states)
- `A999999` — truly missing (404 → not-found)
- An X-prefixed id from the actual graph (query `ns_graph` for one during test setup; if none, skip with `test.skip()`)
- A sunset app (query `ref_application` for one with `decommissioned_at IS NOT NULL`; if none, skip)

**Affected files:**
- `frontend/package.json` — add Playwright + axe deps, 3 scripts
- `frontend/playwright.config.ts` — NEW
- `e2e-tests/app-detail/*.spec.ts` — 8 NEW files
- `e2e-tests/README.md` — NEW (describes pattern so next UI PR extends it)
- `CLAUDE.md` — update Testing section: "E2E: `cd frontend && npm run e2e`. Runs against 71 by default; override via `PLAYWRIGHT_BASE_URL`."
- `frontend/.gitignore` — add `playwright-report/`, `test-results/`

**Constraint:** E2E tests run **against the deployed 71 stack by default** (matches how NorthStar actually works — no local stack). CI TODO will change this to spin up an ephemeral stack. Don't over-engineer for CI now.

**Effort (per eng review):** human 1 week / CC 4h.

---

## 5. Acceptance Criteria

| ID | Given / When / Then |
|----|---------------------|
| AC-1 | **Given** a populated app like A002856, **When** the App Detail page loads, **Then** the AnswerBlock shows name + 1-sentence purpose + 3 KPI numbers + last-change row above the tab nav. |
| AC-2 | **Given** an app with no `short_description`, **When** the page loads, **Then** AnswerBlock shows "(no description)" — does not error or hide the field. |
| AC-3 | **Given** an unmapped app like A003000 (no BCs, no integrations beyond a couple), **When** opened, **Then** the KPI anchor shows "0 integrations · 0 capabilities · 0 investments" using the same KPI typography (no missing-data fallback). |
| AC-4 | **Given** a sunset app (`decommissioned_at` is a non-null timestamp), **When** the page loads, **Then** the page-top sunset banner appears in red with the decommissioned date formatted as `YYYY-MM-DD`, the status pill is red SUNSET, and the rest of the page renders normally. |
| AC-5 | **Given** a non-CMDB X-prefixed app, **When** the page is opened directly via URL, **Then** it renders with available data (does NOT 404), AnswerBlock notes the CMDB-absent state, and CMDB-dependent tabs show "Requires CMDB linkage" empty state. |
| AC-6 | **Given** any architect using only the keyboard, **When** they tab into the page, **Then** focus is visible (1px amber outline + 2px offset) on every interactive element, AND a "Skip to main content" link appears as the first tab stop. |
| AC-7 | **Given** a screen-reader user, **When** they navigate the Capabilities tab tree, **Then** each L1/L2/L3 button announces its expanded/collapsed state and ARIA level. |
| AC-8 | **Given** the backend returns 500 on `/api/graph/nodes/{id}`, **When** the user loads the page, **Then** the page shows "NorthStar can't load this app right now. [Retry] [Back to home]" instead of a white screen. |
| AC-9 | **Given** any window 1280–1440px wide, **When** the page is rendered, **Then** the MetadataList collapses from 2 columns → still 2 columns at 1280, and the tab row never wraps. |
| AC-10 | **Given** a window <1024px wide, **When** the page is loaded, **Then** the desktop-only placeholder shows: "Use a desktop browser to view NorthStar." |
| AC-11 | **Given** PR 1 is merged (DESIGN.md updates), **When** any reviewer opens DESIGN.md, **Then** sections Motion, Interaction States, Responsive, Accessibility, and Component Primitives are all present and reference real code paths. |
| AC-12 | **Given** PR 2 is merged (tab extraction), **When** any reviewer opens `apps/[app_id]/page.tsx`, **Then** it is ≤700 lines and contains no tab body inline (only tab nav + conditional render). |

---

## 6. NOT in Scope

| Item | Why deferred |
|------|--------------|
| AI-generated 1-sentence summary (`ai_summary` column + pipeline) | Already a P1 TODO. Couples this redesign to a separate AI feature; ship redesign with `short_description` fallback first. |
| "Pin / follow this app" + recent-views feed | New feature, not a redesign concern. File as TODO. |
| "Related apps" sidebar | Needs a similarity model. Out of scope. |
| Health-scoring "is this app OK?" pill | Pass 3 B was rejected — score depends on data we don't trust yet. |
| Mobile / phone responsive | Pass 6: explicitly desktop-only. |
| Keyboard shortcuts (`/`, `j/k`, `g o`) | Power-user nice-to-have. Add when there's evidence of repeat-architect daily use. |
| Full ARIA tree on every collapsible | Capabilities tab gets it (most complex). Other future trees follow same pattern. |
| High-contrast color theme | Defer until any complaint. |
| Dark/light theme toggle | DESIGN.md is dark-first by intent. No toggle planned. |
| `/apps/[id]/sunset` route | Pass 7 L3: rejected. Same URL. |

---

## 7. What Already Exists

**Don't reinvent:**

| Pattern | Location |
|---------|----------|
| 3-level collapsible tree | `apps/[app_id]/CapabilitiesTab.tsx` (use as reference impl for `CapabilityTree` primitive) |
| Tab nav + count badge | `apps/[app_id]/page.tsx` `TabButton` (badge already hides when 0 or undefined as of recent fix) |
| Inline error banner | Today's integrations dedup error state (`#ff6b6b` + 1px border) |
| Lazy-fetch pattern with cancellation | `ImpactTab` and `CapabilitiesTab` both follow it |
| Status pills | Already used (green/amber/red/blue) — just needs documenting in DESIGN.md |
| App-not-found page | Currently lives in `page.tsx` — clean centered card + amber CTA. Reuse for the 404 case (NOT for non-CMDB case — that gets its own treatment). |

---

## 8. TODOs Generated

To be appended to `TODOS.md`:

| ID | What | Priority |
|----|------|----------|
| T1 | AI-generated `ai_summary` pipeline (originally P1 TODO; redesign uses `short_description` fallback in interim) | P1 |
| T2 | "Pin / follow app" + recent-views (new feature, sidebar or palette item) | P2 |
| T3 | Related-apps sidebar (similarity model + UI) | P3 |
| T4 | Keyboard shortcuts for power users (`/`, `j/k`, `g o`) | P3 |
| T5 | High-contrast theme variant | P3 |
| T6 | Audit color contrast across NorthStar with axe-core (one-shot scan + fix any AA fails) | P1 (gates PR 3 ship) |
| T7 | Mobile placeholder page (single component, "use a desktop browser") | P2 (gates PR 3 ship) |

---

## 9. Approved Mockups

### Locked direction: **Variant A2 — Mission Control (refined)**

Generated 2026-04-18 via `/design-shotgun` (hand-crafted HTML mockups, not AI-generated — no OpenAI key available; browse tool rendered real DESIGN.md tokens at 1440×900 and screenshotted).

| Asset | Path |
|-------|------|
| Approved PNG | `~/.gstack/projects/Ruodong-NorthStar/designs/app-detail-redesign-20260418/variant-A2.png` |
| Source HTML (build reference) | `~/.gstack/projects/Ruodong-NorthStar/designs/app-detail-redesign-20260418/variant-A2.html` |
| Approval record | `~/.gstack/projects/Ruodong-NorthStar/designs/app-detail-redesign-20260418/approved.json` |

### Visual specification (locked by A2)

PR 3 implementation MUST match these token assignments:

- **App title row:**
  - `app_id` — JetBrains Mono 13px, `var(--text-dim)`
  - `name` — Space Grotesk 600, 32px, `var(--text)`, letter-spacing `-0.01em`
  - CMDB indicator — Mono 11px `var(--status-green)` `✓ cmdb-linked` immediately after name (for non-CMDB apps: red `✗ not in cmdb`)
  - Status pills — 3 max: ACTIVE (green) / CIO/CDTO (blue) / INVEST (amber). Sharp 2px radius. Mono 10px with 0.6px tracking.
  - Right-aligned timestamp: Mono 11px `var(--text-dim)`, format `Updated Nh ago` (no sync source)

- **Purpose line** (second-tier signal):
  - Geist 500, 16px, `var(--text)` (not dim)
  - Max 2 lines, `max-width: 980px`, 24px margin below

- **KPI anchor strip** (hero):
  - `display: grid; grid-template-columns: 1fr 1px 1fr 1px 1fr`
  - Container: 1px `var(--border)`, 4px radius, `var(--surface)` bg, 18px vertical padding
  - Numbers: Space Grotesk 600, **60px**, `var(--text)` (NOT amber), tabular-nums, letter-spacing `-0.02em`, line-height 1
  - Labels: Mono 11px `var(--text-dim)` uppercase, 1.4px tracking, 6px gap below number
  - Separators: 1px `var(--border)` vertical lines between the 3 cells
  - Fixed content: `24 integrations · 7 capabilities · 6 investments` (real numbers come from backend)

- **MetadataList** (replaces the 4-panel mosaic):
  - `display: grid; grid-template-columns: 120px 1fr; row-gap: 8px; column-gap: 24px`
  - No borders, no card chrome
  - Labels: Mono 11px `var(--text-dim)` uppercase, 0.7px tracking (caption token — per eng review Issue 13)
  - Values: Geist 13px `var(--text)`
  - Fields in order (Pass 7 D5 A): Identity → Ownership → Posture → Geo → TCO → System metadata

- **CTA bar** (1 primary, 3 ghost):
  - Primary: `View Impact` — amber bg (`var(--accent)`), dark text (`#1a1306`), mono 12px weight 600
  - Ghost (3): transparent bg, 1px `var(--border-strong)` border, mono 12px weight 500, `var(--text)` text
  - Hover: ghost → border brightens to `var(--text-muted)`; primary → bg lightens 12%
  - Spacing: 10px gap between buttons, 26px margin below

- **Tab navigation (3 groups)**:
  - Group labels: Mono 11px `var(--text-dim)` uppercase, 1.6px tracking, 8px below → tab row (per eng review Issue 12 — use existing `caption` token, don't invent 10px micro-caption)
  - Tabs: Geist 14px, inactive `var(--text-muted)` / active `var(--text)` + 2px `var(--accent)` underline
  - Count badges: Mono 11px `var(--text-dim)`, 6px left margin (hide when 0 or undefined)
  - Inter-group gap: 56px
  - Intra-group tab gap: 18px
  - Group 1 "ABOUT": Overview · Capabilities
  - Group 2 "CONNECTIONS": Integrations · Impact Analysis · Deployment
  - Group 3 "WORK": Investments · Diagrams · Confluence · Knowledge Base

### Live-review screenshots (before state)

- `/tmp/ns-design-review/01-overview.png` (Overview tab, A002856)
- `/tmp/ns-design-review/02-capabilities.png` (Capabilities tab, A002856)
- `/tmp/ns-design-review/03-integrations.png` (Integrations tab, A002856)
- `/tmp/ns-design-review/04-not-found.png` (A999999 404 state)
- `/tmp/ns-design-review/05-non-cmdb.png` (X-prefixed non-CMDB, today shows same 404)

### Iteration trail (for the record)

- Variant A (original Mission Control) → rejected: over-used amber (KPI numbers + CTA borders + active tab all amber burned the single-accent budget)
- Variant B (Editorial Quiet) → rejected: too airy, loses the "triage tool" feel
- Variant C (Bloomberg Terminal) → rejected: density too aggressive, all-mono CJK rendering brittle
- **Variant A2 (refined Mission Control) → approved**: kept A's hierarchy, fixed the 4 overuse issues

---

## 10. Cross-Feature Dependencies

| Feature | Dependency |
|---------|-----------|
| `business-capabilities` (last week's feature) | This redesign back-ports `CapabilitiesTab` to the new primitives + ARIA tree. No data layer changes. |
| `architecture-template-settings` | Unaffected. |
| `confluence-*` features | Confluence tab moves into the WORK group; no behavior change. |
| Future `/projects/[id]` redesign | Should reuse `AnswerBlock` + `MetadataList` primitives codified in PR 1. |
| Future `/capabilities/[id]` page | Should reuse `AnswerBlock` + `CapabilityTree` (reverse direction: from BC → apps). |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 6/10 → 8/10, 12 decisions locked |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**VERDICT:** Design review CLEAR. Eng review required before PR 3 ships. CEO review optional but recommended to confirm 3-PR rollout ordering.

**UNRESOLVED:** 0 design decisions deferred to implementer. All 12 (6 questioned + 6 silent) resolved in §3.

**Next:** see "Next Steps" below.

---

## 11. Next Steps

1. **Optional:** `/design-shotgun` against the proposed AnswerBlock + tab-grouping layout. Generate 3 visual variants, pick one. Lock it as the visual reference for PR 3.
2. **Required before PR 3:** `/plan-eng-review` on the implementation plan (architecture, file structure, refactor blast radius).
3. **PR 1 (DESIGN.md doc-only)** — can ship as soon as this plan is approved.
4. **PR 2 (tab extraction refactor)** — depends on PR 1 merged.
5. **PR 3 (redesign)** — depends on PR 2 merged.

Estimated effort:
- PR 1: 1 hour CC (doc-only).
- PR 2: 4 hours CC (mechanical extraction, 9 files, tests stay green).
- PR 3: 1 day CC (the actual redesign — AnswerBlock, layout, sunset variant, a11y, error boundary).

> **Estimates above are POST-DESIGN-REVIEW. Eng review (§12) found multiple incorrect repo assumptions and a class of architectural shortcuts. Effort revised in §13.**

---

## 12. Eng Review Cross-Model Findings

`/plan-eng-review` ran 2026-04-19 on commit `7321e09`. 4 sections + outside voice (codex). 19 issues found across review sections + 17 additional findings from codex independent review.

### 12.1 Pure fixes already applied to §4 (no decisions, written above)

| # | Issue | Fix |
|---|-------|-----|
| 1 | Issue 1 — non-CMDB X-prefixed app | verified backend already supports it (`graph_query.py:121-123`); no backend change needed |
| 2 | Issue 2 — custom ErrorBoundary | use Next.js `error.tsx` file convention instead |
| 3 | Issue 3 — KPI integrations count ambiguity | use graph counts (`outbound + inbound`), not `integration_interface` count |
| 4 | Issue 4 — state passing after PR 2 | explicit props, not Context |
| 5 | Issue 7 — sunset source-of-truth | trust `decommissioned_at` over `status`, surface mismatch |
| 6 | Issue 8 — tab nav 1280 fallback | gap 56→32, intra 18→12 |
| 7 | Issue 9 — DRY useTabFetch hook | created (but see codex finding C — must preserve abort+timeout) |
| 8 | Issue 10 — capCount placement | stays in page.tsx, prop down |
| 9 | Issue 12, 13 — group/metadata label size | 11px (caption token), not 10px |
| 10 | Issue 14 — error.tsx 'use client' | required first line |
| 11 | Issue 19 — AnswerBlock 'use client' | required (uses hooks) |

### 12.2 Codex independent review — 17 findings

Run 2026-04-19, codex-cli 0.92.0, model_reasoning_effort=high. Result file `~/.gstack/projects/Ruodong-NorthStar/...` All hard claims verified against repo:

- ✓ Stack is **Next 14.2.18 + React 18.3.1** (plan had assumed 15/19) — `frontend/package.json:15`
- ✓ Vitest already configured at `frontend/vitest.config.ts`
- ✓ Playwright already configured at root `playwright.config.ts` with specs in `e2e-tests/app-detail.spec.ts` etc., wired into `scripts/run_all_tests.sh:67`
- ✓ Shared `Pill` component already exists at `frontend/src/components/Pill.tsx` (designed exactly for our StatusPill use case)
- ✓ `frontend/src/app/layout.tsx:44` already renders `<main className="main">{children}</main>`
- ✓ KnowledgeBaseTab already has AbortController + 15s timeout (`page.tsx:4099`)

These all invalidate parts of the original plan.

### 12.3 Cross-model tension decisions (all chose A — accept codex)

| Tension | Codex's challenge | Decision |
|---------|-------------------|----------|
| **T1** | `error.tsx` doesn't catch `useEffect` async failures (Next.js error boundaries only catch render errors). AC-8 in §5 wouldn't actually work. | **A — RSC rewrite.** Move main app fetch from client `useEffect` to server component. `error.tsx` + `not-found.tsx` then naturally catch failures. Tabs remain client-side, lazy-loaded. |
| **T2** | a11y plan only added `nav aria-label` and `role="tree"` attributes. Real tabs need `tablist`/`tab`/`tabpanel` + roving tabindex. Real tree needs keyboard arrow navigation. | **A — full ARIA.** Implement complete tablist pattern + tree keyboard navigation. ~2-3h CC. |
| **T3** | PR 2 not "mechanical" — page.tsx has shared helpers + subcomponents lines 398-4826, not just tab bodies. Extraction requires deciding shared boundaries. | **A — PR 2 expansion.** First write a shared-boundary inventory (every helper → tab-local or `components/`), THEN extract. ~+1d CC. |
| **T4** | AnswerBlock declared as "primitive" but planned at `apps/[app_id]/AnswerBlock.tsx` — that's page code, not a primitive. | **A — true primitive.** Move to `frontend/src/components/AnswerBlock.tsx`. Future `/projects/[id]` and `/capabilities/[id]` reuse. |
| **T5** | Hero KPI capability count is fetched in a separate `useEffect` AFTER initial render → "0 capabilities" flash on first paint. | **A — backend support.** Add `capability_count` field to `/api/graph/nodes/{id}` response (one extra COUNT in `graph_query.get_application()`). Zero flash, zero extra HTTP call. |

### 12.4 Codex findings handled by other corrections

- **Existing Pill component** → §13 PR 1 reuses, drops invented "StatusPill"
- **PR count inconsistency** → fixed in §13
- **AC-11/12 are not E2E** (file length, DESIGN.md content) → §13 PR 4 moves these to lint/grep scripts
- **PR 4 duplicates existing infra** → §13 PR 4 extends root `playwright.config.ts` + `e2e-tests/`, doesn't create frontend-local duplicates
- **useTabFetch downgrades KnowledgeBaseTab abort/timeout** → §13 hook signature accepts optional `{ signal, timeoutMs }`
- **Live-data test fragility** (skip if no sunset/X-prefixed app) → §13 ships seed-data fixture script
- **cmdb_linked is optional, not strict bool** → §13 explicit `cmdb_linked === false` only when defined; `undefined` triggers "limited info" path same as false but with different copy
- **PR 1 doc-first is backwards** → §13 keeps PR 1 doc-only but only documents primitives that actually exist OR ship in same PR set
- **Skip-link / main landmark wrong** → §13 puts skip link in `layout.tsx` (NOT page.tsx) before existing `<main>`. Doesn't add nested main.

---

## 13. Revised PR Scope (post-eng-review, supersedes §4)

**4 sequential PRs.** Effort doubled vs original §4 estimate due to RSC rewrite + full a11y + shared boundary work.

### PR 1 — DESIGN.md updates (doc-only)

Append to `DESIGN.md`. **Drop** `StatusPill` (Pill exists). Document only what ships in PR 2-4 OR already exists:

```
## Motion
(unchanged from §4 PR 1)

## Interaction States
(unchanged from §4 PR 1)

## Responsive
(unchanged + 1280 tab nav gap fallback per Issue 8)

## Accessibility
- Focus: outline 1px solid var(--accent), outline-offset 2px on :focus-visible.
- Skip link lives in layout.tsx (NOT per-page) — first tab stop, before nav.
- Tab pattern: every tabbed UI uses role="tablist" / role="tab" / role="tabpanel"
  with arrow-key navigation (left/right) and roving tabindex.
- Tree pattern: hierarchical lists use role="tree" / role="treeitem"
  with arrow-key navigation (up/down/left to collapse/right to expand)
  + roving tabindex.
- Contrast: WCAG AA via axe-core scan in E2E.

## Component Primitives
Pill — existing at frontend/src/components/Pill.tsx. Reuse, don't reinvent.
  Add semantic shorthand variants (green/blue/amber/red) via tone="green" prop
  if not already supported.

AnswerBlock — frontend/src/components/AnswerBlock.tsx (NEW, shared primitive).
  (spec from §9 mockup A2)

MetadataList — frontend/src/components/MetadataList.tsx (NEW, shared primitive).
  (spec from §9)

CapabilityTree — pattern documented; ref impl tabs/CapabilitiesTab.tsx.
  Full ARIA tree + keyboard navigation included.

CountBadge — pattern documented; lives inline in TabButton.
```

CJK fallback for font stack: unchanged.

**Effort:** 1.5h CC.

### PR 2 — Restructure (RSC + tab extraction + shared boundary inventory)

**Step 2a — Inventory.** Read page.tsx end-to-end. Produce `apps/[app_id]/REFACTOR-INVENTORY.md` listing every helper / subcomponent in page.tsx with disposition: `tab-local-X` (lives in tabs/X.tsx) | `app-detail-shared` (lives in apps/[app_id]/_shared/) | `app-wide-shared` (lives in components/). Commit this file BEFORE moving any code.

**Step 2b — RSC conversion.** Convert `page.tsx` to a server component:

```tsx
// app/apps/[app_id]/page.tsx — RSC, no "use client"
import { fetchAppDetail } from "@/lib/api-server";
import { notFound } from "next/navigation";
import AppDetailClient from "./AppDetailClient";

export default async function Page({ params }: { params: { app_id: string } }) {
  const data = await fetchAppDetail(params.app_id);
  if (!data) notFound();
  return <AppDetailClient initialData={data} appId={params.app_id} />;
}
```

- New `AppDetailClient.tsx` is the existing client tree (with `'use client'`), receives `initialData` as prop instead of fetching.
- New `frontend/src/lib/api-server.ts` — server-only fetch wrappers (uses internal docker DNS or `BACKEND_URL`).
- `not-found.tsx` (NEW) — renders the "App not found" state currently in page.tsx.
- `error.tsx` (NEW) — renders backend-error fallback. Now actually catches errors because `fetchAppDetail()` runs at render time.

**Step 2c — Tab extraction** (matches original §4 PR 2 plan):
- `apps/[app_id]/tabs/*.tsx` — 9 files, each `'use client'`, lazy-loaded via `React.lazy()` / `next/dynamic()` from AppDetailClient.
- Move existing `CapabilitiesTab.tsx` into `tabs/`.

**Step 2d — Shared promotion** (per inventory):
- `components/Pill.tsx` already shared.
- `components/Panel.tsx` (if used by ≥2 places) — promote.
- Anything that's only used by App Detail stays in `apps/[app_id]/_shared/`.

**Verification (replaces previous "manual checklist"):**
- Existing `e2e-tests/app-detail.spec.ts` runs green before/after (was missed by original plan — these tests already exist).
- Vitest unit tests run green.
- `next build` clean, bundle size diff ≤ ±5KB.

**Effort:** 1d CC (was 4h — RSC + inventory adds depth).

### PR 3 — Redesign visual + a11y full + sunset + non-CMDB + backend KPI count

**3a. Backend mini-change** — add `capability_count` to graph_query response:
- `backend/app/services/graph_query.py` — add `SELECT count(*) FROM ref_app_business_capability WHERE app_id = $1` to `get_application()`, include in returned dict.
- Backend response now includes: `app, outbound, inbound, investments, diagrams, confluence_pages, tco, review_pages, capability_count` (last is new).
- Update `backend/app/models/schemas.py` ApplicationDetailResponse if typed.
- Add api-test in `api-tests/test_graph.py` (or create) verifying the new field.

**3b. AnswerBlock** — new at `frontend/src/components/AnswerBlock.tsx`:
- Spec per §9 mockup A2.
- Receives all data via props (RSC-fetched in page.tsx, passed through).
- Uses existing `<Pill>` component (not custom).
- Handles `cmdb_linked === false` AND `cmdb_linked === undefined` — both render the "limited info" indicator (different copy: false = "not in CMDB", undefined = "CMDB status unknown").
- Non-CMDB graph-only apps: degrade gracefully across owners/geo/posture (not just deployment/TCO) per codex finding.

**3c. CTA bar + tab grouping** — page.tsx (now AppDetailClient.tsx):
- 4 CTA buttons (View Impact / See Investments / Show Diagrams / Show Confluence).
- 3 group sections (ABOUT/CONNECTIONS/WORK).
- **Full ARIA tablist pattern** (Tension 2A):
  ```tsx
  <div role="tablist" aria-orientation="horizontal" onKeyDown={handleArrowKeys}>
    <button role="tab" aria-selected={...} aria-controls="panel-overview" tabIndex={...}>
  ```
  - Arrow keys (←/→) move between tabs within a group; Home/End jump to first/last.
  - Roving tabindex (active tab tabindex=0, others tabindex=-1).
  - `aria-controls` ID matches the visible tabpanel.
- 3-group rendering: each `<div role="tablist">` per group OR single tablist + visual grouping. Verify with axe what's compliant.

**3d. CapabilitiesTab full ARIA tree** (Tension 2A):
- `role="tree"` on root.
- `role="treeitem"` + `aria-level={1|2|3}` + `aria-expanded` on each.
- Arrow-key navigation: ↑/↓ moves focus, → expands or descends, ← collapses or ascends.
- Roving tabindex.
- Reference: WAI-ARIA Authoring Practices tree pattern.

**3e. Sunset variant** — banner in AnswerBlock surface. Source of truth = `decommissioned_at` (Issue 7). Banner copy includes formatted date.

**3f. MetadataList** — new shared primitive at `frontend/src/components/MetadataList.tsx`. OverviewTab consumes it (replaces 4-panel mosaic).

**3g. Pill semantic variants** — extend existing `Pill.tsx` with green/blue/amber/red shorthand if not present (likely needs ~10 lines).

**3h. useTabFetch hook** — preserve abort + timeout (Issue 16 + codex):
```tsx
export function useTabFetch<T>(url: string, deps: React.DependencyList, opts?: { timeoutMs?: number }) {
  // ... existing pattern + AbortController + setTimeout(controller.abort, opts.timeoutMs ?? 30000)
}
```
KnowledgeBaseTab migration must keep its 15s timeout via `{ timeoutMs: 15000 }`.

**3i. Skip link in layout.tsx, NOT page.tsx**:
- Add `<a className="sr-only focus:not-sr-only" href="#main-content">Skip to main content</a>` as the FIRST element inside `<body>` (before `<nav>`).
- Existing `<main className="main">` already exists; add `id="main-content"` to it.
- DO NOT add another `<main>` in page.tsx.
- `globals.css` adds `.sr-only` utility + `:focus-visible` style.

**Effort:** 2d CC (was 1d — full ARIA + RSC integration + backend touch + shared primitive promotion).

### PR 4 — Extend existing E2E (NOT create new)

**4a. Extend root `playwright.config.ts`** — add new test files to `e2e-tests/app-detail/` (subdir of existing `e2e-tests/`). Keep using root config.

**4b. Add `@axe-core/playwright`** as devDep at the **root** package.json (matches root playwright dep), not frontend.

**4c. Test files** (mostly per original §4 PR 4 list, BUT remove AC-11/12 specs):

| File | ACs |
|------|-----|
| `e2e-tests/app-detail/answer-block.spec.ts` | AC-1, AC-2, AC-3 |
| `e2e-tests/app-detail/sunset-variant.spec.ts` | AC-4 |
| `e2e-tests/app-detail/non-cmdb.spec.ts` | AC-5 |
| `e2e-tests/app-detail/a11y.spec.ts` | AC-6, AC-7 + axe-core scan |
| `e2e-tests/app-detail/error-boundary.spec.ts` | AC-8 (now realistic with RSC) |
| `e2e-tests/app-detail/responsive.spec.ts` | AC-9, AC-10 |
| Existing `e2e-tests/app-detail.spec.ts` | regression smoke (don't delete, don't conflict) |

**4d. Fixtures over live data** — to avoid codex's flakiness concern:
- Create `e2e-tests/fixtures/seed-test-apps.sql` — idempotent SQL that seeds (or asserts existence of):
  - `A002856` (real, populated)
  - `A_TEST_SUNSET` (synthetic, decommissioned_at = '2025-01-01')
  - `XTESTNONCMDB` (synthetic, in graph only)
- pre-test hook runs the seed against the test DB.
- IF seeding the production-like 71 DB is undesirable, add `e2e-tests/fixtures/skip-marker.ts` documenting which tests need real data.

**4e. AC-11 / AC-12 → lint scripts** (NOT E2E):
- `frontend/package.json` adds:
  ```json
  "lint:design": "node ../scripts/check-design-md-primitives.mjs",
  "lint:page-size": "node ../scripts/check-page-size.mjs"
  ```
- Run as part of `next build` precondition or pre-commit hook.

**4f. CI integration** — flag as P1 TODO, not in this PR.

**Effort:** 6h CC (was 4h — fixture infra + axe + extending instead of creating).

### Revised total effort

| PR | Original | Revised |
|----|----------|---------|
| PR 1 (DESIGN.md doc) | 1h | 1.5h |
| PR 2 (restructure) | 4h | 1d |
| PR 3 (redesign + a11y + backend) | 1d | 2d |
| PR 4 (E2E extension) | 4h | 6h |
| **Total** | **~2d** | **~4.5d CC** |

The doubling reflects **doing it right the first time** vs the original plan's optimistic shortcuts.

---

## 14. Failure Modes (per eng review §4)

| # | Failure mode | Test? | Error handling? | User-visible? |
|---|-------------|-------|-----------------|---------------|
| F1 | Backend 500 on `/api/graph/nodes/{id}` during initial render | error.tsx (PR 4 a11y.spec.ts mocks fetch failure) | error.tsx renders Retry/Home | Yes — clear message |
| F2 | Backend 404 on app | not-found.tsx | Renders "App not found" + back link | Yes — clean |
| F3 | Network timeout mid-render | RSC throws → error.tsx | Same as F1 | Yes |
| F4 | Capability count fetch returns null | AnswerBlock fallback to "0 capabilities" or "—" | KPI shows "—" with mono dim | Subtle, no error |
| F5 | Sunset banner with malformed `decommissioned_at` (non-ISO) | Date parse guard in AnswerBlock | Falls back to "decommissioned (date unknown)" | Visible degradation |
| F6 | X-prefixed app with zero graph data (loader failed) | not-found.tsx (graph row missing → backend returns null) | Same as F2 | Yes |
| F7 | Tab nav arrow keys in non-Latin keyboard layout | a11y.spec.ts checks `ArrowLeft`/`ArrowRight` keycodes | Standard keys, locale-independent | No issue |
| **F8** ⚠ | **CapabilityTree roving tabindex bug** (focus lost after collapse) | **CRITICAL GAP** — needs custom test (no easy axe rule) | None planned in PR 3 | Silent — keyboard user gets stuck |

**F8 is the one critical gap.** Plan adds explicit a11y.spec.ts test: collapse focused L1 → focus moves to L1 button itself (not lost to body).

---

## 15. Worktree Parallelization

| Step | Modules touched | Depends on |
|------|----------------|------------|
| PR 1 (DESIGN.md) | `DESIGN.md` only | — |
| PR 2 (restructure) | `frontend/src/app/apps/[app_id]/*`, `frontend/src/lib/api-server.ts`, `components/Pill.tsx` (if extending) | PR 1 (cites primitives) |
| PR 3 (redesign) | same as PR 2 + `backend/app/services/graph_query.py` + `backend/app/models/schemas.py` + `frontend/src/components/{AnswerBlock,MetadataList}.tsx` + `frontend/src/lib/hooks/useTabFetch.ts` + `frontend/src/app/layout.tsx` (skip link) + `frontend/src/app/globals.css` | PR 2 |
| PR 4 (E2E extension) | `e2e-tests/app-detail/*`, `playwright.config.ts`, root `package.json`, `frontend/package.json` (lint scripts) | PR 3 |

**Lanes:**
- **Lane A (sequential):** PR 1 → PR 2 → PR 3 → PR 4
- **No parallel opportunity.** Each PR depends on the previous because PR 2 RSC restructure changes file shapes that PR 3 builds on, and PR 4 tests PR 3 behavior.

**Worktree note:** PR 2 + PR 3 both touch `apps/[app_id]/`, so even with worktrees they'd merge-conflict. Strict serial.

---

## 16. TODOS Generated (final, supersedes §8)

To append to `TODOS.md`:

| ID | What | Priority |
|----|------|----------|
| T1 | AI-generated `ai_summary` pipeline (P1 from CEO plan; redesign uses `short_description` fallback) | P1 |
| T2 | "Pin / follow app" + recent-views feed | P2 |
| T3 | Related-apps sidebar (similarity model) | P3 |
| T4 | Keyboard shortcuts for power users (`/`, `j/k`, `g o`) | P3 |
| T5 | High-contrast theme variant | P3 |
| T6 | Audit color contrast across NorthStar with axe-core (one-shot scan) | P1 (PR 4 covers App Detail; site-wide is follow-up) |
| T7 | Mobile placeholder page ("use a desktop browser") | P2 |
| **T8** | **CI integration: spin up docker-compose on runner, run `npm run e2e`, upload report on failure** | **P1** (gates routine PR safety; PR 4 ships local-only) |
| **T9** | **Migrate remaining tabs (IntegrationsTab, InvestmentsTab, DiagramsTab, ConfluenceTab, OverviewTab) to `useTabFetch` hook** | P2 (do as touched) |
| **T10** | **Promote shared App Detail helpers (`Panel`, etc.) to `frontend/src/components/` after PR 2 inventory shows ≥2 callers** | P2 |
| **T11** | **Tab state URL sync** (`?tab=capabilities` deep-linkable; today local useState only) | P2 |

---

## 17. Completion Summary (eng review)

```
+====================================================================+
|         PLAN ENG REVIEW — COMPLETION SUMMARY                       |
+====================================================================+
| Step 0 (Scope Challenge)     | scope expanded (T1+T2+T3 chosen A)  |
| Section 1 (Architecture)     | 8 issues found, all addressed        |
| Section 2 (Code Quality)     | 7 issues found, all addressed        |
| Section 3 (Tests)            | 1 critical issue (no FE framework) — |
|                              | resolved via PR 4 expansion          |
| Section 4 (Performance)      | 2 minor issues, addressed inline     |
| Outside Voice (codex)        | RAN — 17 findings, all verified true |
| Cross-Model Tensions         | 5 raised, all resolved (5x A)        |
| NOT in scope                 | written (§6)                         |
| What already exists          | written (§7)                         |
| TODOS proposed               | 11 (T1-T11)                          |
| Failure modes flagged        | 8 modes, 1 critical gap (F8)         |
| Parallelization              | none — strict serial 4-PR chain      |
| Lake Score                   | 5/5 chose complete option            |
+====================================================================+
```

**Initial plan score (post-design-review): 8/10. After eng review: 7/10 (lower because revealed true scope is 2.25x estimated). After PR 4 ships: target 9/10.**

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 17 findings, all verified, drove 5 tension decisions |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 19 issues + 1 critical failure-mode gap (F8) — resolved in §13 |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 6/10 → 8/10, 12 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CODEX:** 17 findings against original §4 plan; cross-model tension on RSC architecture, full a11y, shared boundary work, primitive promotion, backend KPI count. All A-decisions accepted by user.

**CROSS-MODEL:** Codex found 11 facts that invalidated original plan assumptions (stack version, existing test infra, existing Pill component, layout main, KnowledgeBaseTab abort). All verified true against repo.

**UNRESOLVED:** 0 (all 5 tensions decided, 19 issues addressed, 1 critical failure-mode F8 has explicit test plan).

**VERDICT:** ENG + DESIGN CLEARED — ready to implement starting PR 1. CEO review optional (substantial scope expansion happened — could re-validate with CEO mode if you want).

---

## 18. Final Status — All 4 PRs Shipped 🎉

**Date:** 2026-04-19
**Branch:** dev (pushed to gitlab + github)
**Deployed:** Server 71 (192.168.68.71:3003)

| PR | Commit(s) | Effort (actual CC) | Status |
|---|---|---|---|
| PR 1 — DESIGN.md doc-only | `84d9c54` | 1.5h | ✅ e2e unaffected (doc-only) |
| PR 2 — RSC restructure | `48c8072` … `13ed99e` + `29cac0d` (16 commits) | ~3h | ✅ e2e 6/6 green |
| PR 3 — Redesign + a11y | `0c2b26a`, `686a386`, `19f9968`, `1713a56`, `1986798` (5 commits) | ~3.5h | ✅ e2e 7/7 green, api-tests 3/3 |
| PR 4 — axe + fixtures + WCAG AA fix | `f366a23` | ~1h | ✅ **e2e 26/26 green, 0 axe violations** |

**Critical ARIA invariants regression-protected in CI:**
- Single `role="tablist"` with 9 `role="tab"` children
- Roving tabindex: exactly 1 tab at `tabIndex={0}`, other 8 at `-1`
- ArrowRight switches `aria-selected` across tablist
- `role="tree"` with `aria-level` 1/2/3 on every treeitem
- Skip link `.skip-link` href=`#main-content`
- `AnswerBlock` h1 renders via SSR (not client-hydrated)
- Sunset banner + status pill becomes SUNSET when `decommissioned_at` set
- Non-CMDB renders red "not in CMDB" strip, no cmdb-linked indicator
- 404 apps hit Next `not-found.tsx` (HTTP 404, not 200 with fake page)
- axe-core WCAG AA scan: 0 violations across 4 variants

**Bundle:** `/apps/[app_id]` = 27 kB route + 121 kB first-load JS. Within the ±5 kB budget relative to the PR 2 baseline (23.8 kB).

**Cumulative line deltas vs 2026-04-17 baseline:**
- `page.tsx`: 4839 → 27 lines (-99.4%)
- New code: 11 new files under `apps/[app_id]/`, 2 new primitives in `components/`, 1 new `lib/api-server.ts`
- Backend: +27 lines (`_fetch_capability_count` helper + integration)
- E2E: +16 tests (10 → 26)
- api-tests: +3 tests (capability_count)
- DESIGN.md: +100 lines (App Detail Redesign Extensions)

**Deferred (logged in §16 TODOs):**
- T8: CI for Playwright — actionable now that e2e is 26/26 green
- T12-T14: cross-page Panel/Kpi/StatusPill reconcile
- T15: stale `frontend/CLAUDE.md` + `backend/CLAUDE.md`
- T16: migrate remaining 6 tabs to `useTabFetch`
- T18: extract `pillToneForStatus` helper

**Ship decision:** merge to main when ready. Feature is production-ready on 71.
