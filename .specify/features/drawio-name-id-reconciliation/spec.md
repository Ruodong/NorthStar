# Drawio Name-ID Reconciliation

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-11                |
| Status  | In progress               |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L3** |
| Risk | **Medium** — auto-correct fuzzy threshold is a tuning knob; wrong thresholds can misroute apps |
| Downstream | `/api/admin/confluence/pages/{id}/extracted`, frontend Extracted tab, `load_neo4j_from_pg.py` (uses resolved_app_id for MERGE key) |
| Rollback | `ALTER TABLE … DROP COLUMN resolved_app_id, match_type, name_similarity` + revert 3 files + Neo4j --wipe |

---

## 1. Context

Architects write drawios by hand. When they label a cell `A000001 / AI Verse`, one of two things is usually true:
1. **They typed the correct A-id** — CMDB A000001 is the app they mean, and any name variance is a typo.
2. **They mistyped the A-id** — CMDB A000001 is actually a completely different system (e.g. "ECC", the legacy SAP ERP), and the name is what they actually meant.

Before this feature, `confluence_diagram_app` stored both fields raw and the admin UI silently preferred the CMDB name looked up by the drawio A-id — so case #2 produced rows like:

    APP ID   NAME  STATUS   FUNCTIONS
    A000001  ECC   Keep     On-Premise LLM, Safeguard Service

which is wrong on every level: the architect meant AI Verse, the diagram shows "AI Verse", and the Neo4j graph links AI Verse's drawios to ECC.

Confirmed on 71: CMDB has `A000426 AI-Verse` (Active, sim("AI Verse","AI-Verse")≈0.875). We can reliably auto-correct.

## 2. Functional Requirements

- **FR-1** Add three columns to `northstar.confluence_diagram_app`:
  - `resolved_app_id VARCHAR` — the final A-id after name validation (may equal `standard_id`, differ from it, or be set even when `standard_id IS NULL`)
  - `match_type VARCHAR` — one of: `direct`, `typo_tolerated`, `auto_corrected`, `fuzzy_by_name`, `mismatch_unresolved`, `no_cmdb`
  - `name_similarity REAL` — numeric pg_trgm similarity in [0,1] between the drawio name and the resolved app's CMDB name
- **FR-2** New script `scripts/resolve_confluence_drawio_apps.py` MUST:
  - Walk every `confluence_diagram_app` row
  - Implement the decision tree (see § 5)
  - Use `pg_trgm` similarity against `ref_application.name` + `app_full_name` with these thresholds:
    - **direct**: drawio id in CMDB AND name sim ≥ 0.85 → keep drawio id
    - **typo_tolerated**: drawio id in CMDB AND 0.60 ≤ sim < 0.85 → keep drawio id (architect typo, same app)
    - **auto_corrected**: drawio id in CMDB but sim < 0.60, AND drawio name fuzzy-matches a different A-id with sim ≥ 0.70 → use the different A-id
    - **auto_corrected_missing_id**: drawio id NOT in CMDB at all, but drawio name matches a CMDB app with sim ≥ 0.70 → use the matched A-id
    - **fuzzy_by_name**: drawio has no id, drawio name fuzzy-matches with sim ≥ 0.70 → use the matched A-id
    - **mismatch_unresolved**: drawio id in CMDB, sim < 0.60, no alternate A-id with sim ≥ 0.70 → keep drawio id, flag
    - **no_cmdb**: neither the id nor a name match yields a CMDB hit
  - Write `resolved_app_id`, `match_type`, `name_similarity` on each row
  - Be idempotent — re-runnable with no side effects on stable data
- **FR-3** `load_neo4j_from_pg.py` MUST prefer `resolved_app_id` over `standard_id` when deriving the app_id for MERGE. This makes "AI Verse" a single `:Application` node keyed on `A000426` instead of fragmenting across `A000001` + `A000426`.
- **FR-4** `/api/admin/confluence/pages/{page_id}/extracted` MUST return, per app row:
  - `app_name` (drawio label, unchanged)
  - `standard_id` (drawio A-id, unchanged)
  - `resolved_app_id` (new)
  - `match_type` (new)
  - `name_similarity` (new)
  - `cmdb_name_for_resolved` — the CMDB name for `resolved_app_id` (canonical display)
  - `cmdb_name_for_drawio_id` — the CMDB name for the drawio's original `standard_id` (needed for UI to show "was X" context when auto_corrected)
- **FR-5** Frontend Extracted tab MUST add a new "MATCH" column between APP ID and NAME:
  - `✓ direct` green pill for `direct`
  - `≈ typo` amber pill for `typo_tolerated` (tooltip: "drawio wrote X, CMDB says Y — same app, typo tolerated")
  - `↻ auto-fixed` amber pill with 2px left border for `auto_corrected` / `auto_corrected_missing_id`
  - `? fuzzy` amber pill for `fuzzy_by_name`
  - `✗ mismatch` red pill for `mismatch_unresolved`
  - `— no id` dim dash for `no_cmdb`
- **FR-6** For `auto_corrected` rows, the APP ID cell MUST show the new id as primary (amber) with a muted secondary line `was <old_id>`.
- **FR-7** The NAME column MUST continue to show the drawio label first (already done), but when `resolved_app_id` disagrees with `standard_id`, append `· CMDB: <cmdb_name_for_resolved>` inline in muted type so reviewers can see the resolved target.
- **FR-8** Interactions table MUST display application names in the FROM / TO columns instead of raw A-ids. When an app has a `resolved_app_id`, prefer the resolved app's name; fall back to the drawio label; final fallback to the A-id string.

## 3. Non-Functional Requirements

