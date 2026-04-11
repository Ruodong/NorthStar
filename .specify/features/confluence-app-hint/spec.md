# Confluence App Hint Extraction

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-10                |
| Status  | In progress — pilot #3 of closed-loop v2 |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L2** — adds 1 column, 1 helper module, touches scan_confluence.py + admin.py |
| Risk | **Medium** — regex mistakes could mis-group apps; CMDB fuzzy match threshold is a tuning knob |
| Downstream | `/api/admin/confluence/pages`, `/admin/aliases` (unmatched hints surface here), loader is not touched |
| Rollback | `ALTER TABLE ... DROP COLUMN app_hint` + git revert |

---

## 1. Context

Pattern A (confluence-child-pages spec) fixed the case where a parent page carries an explicit `A\d{5,6}` id in its title and its children inherit via `effective_app_id`. But a very common layout at Lenovo is the opposite:

- The parent is a project folder page like `LI2500034 - Fusion Retail FY25 For CSDC` — only a project id, no app id
- The children are named `LI2500034-CSDC-Solution Design`, `LI2500034 - RetailFaimly- Technical Design`, etc — the **middle segment** is a free-text application name ("CSDC", "RetailFaimly"), not a CMDB id
- Neither parent nor child gives us an `A\d+` to match on
- Today the entire project + all its arch children collapse into one `effective_app_id=NULL` row in the admin list, which is deeply misleading: two different apps' drawios sum into one row labelled with the project name

**Decisions locked in with the user (2026-04-10):**
- **Q1=A** — collapse "Solution Design" + "Technical Design" (and "Application Architecture" + "Technical Architecture") into a **single row per app**, consistent with Pattern A
- **Q2=A** — **strict** similarity threshold ≥ 0.6 on pg_trgm, bias toward precision over recall
- **Q3=A** — when the hint cannot be resolved to a CMDB app, show it as `[<hint>]` (square-bracketed) and keep the group distinct so the user can later resolve it via `/admin/aliases`

## 2. Functional Requirements

- **FR-1** Add column `northstar.confluence_page.app_hint VARCHAR` holding the free-text application name extracted from the page title. `NULL` means "no hint could be extracted" (e.g., the page is not an arch/design leaf).
- **FR-2** Extraction rule (see § 5 for regex details) — strip `Copy of ` prefix, strip `LI\d+` / `FY\d+-\d+` / `EA\d{6}` prefix with any separator, strip trailing architecture/design keywords in English OR Chinese, then trim. Whatever remains is the hint. If empty or length < 2 → NULL.
- **FR-3** Scanner MUST call the extractor at insert time and write `app_hint` into the row.
- **FR-4** A backfill script `scripts/backfill_app_hint.py` MUST run the same extractor against every existing confluence_page and populate `app_hint` — idempotent, re-runnable.
- **FR-5** After `app_hint` is populated, `effective_app_id` MUST be computed by a second pass:
  - Own `q_app_id` wins (unchanged from FR-8 of confluence-child-pages)
  - Else, walk parent chain for nearest ancestor `q_app_id` (unchanged)
  - Else, if `app_hint` is set, run pg_trgm similarity against `ref_application.name` and `ref_application.short_name`, take the top match with `similarity >= 0.6` — if hit, write the matched `app_id`
  - Else, leave `effective_app_id` NULL
- **FR-6** The admin `/api/admin/confluence/pages` grouping key MUST become `COALESCE(effective_app_id, 'HINT:' || app_hint, 'NA')` so unmatched hints form their own distinct row instead of merging into the NULL bucket.
- **FR-7** The admin response MUST expose `app_hint` on each row and the UI-facing `app_id` column MUST render as `[<app_hint>]` (brackets + hint text) when `effective_app_id` is NULL but `app_hint` is set — signalling "unresolved, click to map".
- **FR-8** The extractor helper MUST live in a new module `scripts/title_parser.py` so the scanner, the backfill script, and tests all import the same function.

