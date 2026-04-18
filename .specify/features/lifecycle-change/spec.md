# Life Cycle Change Timeline

| Field   | Value        |
|---------|--------------|
| Author  | Ruodong Yang |
| Date    | 2026-04-18   |
| Status  | Draft        |

---

## 1. Context

The App Detail Page (`/apps/[app_id]`) Overview tab currently ends with a three-KPI "At a glance" panel (Investments / Diagrams / Conf. pages). The three numbers overlap with the tab badges already shown at the top of the page, so the panel has near-zero architect-workbench value.

This feature replaces that panel with a **Life Cycle Change** timeline: a vertical list of every project where this application is marked **Change**, **New**, or **Sunset** (i.e. the project is actively modifying / creating / retiring this app — what we already call a "major app" for the project). Each entry shows the project go-live date, fiscal year, lifecycle status pill, project name/link, and the free-text change description captured in the drawio cell.

Strategic fit: architects opening an app ask "what's currently happening to this app, and when" — the existing Investments tab lists projects but is sorted by fiscal year with no date axis and no change description. Life Cycle Change answers the time-ordered "what's changing" question on the Overview page without the architect needing to switch tabs.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Reuse `application_status IN ('Change','New','Sunset')` as the "primary app" signal** | Already the definition of "major app" in `graph_query._fetch_major_apps_by_projects`. Introducing a separate "primary app" concept would fragment the ontology. |
| **Query Postgres relational tables, not the graph** | Per ontology invariant #5 in CLAUDE.md: searchable/primary app surface is PG, not AGE. All needed columns (`confluence_diagram_app.application_status`, `confluence_diagram_app.functions`, `ref_project.go_live_date`) already live in `northstar.*`. |
| **Endpoint scoped per-app, not per-project** | Symmetric with existing `/api/masters/applications/{app_id}/deployment` and `/integrations`. |
| **Sort by `go_live_date DESC NULLS LAST`** | Architect wants "what's next" first. Undated entries (e.g. FY-only placeholder projects) fall to the bottom — visible but de-emphasized. |
| **One row per (project, status)**, not per diagram | An app can appear in N diagrams under the same project with the same Change/New/Sunset status — dedupe at the API layer so the timeline doesn't show five identical entries. Merge `functions` text via `string_agg DISTINCT`. |
| **No schema changes** | All data already exists. This is a pure read-path feature. |

---

## 2. Functional Requirements

### 2.1 Backend endpoint

| ID | Requirement |
|----|-------------|
| FR-1 | The backend MUST expose `GET /api/masters/applications/{app_id}/lifecycle` returning `ApiResponse<LifecycleResponse>`. |
| FR-2 | The response MUST contain one entry per distinct `(project_id, application_status)` tuple where the application appears in the project's drawio with status `Change`, `New`, or `Sunset`. |
| FR-3 | Each entry MUST include: `project_id`, `project_name`, `go_live_date` (string, nullable), `fiscal_year`, `status` (one of `Change`/`New`/`Sunset`), `change_description` (string, nullable — merged `functions` text). |
| FR-4 | Entries MUST be sorted by `go_live_date` descending, treating NULL/empty as the lowest (last) value. Tiebreaker: `project_id` ascending. |
| FR-5 | The endpoint MUST return `{"success": true, "data": {"app_id": ..., "entries": []}}` when the app has no lifecycle changes. It MUST NOT return 404 for a valid app_id with zero entries. |
| FR-6 | The endpoint MUST return 404 only when the `app_id` does not exist in `northstar.ref_application`. |

### 2.2 Frontend panel

