# App Detail — Refactor Inventory (PR 2 Step 2a)

> **Generated:** 2026-04-19 as the gate document before any code moves in PR 2.
> **Source:** `frontend/src/app/apps/[app_id]/page.tsx` @ commit `84d9c54` (4839 lines).
> **Plan reference:** `.specify/features/app-detail-redesign/plan.md` §13 PR 2.
>
> **Rule:** Nothing in this directory moves until this file lands as its own commit. Once landed, every move follows the disposition column. If a move needs to deviate, update this file in the same commit.

## Stack reality check (verified before inventory)

- **Next.js 14.2.18 + React 18.3.1** (NOT 15/19 as `frontend/CLAUDE.md` claims, that doc is stale and will be fixed in PR 3 cleanup).
- React 18 has Suspense + `lazy()`, no `use()` hook for promises. Plan PR 2 step 2b RSC conversion works fine on Next 14 App Router.
- `frontend/CLAUDE.md` also says "No E2E tests yet" — also stale. `e2e-tests/app-detail.spec.ts` (57 lines, 6 tests) exists at repo root and will be the verification target.

## Disposition legend

| Tag | Destination | Meaning |
|---|---|---|
| `kept-in-page` | `apps/[app_id]/page.tsx` (post-RSC) or `AppDetailClient.tsx` | Stays in the orchestrator. Title row, tab nav, conditional render, top-level fetches. |
| `tab-local-X` | `apps/[app_id]/tabs/X.tsx` | Moves into the tab file. Only that tab uses it. |
| `app-detail-shared` | `apps/[app_id]/_shared/<File>.tsx` | Used by ≥2 tabs OR by tab + page wrapper. NorthStar-internal-to-this-page. |
| `app-wide-shared` | `frontend/src/components/<File>.tsx` | Used by ≥2 pages outside App Detail. Promoted in PR 2 step 2d. |
| `defer` | unchanged | Reconciliation requires cross-page visual diff. Out of PR 2 scope. Logged as TODO. |

---

## Top-level orchestrator (lines 1-395)

| Item | Line | Disposition | Notes |
|---|---|---|---|
| `interface AppNode` and 13 sibling interfaces | 13-165 | `app-detail-shared/types.ts` | Move all interfaces (`AppNode`, `OutboundEdge`, `InboundEdge`, `MajorApp`, `Investment`, `DiagramRef`, `ConfluencePageRef`, `TcoData`, `ReviewPage`, `AppDetailResponse`, `ImpactApp`, `ImpactBucket`, `BusinessObjectAgg`, `ImpactResponse`) into one types module. Tabs import what they need. **`AppDetailResponse` MUST also be exported from `lib/api-server.ts`** (PR 2 step 2b). |
| `type Tab = "overview"\|"capabilities"\|...` | 167 | `app-detail-shared/types.ts` | Single source of truth for tab IDs. |
| `const STATUS_COLORS` | 169-176 | `app-detail-shared/StatusPill.tsx` (co-located with consumer) | Only `StatusPill` reads it. Defer cross-page reconciliation. |
| `export default function AppDetailPage` | 178-395 | **SPLIT — RSC + client** | Per plan §13 PR 2 step 2b: thin RSC `page.tsx` (10 lines) calls `fetchAppDetail()` server-side, passes `initialData` into new `AppDetailClient.tsx` which holds all client state (tab + capCount + deployCount + tab nav + conditional render). Removes `useEffect` for the main fetch; keeps `useEffect` for capCount + deployCount. |
| 3× `useEffect` fetches inside `AppDetailPage` | 189-250 | mixed | (a) Main `fetch /api/graph/nodes/{id}` (224-250) → **deleted** (replaced by `fetchAppDetail()` server-side via Next 14 RSC). (b) capCount fetch (202-222) → stays in `AppDetailClient.tsx`. (c) deployCount fetch (189-200) → stays in `AppDetailClient.tsx`. Both (b) and (c) keep their existing `cancelled` flag pattern. |
| `LoadingState` | 3965-3972 | **deleted** | Replaced by RSC's natural "no loading state for the main page payload" — the server renders with data. The two non-blocking secondary fetches (cap, deploy) still gracefully handle their loading. |
| `NotFoundState` | 3973-4015 | `apps/[app_id]/not-found.tsx` (NEW) | Move JSX into a Next 14 `not-found.tsx` so `notFound()` from `next/navigation` triggers it natively. **`error.tsx` (NEW)** also created — captures 500/network errors from `fetchAppDetail()`. |

---

## Tab modules (one file per tab in `tabs/`)

Each tab file gets `'use client'` and its own helpers/types/constants beside it. `AppDetailClient.tsx` lazy-loads via `next/dynamic` so the bundle splits per tab.