- **NFR-1** Resolve script must complete in < 30s for the current 49,330 rows. Use a prefetched CMDB dict + pg_trgm on the server side to minimize round trips.
- **NFR-2** Migration 012 additive + idempotent (`ADD COLUMN IF NOT EXISTS`).
- **NFR-3** Resolve script re-runnable: if a row's resolved_app_id/match_type/name_similarity already match the newly computed values, skip the UPDATE.
- **NFR-4** Neo4j loader behaviour when resolved_app_id IS NULL: fall back to standard_id (current behaviour), no regression.

## 4. Acceptance Criteria

- **AC-1** — Migration 012 applied: `confluence_diagram_app` has columns `resolved_app_id`, `match_type`, `name_similarity`. Test: `test_resolve_columns_exist`.
- **AC-2** — Resolve script populates at least 40,000 of the 49,330 rows with a non-null `match_type`. Test: `test_resolve_coverage`.
- **AC-3** — EA250197 pilot: the row with `attachment_id=596101008` and drawio name `AI Verse` has `resolved_app_id='A000426'` AND `match_type='auto_corrected'` AND `name_similarity >= 0.70`. Test: `test_ai_verse_auto_corrected`.
- **AC-4** — EA250197 pilot: the row with drawio name `Avatue` (typo) and `standard_id='A002634'` has `resolved_app_id='A002634'` AND `match_type IN ('direct','typo_tolerated')`. Test: `test_avatue_typo_tolerated`.
- **AC-5** — After resolve + Neo4j reload, `/api/graph/nodes/A000426` returns the AI-Verse node and one of its `inbound` or `outbound` edges or its `confluence_pages` contains page 596101004. Test: `test_ai_verse_node_reachable_after_resolve`.
- **AC-6** — `/extracted` endpoint exposes `match_type`, `resolved_app_id`, and `cmdb_name_for_drawio_id` on every app row. Test: `test_extracted_endpoint_includes_resolve_fields`.

## 5. Decision Tree (FR-2 expanded)

```
drawio row: (drawio_name, drawio_std_id, drawio_functions)
            │
            ├── drawio_std_id is NULL?
            │     → fuzzy_name_match(drawio_name):
            │           ├── hit (sim >= 0.70) → match_type='fuzzy_by_name', resolved=hit.app_id
            │           └── miss              → match_type='no_cmdb', resolved=NULL
            │
            └── drawio_std_id IS NOT NULL?
                  │
                  ├── cmdb[drawio_std_id] IS NULL (id not in CMDB)?
                  │     → fuzzy_name_match(drawio_name):
                  │           ├── hit                → match_type='auto_corrected_missing_id', resolved=hit.app_id
                  │           └── miss               → match_type='no_cmdb', resolved=drawio_std_id (keep raw)
                  │
                  └── cmdb[drawio_std_id] exists: cmdb_name = cmdb[drawio_std_id].name
                        name_sim = similarity(drawio_name, cmdb_name)
                        │
                        ├── name_sim >= 0.85         → match_type='direct', resolved=drawio_std_id
                        │
                        ├── 0.60 <= name_sim < 0.85  → match_type='typo_tolerated', resolved=drawio_std_id
                        │
                        └── name_sim < 0.60
                              → fuzzy_name_match(drawio_name):
                                    ├── hit.app_id != drawio_std_id → match_type='auto_corrected', resolved=hit.app_id
                                    └── miss OR same id             → match_type='mismatch_unresolved', resolved=drawio_std_id
```

`fuzzy_name_match(q)` runs:
```sql
SELECT app_id,
       GREATEST(
           similarity(lower(name),       lower($q)),
           similarity(lower(app_full_name), lower($q))
       ) AS sim
FROM ref_application
WHERE similarity(lower(name), lower($q)) >= 0.70
   OR similarity(lower(app_full_name), lower($q)) >= 0.70
ORDER BY sim DESC
LIMIT 1
```

## 6. Edge Cases

- **EC-1** — Parser output has `standard_id=''` (empty string, not NULL). Treat as NULL for the purposes of the decision tree.
- **EC-2** — Drawio name contains embedded newlines or trailing punctuation. Normalize with `.strip()` before similarity (pg_trgm already lowercases internally).
- **EC-3** — CMDB has two apps with the same name ("AI-Verse" and "AI-Verse_RoW" in our data). Tiebreak by Active status first (`status = 'Active'` > `status = 'Planned'` > `Decommissioned`), then by lower app_id string.
- **EC-4** — Re-running the resolve script after CMDB has been updated: pick up the new hits (idempotent UPDATE always re-reads CMDB).
- **EC-5** — Drawio A-id is entirely fabricated (not real A\d{5,6} format). Parser never returns this case today, but if it ever did, treat as no_cmdb.

## 7. API impact

`/api/admin/confluence/pages/{page_id}/extracted` gains 5 new fields per app row. Existing fields unchanged. Existing consumers are not broken.

## 8. Affected files

- `backend/sql/012_confluence_diagram_app_resolve.sql` (new)
- `scripts/resolve_confluence_drawio_apps.py` (new)
- `backend/app/routers/admin.py` (modified) — endpoint returns new fields
- `scripts/load_neo4j_from_pg.py` (modified) — use resolved_app_id for merge key
- `frontend/src/app/admin/confluence/[page_id]/page.tsx` (modified) — new Match column, flipped Interactions display
- `api-tests/test_drawio_reconciliation.py` (new) — 6 ACs
- `scripts/test-map.json` (modified)

## 9. Out of scope

- `/admin/aliases` integration (future: auto-correct and mismatch rows feed the aliases queue)
- Functions/description cross-check as a second validation signal (phase 2)
- Retroactively fixing already-resolved apps after a CMDB rename — caller must re-run the script
- Tech_Arch diagram reconciliation — App_Arch only