| ID | Requirement |
|----|-------------|
| FR-7 | `OverviewTab` MUST replace the existing "At a glance" Panel with a "Life cycle change" Panel spanning the full grid row (`grid-column: 1 / -1`). |
| FR-8 | The panel MUST render a vertical timeline with one item per entry. Each item MUST show, in this order: lifecycle status pill, go-live date (or "No go-live date"), fiscal year badge, project name (link to `/projects/{project_id}`), project_id (mono, muted), and change description. |
| FR-9 | Status pills MUST be color-coded: `Change` → `--status-change`, `New` → `--status-new`, `Sunset` → `--status-sunset`. Reuses existing `STATUS_COLORS` map from the App Detail page. |
| FR-10 | Entries MUST be visually grouped by go-live date **year** with a small section header (`2026`, `2025`, ...) in `--text-dim`. Undated entries MUST fall into a trailing "Unscheduled" group. |
| FR-11 | Missing change description MUST render as the muted placeholder text `No explicit change notes captured.` (not empty, not hidden — the architect needs to see that the cell is intentional). |
| FR-12 | When the entries list is empty, the panel MUST render an `EmptyState` with the text `This application has no project-driven life-cycle changes on record.` |
| FR-13 | When there are more than 10 entries, the panel MUST initially show only the first 6 and render a `Show all N changes` toggle. The toggle MUST be a text button in the accent color. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | The API response MUST use the `ApiResponse<T>` envelope. |
| NFR-2 | The SQL query MUST run in under 200 ms P95 for any single app on the production 71 dataset (~3400 drawios, ~13k apps). The existing similar join pattern in `_fetch_investments_from_pg` is the baseline. |
| NFR-3 | Response MUST be snake_case. No camelCase mapping. |
| NFR-4 | The endpoint MUST NOT write to any table. Read-only. |
| NFR-5 | No auth. Matches the rest of the masters router. |
| NFR-6 | Frontend component MUST be inline-styled per DESIGN.md — no UI library, no new CSS modules. |

---

## 4. Acceptance Criteria

| ID | Given / When / Then | Ref |
|----|---------------------|-----|
| AC-1 | **Given** app `A000298` (Sales Portal) is marked `Change` in 3 projects with go-live dates 2026-05-11, 2026-03-31, 2026-01-31, **When** the frontend fetches the lifecycle endpoint, **Then** exactly 3 entries are returned in that date order. | FR-2, FR-4 |
| AC-2 | **Given** app `A000298` is marked `Change` in project `LI2500228` in 4 different diagrams, **When** the endpoint is queried, **Then** a single entry is returned for that project with `functions` strings joined (deduped). | FR-2 |
| AC-3 | **Given** app `A000301` has no Change/New/Sunset entries, **When** the endpoint is queried, **Then** the response is 200 with `entries: []` (not 404). | FR-5 |
| AC-4 | **Given** an app is marked `New` in project `FY2526-244` which has no `go_live_date`, **When** the endpoint is queried, **Then** the entry is returned with `go_live_date: null` and sorted last. | FR-4 |
| AC-5 | **Given** `app_id=Z999999` does not exist in `ref_application`, **When** the endpoint is queried, **Then** HTTP 404 is returned. | FR-6 |
| AC-6 | **Given** an app with 15 lifecycle entries, **When** the Overview tab renders, **Then** only the first 6 entries are shown plus a `Show all 15 changes` toggle; clicking the toggle reveals the rest. | FR-13 |
| AC-7 | **Given** the `Change` status is present, **When** rendered, **Then** the pill uses `var(--status-change)` (not `var(--success)` or `var(--accent)`). | FR-9 |

---