### `tabs/OverviewTab.tsx` — `tab-local-overview`

| Item | Line | Notes |
|---|---|---|
| `OverviewTab` | 841-1017 | Main component. Receives `app`, `investments`, `confluencePages`, `tco` as props (already does). |
| `EaStandardsPanel` | 1035-1098 | Only Overview consumes; co-locate. |
| `EaDocRef` interface | 1018-1026 | Co-locate with EaStandardsPanel. |
| `EA_DOMAIN_LABELS`, `EA_TYPE_LABELS` | 1027-1034 | Co-locate with EaStandardsPanel. |
| `LifeCycleChangePanel` | 1144-1285 | Only Overview consumes; co-locate. |
| `LifecycleRow` | 1286-1384 | Helper for above; co-locate. |
| `LifecycleEntry` interface | 1132-1140 | Co-locate. |
| `LIFECYCLE_INITIAL_LIMIT`, `LIFECYCLE_COLLAPSE_THRESHOLD` | 1141-1142 | Co-locate. |
| `yearOfGoLive()` | 1385-1396 | Co-locate. |

### `tabs/CapabilitiesTab.tsx` — `tab-local-capabilities`

Already extracted in earlier work at `apps/[app_id]/CapabilitiesTab.tsx` (431 lines). **Move to `tabs/CapabilitiesTab.tsx`** (file rename only). No code change in PR 2.

### `tabs/IntegrationsTab.tsx` — `tab-local-integrations`

The largest tab. ~1900 lines total when all helpers come along.

| Item | Line | Notes |
|---|---|---|
| `IntegrationsTab` | 1520-1759 | Main component. |
| `SectionHeader`, `ViewModeToggle` | 1760-1851 | UI helpers, only used here. |
| `ProviderHotspots`, `ProviderFlatList` | 1852-2122 | Only used here. |
| Landscape diagram (`buildLandscapeData`, `IntegrationLandscape`, `MorePlaceholderBox`, `scrollToPeerInterface`, `LandscapeAppBox`, `LandscapePlatformBox`, `wrapAppName`, `LandscapeMeBox`) | 2127-3128 | The full SVG landscape. Only used here. |
| `ProviderPlatformBlock`, `ProviderInterfaceCard`, `ConsumerPlatformBlock`, `ConsumerRowCard` | 3129-3493 | Card variants, only used here. |
| `IntegrationStatusPill`, `integrationStatusColor` | 1493-1519 | Status helper specific to integrations. |
| `PLATFORM_COLORS` | 1480-1492 | Constant. |
| `MAX_APPS_PER_SIDE`, `MAX_STROKE_WIDTH`, `MIN_STROKE_WIDTH` | 2123-2125 | Constants. |
| `ConsumerEntry`, `ProviderInterface`, `ConsumerRow`, `IntegrationPayload`, `LandscapeAppNode` interfaces | 1398-2141 | Co-locate. |

**Recommendation:** if `IntegrationsTab.tsx` exceeds ~2000 lines after the move, file-split inside `tabs/integrations/` is allowed (`IntegrationsTab.tsx` + `landscape.tsx` + `cards.tsx`). Decide after the mechanical move; do not pre-optimize.

### `tabs/DeploymentTab.tsx` — `tab-local-deployment`

| Item | Line | Notes |
|---|---|---|
| `DeploymentTab` | 4404-4745 | Main. |
| `DeployKpi`, `EnvBadge`, `ZoneBadge`, `DeployStatusPill` | 4746-4838 | Co-locate. |
| `DeploymentData` | 4372-4382 | Interface, co-locate. |
| `CITY_LABELS`, `cityLabel`, `ZONE_COLORS` | 4383-4801 | Constants/helpers. |

### `tabs/ImpactTab.tsx` — `tab-local-impact`

| Item | Line | Notes |
|---|---|---|
| `ImpactTab` | 398-601 | Main. |
| `DistanceBucket` | 602-677 | Co-locate. |
| `BOBar` | 678-717 | Co-locate. |
| `ImpactApp`, `ImpactBucket`, `BusinessObjectAgg`, `ImpactResponse` | 138-165 | **Imported from `_shared/types.ts`** since they overlap conceptually with the AppDetailResponse family. |

### `tabs/InvestmentsTab.tsx` — `tab-local-investments`

| Item | Line | Notes |
|---|---|---|
| `InvestmentsTab` | 3494-3637 | Standalone, no helpers. |
| Uses `Investment` type from `_shared/types.ts`. |

### `tabs/DiagramsTab.tsx` — `tab-local-diagrams`

| Item | Line | Notes |
|---|---|---|
| `DiagramsTab` | 3638-3766 | Main. |
| `DiagramCard` | 3767-3910 | Co-locate. |
| `DiagramList` | 3911-3964 | Co-locate. |

