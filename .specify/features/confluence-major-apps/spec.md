# Confluence Major Applications

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-11                |
| Status  | In progress               |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L3** — new population script, extends 1 endpoint, adds 1 UI section, uses existing Pattern D explode path |
| Risk | **Medium** — affects what shows in the admin /confluence list APP ID column for project-folder pages |
| Downstream | `/api/admin/confluence/pages` (grouping already consumes `confluence_page_app_link`), `/extracted` endpoint response, `/admin/confluence/[page_id]` Extracted tab |
| Rollback | `DELETE FROM confluence_page_app_link WHERE source = 'major_app'` + revert 2 files |

---

## 1. Context

Today, when a user lands on `/admin/confluence` and looks at a row like

    FY2526 | EA250197 | Lenovo Campus Recruitment-Nowcoder AI Interview | — | — | 4 apps 2 drawios | Confluence ↗

the APP ID / NAME columns are empty (—) because the Confluence page's title doesn't contain an `A\d{5,6}` id. But the drawios attached to that page absolutely DO say what the project is about — `Lenovo Campus Recruitment (A002964)` is marked `Change` (status: changing), meaning **this is the actual app being worked on in this project**. The parser already extracted it into `confluence_diagram_app`; the admin list just doesn't know to surface it yet.

"Major Application" = an app whose drawio cell has `application_status ∈ {New, Change, Sunset}` — i.e. the architect drew it with a color that says "something is changing here". Keep / 3rd Party are excluded because they're ambient context, not the project's deliverables.

## 2. Functional Requirements

- **FR-1** A new script `scripts/propagate_major_apps.py` MUST, for every `confluence_page`, compute the set of Major Applications from `confluence_diagram_app` rows attached to that page OR any descendant page (recursive, depth ≤ 5), and insert one row per unique major app into `confluence_page_app_link` with `source = 'major_app'`. Idempotent via `ON CONFLICT (page_id, app_id) DO NOTHING`.
- **FR-2** The effective app_id for each major app MUST use `COALESCE(cda.resolved_app_id, cda.standard_id)` so the name-id reconciliation from the prior feature is respected.
- **FR-3** Only apps with `application_status IN ('New', 'Change', 'Sunset')` are considered majors. `Keep`, `3rd Party`, and `Unknown` are skipped.
- **FR-4** Apps without any A-id (`resolved_app_id IS NULL AND standard_id IS NULL`) are skipped — we can't link them to a CMDB entity and they'd just pollute the admin grouping.
- **FR-5** The existing `/api/admin/confluence/pages` grouping query already walks `confluence_page_app_link` via its Pattern D explode CTE. No query change is required — new `major_app` link rows flow through for free and become additional sibling rows in the admin list.
- **FR-6** `/api/admin/confluence/pages/{page_id}/extracted` MUST return a new top-level `major_apps` array listing the unique major apps for the page's subtree, ordered by priority (see § 5). Each entry contains `app_id`, `cmdb_name`, `drawio_name`, `application_status`, `occurrence_count`, `source_attachments: [{attachment_id, attachment_title, source_page_title}]`.
- **FR-7** The frontend Extracted tab MUST show a `MAJOR APPLICATIONS (N)` section ABOVE the per-attachment breakdown. Each row: a pill showing the status (Change/New/Sunset), the app name (linked to `/admin/applications/{id}` when CMDB-matched), the A-id, and a muted occurrence count. This section is the answer to "what apps does this project actually touch?".

## 3. Non-Functional Requirements

- **NFR-1** `propagate_major_apps.py` must complete in < 30 s for the current 2760 confluence_page rows.
- **NFR-2** The propagation script must be safe to re-run. Re-running is a no-op on unchanged data.
- **NFR-3** The extended `/extracted` endpoint should add < 50 ms latency for a typical page with 5-20 major apps.

## 4. Acceptance Criteria

- **AC-1** — `confluence_page_app_link` contains at least 100 rows with `source = 'major_app'` after propagation. Test: `test_major_app_links_populated`.
- **AC-2** — For pilot page `596101004` (EA250197 Lenovo Campus Recruitment), `confluence_page_app_link` contains exactly one row with `source = 'major_app'` and `app_id = 'A002964'` (Lenovo Campus Recruitment). Test: `test_ea250197_major_app_is_lenovo_campus`.
- **AC-3** — Keep / 3rd Party apps MUST NOT appear as major_app links. Specifically, page 596101004 MUST NOT have a `major_app` link for `A000001` (AI Verse, Keep), `A002634` (Avatue, Keep), `A003749` (KM Verse, Keep), or 牛客 (3rd Party, no A-id). Test: `test_non_major_apps_excluded`.
- **AC-4** — `/api/admin/confluence/pages/596101004/extracted` response contains a `major_apps` field with length == 1 and the single entry has `app_id='A002964'`, `cmdb_name='Lenovo Campus Recruitment'`, `application_status='Change'`. Test: `test_extracted_major_apps_section`.
- **AC-5** — `/api/admin/confluence/pages?q=EA250197&fiscal_year=FY2526` returns a row where `app_id='A002964'` and `app_name='Lenovo Campus Recruitment'` (instead of the previous `—`). Test: `test_ea250197_list_row_shows_major_app`.
- **AC-6** — Running `propagate_major_apps.py` twice produces the same number of `major_app` link rows (idempotent). Test: `test_propagate_idempotent`.

## 5. Sort priority (for display)

When multiple major apps exist on a page, the order in the `major_apps` array is:

1. Status weight: `Change` > `New` > `Sunset` (Change is strongest signal — something is actively being modified)
2. Occurrence count (higher wins — an app referenced by multiple drawios is more central)
3. CMDB-linked apps first (a real A-id > a hashed X-id)
4. `cmdb_name` alphabetical (deterministic tiebreak)

## 6. Edge Cases

- **EC-1** — Same app appears with different statuses in different drawios (e.g. `Change` in one, `Keep` in another). The `Change` instance wins; the Keep instance is silently dropped. Count = number of drawios where the app appeared with a "major" status.
- **EC-2** — Two drawios on the same page both mark app A as `New`. Only one link row is inserted (PK conflict → DO NOTHING). The occurrence_count in `/extracted` reflects the true count from `confluence_diagram_app`, independent of the deduped link table.
- **EC-3** — A page whose subtree contains NO drawios with major apps: no `major_app` link rows inserted. Admin list row still shows `—`. No regression.
- **EC-4** — A deep subtree (depth > 5): truncated at 5 levels; drawios below are ignored. Matches existing `confluence-child-pages` behaviour.

## 7. Affected files

- `scripts/propagate_major_apps.py` (new)
- `backend/app/routers/admin.py` (modified) — `/extracted` gains `major_apps` field
- `frontend/src/app/admin/confluence/[page_id]/page.tsx` (modified) — new MAJOR APPLICATIONS section in ExtractedView
- `api-tests/test_confluence_major_apps.py` (new) — 6 ACs
- `scripts/test-map.json` (modified)

## 8. Out of scope

- Promoting any major app to a "primary project app" single-valued column on `confluence_page`. We use the existing Pattern D explode + multi-row sibling rendering instead.
- Changing Neo4j loader behaviour. The loader already processes both `confluence_page_app_link` (via Pattern D) and `confluence_diagram_app` (for application node creation). Major apps are already flowing into Neo4j.
- Live-updating the major apps on every Confluence scan. The propagation is a batch step run after scan + resolve.
