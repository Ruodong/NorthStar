# Confluence Multi-App Page

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-10                |
| Status  | In progress — pilot #4 of closed-loop v2 |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L2** — adds new link table, touches scanner + admin query |
| Risk | **Medium** — changes admin grouping semantics (page can now appear in multiple rows) |
| Downstream | `/api/admin/confluence/pages`, Neo4j loader untouched |
| Rollback | `DROP TABLE northstar.confluence_page_app_link` + git revert |

---

## 1. Context

Some Confluence pages cover **multiple** applications in a single page — their title includes comma-separated A-ids, e.g.:

- `A000090,A000432,A003974- Architecture`
- `A000090,A000432,A003974- Application Solution`
- `A000090,A000432,A003974- Technology Architecture`

The current schema assumes one page ↔ one app via the scalar columns `q_app_id` and `effective_app_id`. Pattern A / B both use a single string value. For multi-app pages, only the first id (if any) gets stored, and the other apps lose their link to the drawios on this page.

## 2. Functional Requirements

- **FR-1** Add a new table `northstar.confluence_page_app_link(page_id, app_id, source, created_at)`. Many-to-many, PK `(page_id, app_id)`.
- **FR-2** Valid `source` values: `'title_extract'` (parsed from title regex), `'questionnaire'` (from body questionnaire), `'manual'` (future: user-added via admin UI), `'cmdb_hint'` (fuzzy matched from app_hint).
- **FR-3** The scanner MUST populate this table on every upsert:
  - Run `extract_app_ids_multi(title)` — already written in title_parser.py
  - For each A-id in the result, insert `(page_id, a_id, 'title_extract')` with `ON CONFLICT DO NOTHING`
  - Also insert the primary `q_app_id` (if set) as `(page_id, q_app_id, 'title_extract')` when it's not already in the multi list — this keeps single-app pages consistent with multi-app pages
- **FR-4** When a page has >1 row in `confluence_page_app_link`, the admin grouping query MUST materialize the page **once per linked app**, so each app row gets its own attachment/drawio totals.
- **FR-5** Backfill the link table for existing rows by running `extract_app_ids_multi` against every `confluence_page.title`.
- **FR-6** The admin response rows MUST remain stable in ordering — pages with multi-app links sort into each app's group independently.

## 3. Non-Functional Requirements

- **NFR-1** The link table must be additive — existing single-app queries on `confluence_page.q_app_id` must keep working for backward compat.
- **NFR-2** Backfill is idempotent via `ON CONFLICT (page_id, app_id) DO NOTHING`.
- **NFR-3** Admin query cost per row: +1 join to the link table. Must still complete under 300ms for a 20-row page.

## 4. Acceptance Criteria

- **AC-1** — `northstar.confluence_page_app_link` exists with columns `(page_id VARCHAR, app_id VARCHAR, source VARCHAR, created_at TIMESTAMP)` and primary key `(page_id, app_id)`. Test: `test_page_app_link_schema`.
- **AC-2** — After backfill, the page `517788828` ("A000090,A000432,A003974- Architecture") has **3 rows** in the link table, one per extracted A-id. Test: `test_triple_app_page_has_three_links`.
- **AC-3** — The admin list for `LI2500120` returns the multi-app pages under **each of the 3 app_ids** (A000090, A000432, A003974) — not as one `app_id=NULL` row. Test: `test_multi_app_page_appears_in_three_rows`.
- **AC-4** — Sum of `group_size` across all three rows for the multi-app page MAY be >= number of unique pages, because the same page is legitimately counted once per linked app. Test: `test_multi_app_grouping_consistency`.

## 5. Edge Cases

- **EC-1** — A page has both a `q_app_id` (single, from APP_TITLE_RE) and additional A-ids in the middle of the title (e.g. `A000328-BPP Integrated with A000296-Retail Family`). All are stored; admin shows the page under both apps.
- **EC-2** — Same A-id appears twice in the title. De-dup at insert time.
- **EC-3** — Backfill running against a table row whose title has changed since the last scan. Additive inserts are idempotent; stale links remain unless the scanner removes them. For now we accept this — stale links are cleaned up on next full scan via `ON CONFLICT DO NOTHING` + periodic truncate-and-reload.

## 6. Affected files

- `backend/sql/008_page_app_link.sql` (new) — table + PK + index
- `scripts/title_parser.py` (already has `extract_app_ids_multi`)
- `scripts/scan_confluence.py` (modified) — insert into link table
- `scripts/backfill_page_app_link.py` (new) — populate for existing rows
- `backend/app/routers/admin.py` (modified) — LEFT JOIN link table + explode
- `api-tests/test_multi_app_page.py` (new) — 4 AC tests

## 7. Out of scope

- A UI for manually curating page↔app links. Just the data layer + admin list rollup.
- Changing the Neo4j loader to use this table (Neo4j still uses CMDB + drawio-derived ids).
