# Architecture Template Settings (Phase 1)

## Context

NorthStar architects consult Lenovo EA's official document templates (published in the Confluence EA space) when producing as-is and target architectures. Today those templates are bookmarks — there is no central NorthStar surface that (a) records which Confluence page holds the Business / Application / Technical Architecture template for the current year, and (b) previews the drawio diagrams found under that page without leaving NorthStar.

This spec covers **Phase 1 only**: a `/settings` page that stores one Confluence URL per architecture layer (BA / AA / TA) and renders the drawio diagrams discovered under each URL's subtree. Phase 2 (separate spec) will use those templates as layout hints for an as-is architecture generator; Phase 2 is explicitly **out of scope** here.

The architect workbench strategic anchor (`~/.gstack/projects/Ruodong-NorthStar/ceo-plans/2026-04-10-architect-workbench.md`) positions this feature as a reference surface — read-only consumption of EA-authored templates, not a template-authoring workflow.

## Functional Requirements

### FR-1: Source-of-Truth Table
A new Postgres table `northstar.ref_architecture_template_source` holds exactly three rows, keyed by the `layer` enum `('business','application','technical')`. Columns: `title`, `confluence_url`, `confluence_page_id`, `last_synced_at`, `last_sync_status`, `last_sync_error`, `notes`, `updated_at`. Idempotent migration seeds the three rows; AA and TA rows are pre-populated with the directory URLs supplied by the user, BA is left blank.

### FR-2: Template Source Tagging
Add nullable `template_source_layer VARCHAR` column to `northstar.confluence_page` and `northstar.confluence_attachment`. Relax `confluence_page.fiscal_year NOT NULL` to nullable (EA template pages have no fiscal year). The sync script populates the layer column for every page/attachment it discovers. Existing rows remain NULL — no retroactive migration.

### FR-3: Settings REST API
New router `backend/app/routers/settings.py` exposes:

- `GET /api/settings/architecture-templates` — returns all three rows with `diagram_count`
- `PUT /api/settings/architecture-templates/{layer}` — updates `title`, `confluence_url`, `notes`
- `POST /api/settings/architecture-templates/{layer}/sync` — fires off a background sync, returns 202 + immediately flips `last_sync_status='syncing'`
- `GET /api/settings/architecture-templates/{layer}/diagrams` — returns drawio attachments tagged with this layer, each enriched with `page_id`, `page_title`, `page_url`, `attachment_id`, `file_name`, `thumbnail_url`, `raw_url`

All responses wrapped in `ApiResponse[T]` with snake_case JSON keys (per CLAUDE.md).

### FR-4: Host-Side Sync Script
`scripts/sync_architecture_templates.py` runs on server 71 inside `.venv-ingest` (needs Confluence VPN access). For each layer with a non-empty `confluence_url`:

1. Resolve URL → `confluence_page_id` (parse `pageId=` query param first; otherwise call `GET /rest/api/content?spaceKey=EA&title=<decoded-title>` and take the first match).
2. Walk the subtree recursively with BFS (reuse the `list_children` helper pattern from `sync_ea_documents.py`).
3. For each visited page: upsert `confluence_page` (fiscal_year=NULL, page_type='ea_template', template_source_layer=<layer>).
4. Fetch attachments for that page; filter to `file_kind='drawio'` (plus paired `png` thumbnails for preview). Upsert `confluence_attachment` with `template_source_layer=<layer>`. Download the raw bytes to the existing `/data/attachments` volume using the same path scheme as `scan_confluence.py`.
5. Update `ref_architecture_template_source.last_synced_at` and `last_sync_status`; on error, also write `last_sync_error`.

Layers are independent — a failure on one does not abort the others. The script is idempotent: rerunning produces identical table state.

### FR-5: Weekly Sync Integration
Add a non-fatal stage to `scripts/weekly_sync.sh` that invokes `sync_architecture_templates.py`. Failures are logged but do not block the weekly pipeline.

### FR-6: Frontend Settings Page
A new top-level `/settings` page (`frontend/src/app/settings/page.tsx`) with three stacked cards, one per layer. Each card shows:

- Layer label (BA / AA / TA) and human name
- Editable inputs for `title` and `confluence_url`
- `Save` button (triggers PUT) and `Sync Now` button (triggers POST `/sync` and then polls GET every 3s until `last_sync_status != 'syncing'`)
- Status line: `Last synced <timestamp>` or `Syncing…` or `Error: <message>`
- Diagram grid (card layout, 3 columns at ≥1024px, 2 at ≥640px, 1 below): each card shows thumbnail (via existing `/api/admin/confluence/attachments/{id}/thumbnail`), diagram filename, parent page title, and `↗` link to the source Confluence page. Clicking the thumbnail opens `/api/admin/confluence/attachments/{id}/raw` in a new tab.

Navigation: append a `Settings` link to the rightmost NAV group in `NavLinks.tsx` (alongside Admin). Register the three cards in `CommandPalette.tsx` as static quick-jump entries (no backend search involvement — static Cmd+K items).

Styling follows DESIGN.md Orbital Ops: dark base, single amber accent for primary actions, 2–6px radii, no illustrations or gradients.

## Non-Functional Requirements