## 3. Non-Functional Requirements

- **NFR-1** Extractor is pure-Python, no external calls, O(len(title)) per page.
- **NFR-2** CMDB fuzzy match uses PG's `pg_trgm` GIN index on `ref_application.name` (already exists per 005_search_indexes). One query per hint during backfill; scanner holds a small in-memory LRU cache.
- **NFR-3** Backfill must be safe to re-run. Re-running must only touch rows where `app_hint` / `effective_app_id` actually changed.
- **NFR-4** Migration `007_app_hint.sql` is additive + idempotent (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

## 4. Acceptance Criteria

- **AC-1** — Extract-from-title unit behaviour. For the pilot strings, `extract_app_hint` returns exactly:
  | Title | Expected hint |
  |---|---|
  | `LI2500034-CSDC-Solution Design` | `CSDC` |
  | `LI2500034 - CSDC - Technical Design` | `CSDC` |
  | `LI2500034 - RetailFaimly- Solution Design` | `RetailFaimly` |
  | `LI2500034 - RetailFaimly-Technical  Design` | `RetailFaimly` |
  | `GSC Content Extractor Application Architecture` | `GSC Content Extractor` |
  | `MTY IFP Technical Architecture` | `MTY IFP` |
  | `LI2500157 - Procurement Compliance Agent Solution Design` | `Procurement Compliance Agent` |
  | `LI2500009 - Solution Design` | `None` (no app hint) |
  | `Copy of LI2300097 - Solution Design` | `None` |
  | `建店Java版本-应用架构图` | `建店Java版本` |
  | `建店Java版本-技术架构图` | `建店Java版本` |
  | `LI2500034 - Fusion Retail FY25 For CSDC` | `None` (depth=1 project folder) |
  Test: `api-tests/test_app_hint_extract.py::test_extractor_table`.
- **AC-2** — After running the backfill against the live DB, the known-match hint `Retail Family` (from `LI2500034 - RetailFaimly` children) MUST resolve to `effective_app_id = A000296` via pg_trgm. Test: `test_retailfamly_resolves_to_cmdb`.
- **AC-3** — The hint `CSDC` (from `LI2500034-CSDC-*` children) MUST NOT match any CMDB application at similarity ≥ 0.6 (CSDC is a free-text code, not a CMDB-registered app name) → MUST remain `effective_app_id=NULL` BUT `app_hint='CSDC'` set. Test: `test_csdc_remains_unresolved`.
- **AC-4** — `/api/admin/confluence/pages?q=LI2500034&fiscal_year=FY2526` returns **exactly 3 rows**: one project-folder row with no app, one group `{project=LI2500034, app=A000296 Retail Family}` (2 pages), one group `{project=LI2500034, app=[CSDC]}` (2 pages). Test: `test_li2500034_displays_three_rows`.
- **AC-5** — Unmatched hints: when `effective_app_id IS NULL AND app_hint IS NOT NULL`, the API row's `app_id` field MUST be `[<hint>]` (literal square brackets) AND `app_name` MUST be `null`. Test: `test_unmatched_hint_formatting`.

## 5. Extraction regex details

The extractor is a sequence of strips, not a single regex. Steps (in order):

```python
def extract_app_hint(title: str) -> Optional[str]:
    t = title.strip()
    # 1. Copy-of prefix
    t = re.sub(r'^Copy of\s+', '', t, flags=re.IGNORECASE)
    # 2. Strip leading project id + separator
    t = re.sub(
        r'^(LI\d{6,7}|RD\d{6,11}|TECHLED-\d+|FY\d{4}-\d+|EA\d{6})'
        r'[\s\-:：]+',
        '',
        t,
    )
    # 3. Strip trailing English arch/design suffix
    t = re.sub(
        r'\s*[\-:：]?\s*(Application|Technical|Solution|Integration|Integrated)'
        r'\s+(Design|Architecture)\s*$',
        '',
        t,
        flags=re.IGNORECASE,
    )
    # 4. Strip trailing Chinese arch/design suffix
    t = re.sub(
        r'\s*[\-:：]?\s*(应用|技术|集成|解决方案|数据)'
        r'(架构|设计|架构图|设计图|架构设计)\s*$',
        '',
        t,
    )
    # 5. Final trim: remove dangling dashes, colons, whitespace
    t = t.strip(' -:：\t')
    if not t or len(t) < 2:
        return None
    return t
```

Edge cases covered:
- `LI2500034-CSDC-Solution Design` → step 2 strips `LI2500034-` → `CSDC-Solution Design` → step 3 strips `-Solution Design` → `CSDC`
- `LI2500034 - RetailFaimly-Technical  Design` → step 2 strips → `RetailFaimly-Technical  Design` → step 3 (tolerates double-space) → `RetailFaimly`
- `GSC Content Extractor Application Architecture` → step 2 no-op → step 3 strips ` Application Architecture` → `GSC Content Extractor`
- `建店Java版本-应用架构图` → step 2 no-op → step 3 no-op → step 4 strips `-应用架构图` → `建店Java版本`
- `LI2500009 - Solution Design` → step 2 strips → `Solution Design` → step 3 strips all → `""` → None
- `Copy of LI2300097 - Solution Design` → step 1 strips → `LI2300097 - Solution Design` → step 2 → `Solution Design` → step 3 strips all → None

## 6. Edge Cases

- **EC-1** — Title contains multiple project ids (rare). Only the leading one is stripped, hint retains the rest.
- **EC-2** — Title is entirely in a foreign script we don't match. Extractor returns full title as hint, fuzzy match likely fails, page becomes `[<full title>]` — user decides via aliases.
- **EC-3** — CMDB has multiple apps with the same/similar name (e.g. "Retail Demo" vs "Retail Family"). Strict 0.6 similarity + `ORDER BY similarity DESC LIMIT 1` makes this deterministic.
- **EC-4** — Two distinct hints fuzzy-match to the same CMDB app — they merge into the same row via `effective_app_id`. This is considered correct.
- **EC-5** — Scanner runs concurrently with backfill — ON CONFLICT UPDATE already handles concurrent writes to confluence_page.

## 7. API impact

Affected endpoint: `GET /api/admin/confluence/pages`. Response schema adds `app_hint`. Existing `app_id` field semantics change: for unresolved hints it now contains `[<hint>]` — clients must render that as a non-link label.

## 8. Affected files

- `backend/sql/007_app_hint.sql` (new) — migration adding `app_hint` column + index
- `scripts/title_parser.py` (new) — `extract_app_hint` + `resolve_app_id_via_cmdb`
- `scripts/scan_confluence.py` (modified) — call the extractor at insert, call resolver, persist
- `scripts/backfill_app_hint.py` (new) — one-shot backfill for the existing ~3000 rows
- `backend/app/routers/admin.py` (modified) — include `app_hint` in SELECT, use it in grouping key, render `[<hint>]` in `app_id`
- `api-tests/test_app_hint_extract.py` (new) — AC-1 unit tests against title_parser
- `api-tests/test_app_hint_match.py` (new) — AC-2..AC-5 integration tests against the live API + PG
- `scripts/test-map.json` (modified) — map new sources to new test files

## 9. Out of scope

- Changing `load_neo4j_from_confluence.py` or the Neo4j side. Neo4j already uses `q_app_id` / CMDB-derived ids — `effective_app_id` is an admin-side concern only (for now).
- Fixing CMDB data quality. If `RetailFaimly` doesn't fuzzy-match because CMDB has `Retail Family` with a space — that's a CMDB normalization problem handled separately via `app_normalized_name` table and `/admin/aliases`.
- UI changes beyond the API contract. The frontend already renders `app_id` as text; the `[hint]` syntax is human-readable without a code change.
