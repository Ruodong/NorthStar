# Confluence Child Pages Scanner

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-10                |
| Status  | In progress — pilot #2 of closed-loop v2 |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L2** — touches `scan_confluence.py`, adds 2 columns to `confluence_page`, adds a new test file |
| Risk | **Medium** — modifies PG schema + rerun of a long-running VPN-bound job |
| Downstream | `load_neo4j_from_confluence.py` reads `confluence_page` (should be backward-compatible), `api/graph/full` rebuilds from Neo4j |
| Rollback | `ALTER TABLE ... DROP COLUMN parent_id, depth` + `git revert` |

---

## 1. Context

`scripts/scan_confluence.py` walks the Confluence Architecture Review space (ARD) and for each fiscal year parent page enumerates the **direct children** via `/rest/api/content/{parent_id}/child/page`. For each of those it stores `confluence_page` + downloads every drawio/image/pdf attachment.

**The bug:** the scanner only ever goes **one level deep**. Most real project pages (e.g. `490795919 AMS-Operation智能体`) are themselves just a folder — the drawio files that carry the actual architecture live on child pages named `<Project> Application Architecture` and `<Project> Technical Architecture`. Those child pages and their attachments are never scanned, never downloaded, never loaded into Neo4j.

Counted today:

| FY | Project pages scanned | Project pages with a drawio | Coverage |
|---|---|---|---|
| FY2425 | 316 | 35 | 11.1% |
| FY2526 | 307 | 37 | 12.1% |

The missing 88% is why the graph feels sparse — the drawios exist in Confluence but never reach us.

## 2. Functional Requirements

- **FR-1** `scan_confluence.py` MUST descend into the children of every project page it discovers, up to `MAX_DEPTH = 3` levels below the FY parent (FY → project → arch-page → (future) nested sub-page).
- **FR-2** The scanner MUST record the parent page id for every non-FY page in a new column `confluence_page.parent_id`.
- **FR-3** The scanner MUST record the depth relative to the FY parent in a new column `confluence_page.depth` (FY parent = NULL, project page = 1, arch page = 2, etc.).
- **FR-4** `confluence_attachment` rows for child pages MUST be created the same way as for top-level project pages — same schema, same download logic, same drawio filter.
- **FR-5** The recursive walk MUST be depth-first and MUST handle pagination on `/child/page` for nodes with >50 children.
- **FR-6** The scanner MUST be re-runnable without creating duplicates — `ON CONFLICT (page_id) DO UPDATE` already covers the basics; `parent_id` and `depth` must be updated on each run.
- **FR-7** A child page's `fiscal_year` MUST inherit from the FY parent under which it was discovered, not be re-extracted from the title.
- **FR-8** A child page's `project_id` SHOULD inherit from its nearest ancestor project page when the child's own title doesn't contain a project-id pattern. This keeps the drawio files linked back to the project in `confluence_attachment.page_id → confluence_page.project_id`.

## 3. Non-Functional Requirements

- **NFR-1** Scanning one FY must not degrade worse than linearly in the number of child pages. A naive recursive walk is fine; no need for CQL.
- **NFR-2** The PG migration must be idempotent (`IF NOT EXISTS`).
- **NFR-3** A failed fetch of a single child page MUST NOT abort the whole scan — log a warning, increment an error counter, continue.

## 4. Acceptance Criteria

- **AC-1** — `northstar.confluence_page` has columns `parent_id` (VARCHAR nullable) and `depth` (INT nullable). Test: `test_confluence_page_has_parent_columns`.
- **AC-2** — After a scan of FY2526 with the recursive scanner, every page whose title contains the regex `Architecture$` (i.e. "Application Architecture" or "Technical Architecture") exists in `confluence_page`. Test: `test_architecture_pages_are_scanned`.
- **AC-3** — For the smoke-test parent page `490795919 AMS-Operation智能体`, BOTH `490795920` (Application Architecture) and `490795924` (Technical Architecture) exist in `confluence_page` AND each has at least one drawio attachment in `confluence_attachment`. Test: `test_ams_operation_children_scanned`.
- **AC-4** — `confluence_page.parent_id` forms a valid tree: for every row where `parent_id IS NOT NULL`, the parent row must also exist (self-referential FK constraint). Test: `test_confluence_page_parent_tree_is_consistent`.
- **AC-5** — The coverage ratio `pages_with_drawio / total_project_pages` for FY2526 after re-scan must rise from ~12% to at least 40%. Test: `test_drawio_coverage_ratio_improved`.

## 5. Edge Cases

- **EC-1** — Some pages have no body (blank). Scanner must still record parent_id + depth.
- **EC-2** — Some architecture pages may contain NO drawio, only an image/pdf. They must still be recorded in `confluence_page`.
- **EC-3** — Cycles in Confluence page hierarchy are theoretically impossible but we guard anyway: `MAX_DEPTH = 3` cuts off any accidental loop.
- **EC-4** — A child page that already exists in `confluence_page` (e.g. it was itself a top-level scanned page in a previous pass) should have its `parent_id` and `depth` updated on re-scan, but its body/attachments should not be re-downloaded unnecessarily.

## 6. API impact

None. This is an ingestion-layer feature; `/api/graph/*` reads from Neo4j which is rebuilt after the scan.

## 7. Affected files

- `backend/sql/004_confluence_parent.sql` (new) — migration
- `scripts/scan_confluence.py` (modified) — recursion
- `api-tests/test_confluence_child_pages.py` (new) — ACs
- `scripts/test-map.json` (modified) — add mapping

## 8. Out of scope

- Changing `load_neo4j_from_confluence.py` — it already reads all rows from `confluence_page` + `confluence_attachment`, so the new child-page rows will flow through automatically.
- Scanning FYs beyond what's currently in the DB (FY2122..FY2627). Backfill of FY2425 + FY2526 only, older FYs separately if needed.