### `tabs/ConfluenceTab.tsx` — `tab-local-confluence`

| Item | Line | Notes |
|---|---|---|
| `ConfluenceTab` | 4017-4066 | Standalone. |

### `tabs/KnowledgeBaseTab.tsx` — `tab-local-knowledge`

| Item | Line | Notes |
|---|---|---|
| `KnowledgeBaseTab` | 4089-4371 | Standalone. **Has 15s timeout via `AbortController`** that MUST be preserved during the move (per plan PR 3 §3h `useTabFetch` introduction; PR 2 leaves the existing inline `AbortController` untouched). |
| `KBPage`, `KBSpace`, `KBResponse` | 4067-4088 | Co-locate. |

---

## App-Detail-shared primitives → `apps/[app_id]/_shared/`

These are used by ≥2 tabs OR by the page wrapper + a tab. Move to `_shared/` rather than `components/` because no other page consumes them today (per plan §13 PR 2 step 2d: "Anything that's only used by App Detail stays in `apps/[app_id]/_shared/`").

| Item | Source line | Destination | Used by |
|---|---|---|---|
| `Panel` | 809-835 | `_shared/Panel.tsx` | OverviewTab, ImpactTab, also page header indirectly. **3 independent `Panel` definitions exist** elsewhere (`app/page.tsx:527`, `dashboard/page.tsx`) — those are NOT touched in PR 2. Promoting to `components/Panel.tsx` = `defer` (separate cleanup, requires visual diff across pages). |
| `EmptyState` | 836-840 | `_shared/EmptyState.tsx` | Multiple tabs. |
| `Kpi` | 1099-1131 | `_shared/Kpi.tsx` | ImpactTab + OverviewTab indirectly. **Dashboard has its own** at `dashboard/page.tsx:234`, `defer`. |
| `StatusPill` | 765-769 | `_shared/StatusPill.tsx` | Title row + CmdbField + others. **`admin/confluence/.../ExtractedView.tsx:58` exports its own `StatusPill`**, `defer`. |
| `CmdbField` | 770-808 | `_shared/CmdbField.tsx` | Only OverviewTab consumes today; could go `tab-local-overview`. **Decision: `_shared/`** because PR 3 will likely use it in MetadataList rendering, and moving twice is wasteful. |
| `TabButton` | 718-764 | `_shared/TabButton.tsx` | Only `AppDetailClient.tsx` consumes (the orchestrator). **Decision: `_shared/`** for clarity (every tab system on every entity detail page will use this same component going forward). |
| `interface ...Response`, `type Tab`, status constants | 13-176 | `_shared/types.ts` | All tab modules import. |

---

## App-wide-shared promotions in PR 2

| Item | Status |
|---|---|
| `frontend/src/components/Pill.tsx` | Already shared. PR 3 extends with `tone="green\|blue\|amber\|red\|gray"` shorthand. **No change in PR 2.** |
| `frontend/src/components/DeploymentMap.tsx` | Already shared. **No change.** |
| Other `components/*` (CommandPalette, NavLinks, Pager, StarMark) | **No change in PR 2.** |

**Net app-wide promotions in PR 2: zero.** Plan §13 PR 2 step 2d allowed `Panel` promotion if used by ≥2 places. Three independent local `Panel` definitions exist across the app; the right move is to flag for separate reconciliation rather than guess at one canonical look. Logged as TODO below.

---

## RSC conversion (PR 2 step 2b) — file plan

| File | Action | Rough line count |
|---|---|---|
| `frontend/src/lib/api-server.ts` | **NEW** | ~40. Server-only fetch wrapper. Resolves URL via `process.env.BACKEND_URL || "http://backend:8001"` (docker internal) with fallback. Exports `fetchAppDetail(appId): Promise<AppDetailResponse \| null>` — returns `null` on 404, throws on other errors. |
| `frontend/src/app/apps/[app_id]/page.tsx` | **REWRITE** | ~15. Server component. `import { fetchAppDetail } from "@/lib/api-server"; import { notFound } from "next/navigation"; import AppDetailClient from "./AppDetailClient";` — calls `fetchAppDetail()`, `notFound()` on null, renders `<AppDetailClient initialData={data} appId={params.app_id} />`. |
| `frontend/src/app/apps/[app_id]/AppDetailClient.tsx` | **NEW** | ~200. `'use client'`. Receives `initialData` prop, holds `tab`/`capCount`/`deployCount` state, renders title row + tab nav + lazy-imports tab modules with `next/dynamic`. |
| `frontend/src/app/apps/[app_id]/not-found.tsx` | **NEW** | ~50. Move existing `NotFoundState` JSX. |
| `frontend/src/app/apps/[app_id]/error.tsx` | **NEW** | ~30. Catches `fetchAppDetail()` failures. Per Next 14 convention, must be a client component. |

