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

## 4. Scope (3 sequential PRs)

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
- 1280 — panels collapse from 4 cols → 3 cols
- 1024 — panels collapse from 3 cols → 2 cols, tab nav scrolls horizontally

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

**Affected files:**
- `frontend/src/app/apps/[app_id]/page.tsx` — strip tab bodies
- `frontend/src/app/apps/[app_id]/tabs/*.tsx` — 9 new files
- `frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx` — moves to `tabs/CapabilitiesTab.tsx`
- Imports adjust accordingly.

### PR 3 — Redesign (the actual UX changes)

Layered against PR 1 + PR 2.

**1. Add `AnswerBlock.tsx`** above the tab nav. Renders:
- Title row: `app_id` (mono, dim) + `name` (h1, 28px Space Grotesk 600) + status pills inline + activity timestamp right-aligned ("Updated 4h ago by sync_from_egm")
- Purpose line: `short_description` truncated to first sentence; falls back to "(no description)"
- KPI anchor row: 3 numbers in 38px Space Grotesk 600 tabular-nums. Format: `**24** integrations · **7** capabilities · **6** investments`
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

**6. Non-CMDB X-prefixed apps** (`app.cmdb_linked === false`):
- Don't 404. Render the page with available graph data.
- AnswerBlock notes "Found in graph data, not in CMDB. Limited info."
- Tabs that need CMDB data (Deployment, TCO panel) show empty state with "Requires CMDB linkage."

**7. Page-level error boundary** wraps `<main>`. Renders "NorthStar can't load this app right now. [Retry] [Back to home]" on any unhandled exception below.

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

**Affected files:**
- `frontend/src/app/apps/[app_id]/page.tsx` — layout rewrite, tab grouping, AnswerBlock + CTA bar mount
- `frontend/src/app/apps/[app_id]/AnswerBlock.tsx` — NEW
- `frontend/src/app/apps/[app_id]/tabs/OverviewTab.tsx` — replace 4-panel grid with MetadataList
- `frontend/src/app/apps/[app_id]/tabs/CapabilitiesTab.tsx` — back-port: aria-tree
- `frontend/src/app/globals.css` — focus-visible style, sr-only utility class
- `frontend/src/components/ErrorBoundary.tsx` — NEW (page-level)
- (no backend changes — all data already exposed)

---

## 5. Acceptance Criteria

| ID | Given / When / Then |
|----|---------------------|
| AC-1 | **Given** a populated app like A002856, **When** the App Detail page loads, **Then** the AnswerBlock shows name + 1-sentence purpose + 3 KPI numbers + last-change row above the tab nav. |
| AC-2 | **Given** an app with no `short_description`, **When** the page loads, **Then** AnswerBlock shows "(no description)" — does not error or hide the field. |
| AC-3 | **Given** an unmapped app like A003000 (no BCs, no integrations beyond a couple), **When** opened, **Then** the KPI anchor shows "0 integrations · 0 capabilities · 0 investments" using the same KPI typography (no missing-data fallback). |
| AC-4 | **Given** a sunset app (`decommissioned_at` not null), **When** the page loads, **Then** the page-top sunset banner appears in red, the status pill is red SUNSET, and the rest of the page renders normally. |
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
  - Labels: Mono 10px `var(--text-dim)` uppercase, 0.8px tracking
  - Values: Geist 13px `var(--text)`
  - Fields in order (Pass 7 D5 A): Identity → Ownership → Posture → Geo → TCO → System metadata

- **CTA bar** (1 primary, 3 ghost):
  - Primary: `View Impact` — amber bg (`var(--accent)`), dark text (`#1a1306`), mono 12px weight 600
  - Ghost (3): transparent bg, 1px `var(--border-strong)` border, mono 12px weight 500, `var(--text)` text
  - Hover: ghost → border brightens to `var(--text-muted)`; primary → bg lightens 12%
  - Spacing: 10px gap between buttons, 26px margin below

- **Tab navigation (3 groups)**:
  - Group labels: Mono 10px `var(--text-dim)` uppercase, 1.6px tracking, 8px below → tab row
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