- `GET /api/settings/architecture-templates` returns in < 200ms (3 rows + one COUNT per layer).
- `POST /sync` returns 202 within 100ms (background task uses FastAPI `BackgroundTasks`).
- A full sync of a 20-page subtree with 40 drawio attachments completes in < 120s over VPN.
- Sync script idempotent: two consecutive runs produce identical row counts, same `last_sync_status='ok'`.
- No auth / RBAC (NorthStar is internal-only per CLAUDE.md).
- All JSON keys snake_case.
- Sync script gracefully handles: URL not set, URL unreachable, page not found, no drawio attachments in subtree.

## Acceptance Criteria

- [ ] `backend/sql/018_architecture_template_source.sql` creates table + alters + seeds 3 rows, idempotent on rerun.
- [ ] `GET /api/settings/architecture-templates` returns 3 rows with matching layer codes.
- [ ] `PUT /api/settings/architecture-templates/application` with `{confluence_url: "..."}` persists the new URL.
- [ ] `PUT` with unknown layer (e.g. `data`) returns 404.
- [ ] `POST /api/settings/architecture-templates/application/sync` returns 202 and sets `last_sync_status='syncing'`.
- [ ] After a successful offline unit-test run of the sync script's upsert path, `GET /api/settings/architecture-templates/application/diagrams` returns the seeded drawios with non-empty `thumbnail_url` and `raw_url`.
- [ ] `/settings` page renders three cards with the design-system styling, nav link visible, Cmd+K includes entries for each layer.
- [ ] `scripts/weekly_sync.sh` includes the new stage and does not abort on sync failure.
- [ ] `api-tests/test_settings_architecture_templates.py` passes with all FR-3 and FR-2 cases.

## Edge Cases

- **BA URL empty.** Save works; Sync Now button disabled; grid shows "No Confluence URL configured" empty state.
- **URL cannot be resolved.** Sync sets `last_sync_status='error'` with a human-readable `last_sync_error` (`page not found` / `invalid URL format`). Settings card displays it inline.
- **Confluence unreachable.** Same as above — no retries beyond the existing 3× exponential backoff already in the EA sync helpers.
- **No drawio attachments in subtree.** Sync succeeds, grid shows "No drawio diagrams found under this URL".
- **Same attachment hit by two layers.** Last sync wins `template_source_layer` (write order: business → application → technical). Documented, not guarded against.
- **User clears a URL (saves empty).** `last_synced_at` is left untouched (not wiped) so historical tagging is preserved. No cascade delete on `confluence_attachment` — old diagrams stay listed until user explicitly wipes (out of scope for Phase 1; noted as future work).
- **Page ancestors / cycles.** BFS with a visited-set prevents loops on malformed subtrees.
- **Non-drawio attachments** (PDFs, plain images, .xml sketches) are scanned into `confluence_attachment` but excluded from the diagrams grid (`file_kind='drawio'` filter).

## Affected Files

| File | Kind | Change |
|------|------|--------|
| `backend/sql/018_architecture_template_source.sql` | NEW | Table, column adds, seeds |
| `backend/app/models/schemas.py` | EDIT | `ArchitectureTemplateSource`, `ArchitectureTemplateSourceUpdate`, `ArchitectureTemplateDiagram` |
| `backend/app/routers/settings.py` | NEW | Router with 4 endpoints |
| `backend/app/main.py` | EDIT | Register settings router |
| `scripts/sync_architecture_templates.py` | NEW | Host-side sync |
| `scripts/weekly_sync.sh` | EDIT | Add non-fatal stage |
| `scripts/test-map.json` | EDIT | Register new router→test mapping |
| `api-tests/test_settings_architecture_templates.py` | NEW | List/update/sync/diagrams tests |
| `frontend/src/app/settings/page.tsx` | NEW | Settings page |
| `frontend/src/lib/api.ts` | EDIT | `put` helper + `settings` API namespace |
| `frontend/src/components/NavLinks.tsx` | EDIT | Add Settings link |
| `frontend/src/components/CommandPalette.tsx` | EDIT | Static quick-jump entries |

## Test Coverage

`api-tests/test_settings_architecture_templates.py`:

- `test_list_returns_three_seeded_rows` — default seed state
- `test_put_updates_url_and_title`
- `test_put_unknown_layer_returns_404`
- `test_post_sync_sets_syncing_status` — background task noop in test mode
- `test_diagrams_filters_by_layer` — fixtures write two attachments tagged 'application', query returns only those
- `test_diagrams_empty_layer_returns_empty_list`

## State Machine

`last_sync_status` values and transitions:

```
NULL           ──POST /sync──► 'syncing'
'ok'           ──POST /sync──► 'syncing'
'error'        ──POST /sync──► 'syncing'
'syncing'      ──script ends success──► 'ok'
'syncing'      ──script ends failure──► 'error' (also sets last_sync_error)

PUT never changes last_sync_status.
```

## Out of Scope

- Generating as-is architecture diagrams (Phase 2).
- Editing drawio files inside NorthStar.
- Uploading diagrams.
- Auth / per-user settings.
- Historical version tracking of template URLs.
- Supplying the BA template URL — user will fill it when a canonical EA BA page exists.
- Bulk re-render of drawio → PNG thumbnails (existing pipeline handles it when `scan_confluence.py` runs).
- Purging `template_source_layer` tags when a URL is cleared.