## 5. Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-1 | App marked both `Change` and `Sunset` in the same project (two diagrams, different status) | Return 2 entries for that project, one per status. Same `project_id`, `project_name`, `go_live_date`. |
| EC-2 | Project exists in `confluence_page` but not in `ref_project` (MSPO hasn't synced it) | Return entry with `project_name: null`, `go_live_date: null`. Frontend renders project_id as the label. |
| EC-3 | `go_live_date` is a non-ISO string (e.g. `"Q2 FY26"`) | Return as-is. Frontend displays the raw string. Year-grouping falls back to "Unscheduled". |
| EC-4 | `confluence_diagram_app.functions` is NULL vs empty string vs whitespace | Treat all three as "no description". Frontend shows the placeholder. |
| EC-5 | Same project, same status, different `fiscal_year` across diagrams | Pick the MAX fiscal_year (lexicographic — `FY2526 > FY2425`). One row per (project, status). |
| EC-6 | App is marked `Keep` in every project | `entries: []`. `Keep` is not a lifecycle change. |
| EC-7 | Project has 100+ drawios referencing this app, each with a different `functions` note | `string_agg(DISTINCT ...)` deduplicates; truncate display at ~500 chars on the frontend with a `Read more` toggle (same pattern as existing long descriptions). |
| EC-8 | `app_id` contains special URL characters (non-CMDB hash ID with `+/=`) | Router accepts via `{app_id}` path param; frontend already uses `encodeURIComponent`. |

---

## 6. API Contracts

### `GET /api/masters/applications/{app_id}/lifecycle`

**Path params:** `app_id` (string, required)

**Response 200:**
```json
{
  "success": true,
  "data": {
    "app_id": "A000298",
    "entries": [
      {
        "project_id": "LI2500058",
        "project_name": "KSA Oasis DTIT Project",
        "go_live_date": "2026-05-11",
        "fiscal_year": "FY2526",
        "status": "Change",
        "change_description": null
      },
      {
        "project_id": "LI2500228",
        "project_name": "Automation Enablement",
        "go_live_date": "2026-03-31",
        "fiscal_year": "FY2526",
        "status": "Change",
        "change_description": "App owner, AD Login, Line Manager, Applications UAR Cycle Maintenance, UAR Permission"
      }
    ]
  },
  "error": null
}
```

**Response 404:** app not found in `ref_application`.

---

## 7. Data Models

No new tables. Reads from:

| Table | Columns used |
|-------|--------------|
| `northstar.ref_application` | `app_id` (existence check only) |
| `northstar.ref_project` | `project_id`, `project_name`, `go_live_date`, `status` |
| `northstar.confluence_page` | `page_id`, `project_id`, `fiscal_year` |
| `northstar.confluence_attachment` | `attachment_id`, `page_id` |
| `northstar.confluence_diagram_app` | `attachment_id`, `resolved_app_id`, `standard_id`, `application_status`, `functions` |

Join pattern mirrors `graph_query._fetch_investments_from_pg` (already in prod).

---

## 8. Affected Files

### Backend
- `backend/app/routers/masters.py` — add `GET /applications/{app_id}/lifecycle` handler (new ~40 LOC query + response wrap)

### Frontend
- `frontend/src/app/apps/[app_id]/page.tsx` — replace `<Panel title="At a glance">` with new `LifeCycleChangePanel` component + `LifecycleEntry` type + fetch effect

### Database
- None

### Scripts
- None

---

## 9. Test Coverage

### API Tests
| Test File | Covers |
|-----------|--------|
| `api-tests/test_lifecycle.py::test_lifecycle_returns_dated_entries_sorted` | AC-1, AC-4 |
| `api-tests/test_lifecycle.py::test_lifecycle_dedupes_per_project` | AC-2 |
| `api-tests/test_lifecycle.py::test_lifecycle_empty_entries_not_404` | AC-3 |
| `api-tests/test_lifecycle.py::test_lifecycle_404_on_unknown_app` | AC-5 |
| `api-tests/test_lifecycle.py::test_lifecycle_excludes_keep_status` | EC-6 |

### E2E Tests
Not in scope (no Playwright suite yet — manual UI verification on 71).

---

## 10. Cross-Feature Dependencies

### This feature depends on:

| Feature | Dependency Type | Details |
|---------|----------------|---------|
| `confluence-major-apps` | Data | Relies on `confluence_diagram_app.application_status` + `functions` being populated by the Confluence extractor. |
| `confluence-root-project-id` | Data | Relies on `confluence_page.project_id` being resolved; otherwise entries drop out of the join. |

### Features that depend on this:

None yet. The Investments tab may eventually adopt the same layout, but that's out of scope.

---

## 11. State Machine / Workflow

Stateless read-only endpoint. No workflow.

---

## 12. Out of Scope / Future Considerations

| Item | Reason |
|------|--------|
| Pulling change description from EA review questionnaire body instead of drawio `functions` | Review Q&A text is richer but less structured; deferred until we have an extractor that maps answers to specific apps. |
| Exporting the timeline as a CSV / ICS calendar file | Valid architect ask but not today's goal. |
| Grouping multiple status pills into a single project row (e.g. `Change + Sunset`) | Would hide information. Two entries is clearer. |
| Sort direction toggle (DESC/ASC) | DESC-with-NULLS-last covers the primary architect question ("what's next"); flipping is a minor variant. |
| Showing impact-radius (downstream apps) per entry | Cross-feature with Impact tab; separate feature. |
