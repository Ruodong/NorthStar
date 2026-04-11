# Confluence Root Project ID

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-11                |
| Status  | In progress — pilot #5 of closed-loop v2 |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L2** — adds 1 column, 1 backfill script, touches scan_confluence.py + admin.py + tests |
| Risk | **Medium** — changes admin grouping semantics (pages previously grouped under sub-initiative id will now fold into root) |
| Downstream | `/api/admin/confluence/pages` grouping, future `/api/search`, Neo4j loader untouched (uses q_app_id / CMDB id, not project_id) |
| Rollback | `ALTER TABLE ... DROP COLUMN root_project_id` + revert grouping SQL |

---

## 1. Context

`confluence_page.project_id` currently conflates two distinct concepts:
1. **The page's OWN project id** — whatever `PROJECT_ID_RE` finds in the title
2. **The Confluence tree's ROOT project id** — the depth=1 ancestor's project

These two collide when a sub-initiative page at depth=2 has its own id in its title:

```
depth=1  LI2500067-FY2526 AIO AIOps Project              project_id=LI2500067
  depth=2  FY2526-063 - Robbie IT Service Agent          project_id=FY2526-063  ← overwritten
  depth=2  FY2526 AIOps - Alert Handling Agent           project_id=LI2500067   ← inherited
```

In the admin list `FY2526-063` gets split off as its own "top-level project row" even though in Confluence it's a leaf under LI2500067. The Alert Handling Agent branch gets lucky because its title has no `FY\d{4}-\d+` match and falls through to ancestor inheritance.

We need a persistent field that always holds the depth-1 ancestor's project id so admin grouping / search / analytics can operate on the real tree root without losing the original `project_id` (which is still useful as a sub-initiative label on the page itself).

## 2. Functional Requirements

- **FR-1** Add column `northstar.confluence_page.root_project_id VARCHAR`, nullable, indexed.
- **FR-2** For depth=1 pages, `root_project_id = project_id` (self-referential; they ARE the root).
- **FR-3** For depth≥2 pages, `root_project_id` MUST equal the `root_project_id` of its `parent_id` page — computed via walk up the `parent_id` chain in depth order.
- **FR-4** The scanner MUST set `root_project_id` at insert time, using a new `ancestor_root_project_id` parameter threaded through `process_page` recursion (same mechanism as `ancestor_app_id` / `ancestor_app_hint`).
- **FR-5** A backfill script `scripts/backfill_root_project_id.py` MUST populate `root_project_id` on existing rows by walking the parent tree in a single pass ordered by depth ASC.
- **FR-6** The admin `/api/admin/confluence/pages` grouping key MUST use `COALESCE(root_project_id, project_id)` as the project partition instead of `project_id` alone. This makes FY2526-063 pages fold into the same row group as LI2500067.
- **FR-7** The `project_id` column MUST remain untouched on every page. We do NOT overwrite FY2526-063 with LI2500067 — the sub-initiative identity is preserved, just no longer used as the grouping key.
- **FR-8** When `root_project_id IS NULL` (e.g. a legacy row we couldn't walk), fall back to `project_id` — rows without either stay as their own singleton group.

## 3. Non-Functional Requirements

- **NFR-1** Backfill must run in a single pass with a dict of `{page_id: root_project_id}` for children to look up — O(n) in rows, no recursive CTE.
- **NFR-2** Migration 010 must be idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- **NFR-3** Backfill must be safe to re-run; the UPDATE is a no-op when `root_project_id` already matches.

## 4. Acceptance Criteria

- **AC-1** — `confluence_page.root_project_id` exists as a VARCHAR column with an index. Test: `test_root_project_id_column_exists`.
- **AC-2** — Every depth=1 page has `root_project_id = project_id`. Test: `test_depth_1_pages_are_self_root`.
- **AC-3** — Pilot tree: all 7 pages in the LI2500067 subtree (LI2500067 root + FY2526-063 Robbie branch + LI2500067 Alert Handling branch + their children) have `root_project_id = 'LI2500067'`. Test: `test_li2500067_tree_all_root_li2500067`.
- **AC-4** — Admin list for `q=LI2500067 fiscal_year=FY2526` returns Robbie and Alert Handling rows under **one** `LI2500067` project group, not split across FY2526-063 and LI2500067. Specifically: `project_id` values in the returned rows MUST all be `"LI2500067"`. Test: `test_admin_groups_subtree_under_root`.
- **AC-5** — FY2526-063 is NOT lost: a separate test asserts that the `confluence_page` row for page `529550429` still has `project_id = 'FY2526-063'` (the sub-initiative identity is preserved in the DB, just not used as the admin grouping key). Test: `test_sub_initiative_id_preserved_on_row`.

## 5. Edge Cases

- **EC-1** — Legacy rows with NULL `depth`: the backfill treats them like depth=1 seeds (use their own `project_id` as root). This is a conservative fallback — they'll display as their own groups instead of merging with anything.
- **EC-2** — Depth=1 page with NULL `project_id`: `root_project_id` stays NULL. These rows fall back to their own `page_id` in the admin grouping key and remain isolated, which matches today's behaviour.
- **EC-3** — Parent chain broken (parent_id points to a page not in confluence_page): fallback to the row's own `project_id`. Logged as a warning in backfill.

## 6. Affected files

- `backend/sql/010_root_project_id.sql` (new) — migration
- `scripts/title_parser.py` — unchanged (pure function; root walk is done by scanner and backfill)
- `scripts/scan_confluence.py` (modified) — thread `ancestor_root_project_id` through `process_page`, persist it
- `scripts/backfill_root_project_id.py` (new) — single-pass depth-ordered walker
- `backend/app/routers/admin.py` (modified) — grouping key uses `COALESCE(root_project_id, project_id)`
- `api-tests/test_root_project_id.py` (new) — AC-1..AC-5
- `scripts/test-map.json` (modified) — wire up new test

## 7. Out of scope

- Showing a "Sub-initiative" pill next to the primary project id in the admin row (future UI polish; the data to drive it is now available via `project_id != root_project_id`).
- Updating Neo4j loader — it already uses q_app_id + CMDB ids for INVESTS_IN edges, not `project_id`.
- Changing `/api/search` to search by root_project_id (can be added later once we confirm the grouping change is good).