---

## Verification (PR 2 Step Verify)

Per plan §13 PR 2:

1. **Existing `e2e-tests/app-detail.spec.ts` runs green before AND after.** 6 tests, all hitting `/apps/A000394`. They use loose selectors (`page.locator("button, [role=tab]", { hasText: /Integrations/ })`) so file moves alone shouldn't break them — RSC + lazy might shift timing, fixable with `page.waitForLoadState("networkidle")`.
2. **No vitest unit tests exist** for App Detail today (verified via `frontend/vitest.config.ts` exists, but no `.test.tsx` matching App Detail). Vitest scope: run existing suite, must stay green. No new tests added in PR 2 (PR 3+ adds them).
3. **`next build` clean** inside the docker container — zero new TS errors.
4. **Bundle diff ≤ ±5KB** per route. Lazy-loading tabs SHOULD reduce initial route bundle (tabs only ship when clicked); compare `next build` output before/after.

Manual visual check on 71 (server-side rendering means SSR HTML now includes the AnswerBlock content — should be visible immediately on page load, no client hydration flash):

- `/apps/A002856` (OLMS, full data, all 9 tabs populated)
- `/apps/A000394` (LBP, the e2e test target)
- `/apps/A999999` (404 — should hit `not-found.tsx`)
- `/apps/X9f8a1d2c3b4` (X-prefixed non-CMDB graph-only — should render with `cmdb_linked === false` via the existing `graph_query.py:121-123` partial dict path)

---

## Out of scope for PR 2 (TODOs to log)

These deviations from a strict reading of plan §13 PR 2 are deliberate and logged forward:

1. **Cross-page `Panel` reconciliation** (3 independent definitions in `apps/[app_id]/page.tsx:809`, `app/page.tsx:527`, `dashboard/page.tsx`): defer. Add to plan §16 as **T12: "Reconcile 3 Panel definitions; pick canonical, visual-diff dashboard + home before merging"**.
2. **Cross-page `Kpi` reconciliation** (`apps/[app_id]/page.tsx:1099` vs `dashboard/page.tsx:234`): defer. **T13.**
3. **Cross-page `StatusPill` reconciliation** (`apps/[app_id]/page.tsx:765` vs `admin/confluence/.../ExtractedView.tsx:58`): defer. **T14.**
4. **Stale `frontend/CLAUDE.md` claims** ("Next 15", "React 19", "No E2E tests yet"): fix in PR 3 cleanup commit (1-line scope, but not in PR 2's "zero behavior change" charter). **T15.**
5. **`useTabFetch` hook with abort + timeout** (plan §13 PR 3 §3h): scoped to PR 3. PR 2 preserves the existing inline `AbortController` patterns in `KnowledgeBaseTab` (15s timeout) verbatim during file moves.

---

## Order of operations for PR 2

1. ✅ Land THIS file as commit 1.
2. Commit 2: scaffolding only — create `_shared/types.ts` (move all interfaces + `Tab` type), `_shared/` empty stub directories. Page.tsx now imports types from `_shared/types.ts`. Verify `next build` passes.
3. Commit 3: move `Panel`, `EmptyState`, `Kpi`, `StatusPill`, `CmdbField`, `TabButton` into `_shared/*.tsx`. Page.tsx imports them. Verify `next build`.
4. Commits 4-12 (one per tab, mechanical): move each tab block into `tabs/<X>Tab.tsx` with its co-located helpers. Update page.tsx imports. Verify `next build` after each.
5. Commit 13: rename `apps/[app_id]/CapabilitiesTab.tsx` → `apps/[app_id]/tabs/CapabilitiesTab.tsx`. Update import in page.tsx. Verify.
6. Commit 14: RSC conversion — create `lib/api-server.ts`, split page.tsx into `page.tsx` (RSC, ~15 lines) + `AppDetailClient.tsx` (~200 lines). Add `not-found.tsx` + `error.tsx`. Switch tab imports to `next/dynamic` for code-splitting. Verify e2e + `next build` + bundle diff.
7. Commit 15: push to gitlab + github, request review, run e2e on 71.

Each commit is mechanically reviewable. Any visual regression after commits 2-13 is impossible by construction (only file moves + import updates). Visual regression risk concentrates in commit 14 (RSC = SSR changes the initial paint).

---

## Acknowledgements

- **Codex outside voice + eng review** (recorded in plan §12) drove the corrections that landed in plan §13: drop StatusPill primitive (Pill exists), inventory before code moves, defer cross-page reconciliation, preserve AbortController patterns.
- The `_shared/` directory pattern keeps "one move at a time" reviewable while leaving the door open to lift things to `components/` later when sibling pages (`/projects/[id]`, `/capabilities/[id]`) need them.
