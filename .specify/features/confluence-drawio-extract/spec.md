# Confluence Drawio Extraction

| Field   | Value                     |
|---------|---------------------------|
| Author  | Ruodong Yang              |
| Date    | 2026-04-11                |
| Status  | In progress — Plan A pilot |

---

## 0. Impact Assessment

| Axis | Value |
|---|---|
| Level | **L3** — adds 2 new tables, a new parser script, touches Neo4j loader gate, backfill rerun |
| Risk | **Medium-High** — Neo4j graph expands significantly (possibly thousands of new `:Application` / `INTEGRATES_WITH`) |
| Downstream | `/admin/confluence` detail page (can surface extracted apps), `load_neo4j_from_pg.py` (gate loosened), full graph `/api/graph/*` |
| Rollback | `DROP TABLE northstar.confluence_diagram_{app,interaction}` + revert loader gate + `load_neo4j_from_pg.py --wipe` |

---

## 1. Context

We have 2580 downloaded Confluence drawio files on 71 under `data/attachments/`, and a fully-functional `backend/app/services/drawio_parser.py` (1552 lines, copied from EGM). But **zero extraction is happening**:

1. `scan_confluence.py` only downloads files + records metadata
2. `load_neo4j_from_pg.py` line 497 gates parsing on `entry["egm_record"] is None` — Confluence-only drawios are explicitly skipped with `continue`
3. `ref_diagram_app` has 297 rows, all mirrored from EGM (17 distinct diagrams). The 2580 Confluence drawios contribute 0 apps

Pilot parse of `data/attachments/517769868.drawio` (A000394 LBP Application Architecture, 379 KB):
- **20 applications extracted** (8 with `A\d{5,6}` standard ids: A000001, A000291, A000406, A000424, A001652, A002201, A002281, A002812)
- **23 interactions extracted**

Extrapolating conservatively (5 apps avg × 2580 files = ~13k apps, ~30k interactions), the parser pipeline should be robust enough to run end-to-end without manual review.

## 2. Functional Requirements

- **FR-1** Add tables `northstar.confluence_diagram_app` and `northstar.confluence_diagram_interaction` keyed by (attachment_id, cell_id) and (attachment_id, source_cell_id, target_cell_id, order) respectively.
- **FR-2** New script `scripts/parse_confluence_drawios.py` MUST:
  - Iterate all `confluence_attachment` rows where `file_kind='drawio'` AND `local_path IS NOT NULL` AND `title` is not a backup/tmp
  - Read the local file, call `parse_drawio_xml(xml, "App_Arch")`
  - Upsert extracted apps into `confluence_diagram_app` via `ON CONFLICT (attachment_id, cell_id) DO UPDATE`
  - Upsert extracted interactions into `confluence_diagram_interaction`
  - Be idempotent: re-running on unchanged files is a no-op
  - Accept `--attachment-id X` and `--limit N` flags for targeted reruns
  - Skip attachments that fail parsing gracefully, counting them in a `parse_errors` stat
- **FR-3** `load_neo4j_from_pg.py` MUST consume the new tables:
  - After loading EGM-sourced diagrams, iterate `confluence_diagram_app` rows joined to `confluence_page` (to get `project_id` + `fiscal_year`)
  - For each row, MERGE `:Application` with the same `app_id` derivation rule as EGM diagrams (CMDB lookup → use canonical name; otherwise hash id)
  - Create `(:Project)-[:INVESTS_IN {fiscal_year}]->(:Application)` edges using the page's project_id
  - Create `(:Application)-[:INTEGRATES_WITH]->(:Application)` edges from the interactions table
  - Respect the `--wipe` flag (loader is idempotent; re-running with `--wipe` rebuilds cleanly)
- **FR-4** The parser MUST preserve `standard_id`, `id_is_standard`, `application_status`, `functions`, and the raw `cell_id` from the drawio cells.
- **FR-5** The interaction rows MUST preserve `source_cell_id`, `target_cell_id`, `interaction_type`, `direction`, `interaction_status`, `business_object`, plus an `edge_order` counter to allow duplicate (src, tgt, label) edges on the same diagram.

## 3. Non-Functional Requirements

- **NFR-1** Parser MUST complete in < 10 minutes for 2580 files on the 71 host (roughly 230ms/file worst case). Each file parse is CPU-bound; parallelism not required.
- **NFR-2** Migration 011 is additive + idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- **NFR-3** Parse errors MUST NOT abort the whole run. Log at WARNING and continue.
- **NFR-4** Neo4j loader MUST remain the single writer. No router code touches Neo4j.

## 4. Acceptance Criteria

- **AC-1** — `northstar.confluence_diagram_app` and `northstar.confluence_diagram_interaction` tables exist with the expected columns. Test: `test_confluence_diagram_tables_exist`.
- **AC-2** — After running the parser against downloaded files, the `confluence_diagram_app` table contains at least 500 rows with non-null `standard_id` (conservative floor). Test: `test_parser_populated_minimum_apps`.
- **AC-3** — Pilot file `attachment_id = 517769868` (LBP Application Architecture) yields exactly the 8 expected standard ids: `{A000001, A000291, A000406, A000424, A001652, A002201, A002281, A002812}`. Test: `test_pilot_file_standard_ids`.
- **AC-4** — After the Neo4j loader runs, at least one `:Application` node originally extracted from a Confluence drawio (e.g. A000291 from the LBP pilot) has `cmdb_linked=true` and is reachable via the `/api/graph/nodes/A000291` endpoint with non-empty `outbound` or `inbound` edges. Test: `test_neo4j_includes_confluence_extracted_app`.
- **AC-5** — Running `parse_confluence_drawios.py` twice in a row produces **0 new rows** on the second run (idempotency). Test: `test_parser_is_idempotent`.

## 5. Edge Cases

- **EC-1** — File on disk is missing (deleted, incomplete download). Parser logs and increments `missing_files`, continues.
- **EC-2** — File parses successfully but `parse_drawio_xml` returns empty `applications` list (e.g. decorative-only drawio or Tech_Arch-only content). Leave both tables empty for this attachment; count in `empty_results`.
- **EC-3** — File is not a valid drawio (broken XML, truncated). Catch exception, log at WARNING, increment `parse_errors`.
- **EC-4** — Pre-existing rows in the extraction tables from a previous partial run. `ON CONFLICT DO UPDATE SET ...` overwrites with new values, never duplicates.
- **EC-5** — Two different attachments yield apps with the same `standard_id` (e.g. A000001 appears in many diagrams). The loader's existing `MERGE (a:Application {app_id: ...})` handles this: the node is created once, multiple INVESTS_IN / INTEGRATES_WITH edges accumulate.
- **EC-6** — A confluence page with multiple drawio attachments (e.g. LBP has v1, v2, v3). Each file is parsed independently; apps from all versions are merged at the Neo4j layer via MERGE.
- **EC-7** — Application container with `fillColor=none` + standard CMDB A-id (e.g. ADM Support `A000038` in `adm 应用架构`). The container frame uses transparent fill so the child modules inside (International Mail, Badges, Meeting Room, ...) stay visible. Before the fix, `_is_legend` treated every `fillColor=none` cell as a decoration and dropped it, so the container never entered `applications` and the geometry-containment merge pass had no parent — the 53 child modules ended up in `confluence_diagram_app` as independent rows. Fix: `_is_legend` exempts cells whose value contains a standard id (`A\d{5,6}`) from the `fillColor=none` decoration filter. Regression test: `test_fill_none_container_with_a_id_merges_children` in `test_confluence_drawio_extract.py`.
- **EC-8** — Resolver-wipe on re-parse. `process_one()` does an atomic per-attachment rebuild (DELETE then INSERT) so that cells dropped from a new parse — e.g. child modules merged into a container by EC-7 — don't linger as stale orphans. The side effect is that the three resolver-managed columns (`resolved_app_id`, `match_type`, `name_similarity`) are wiped to NULL on every re-parse of an attachment. Before the fix, the resolver was a separate manual step: after a full rebuild, ~14k rows (30% of the table) were left with `match_type IS NULL`, and the admin Extracted tab rendered every one of them as "— NO CMDB" even when the drawio A-id existed in CMDB (e.g. A000001 Authentication Service on the E-security Solution Design page). Fix: `scripts/parse_confluence_drawios.py` invokes `scripts/resolve_confluence_drawio_apps.py` as a subprocess at end of `main()` (skippable via `--no-resolve`). Regression test: `test_no_null_match_type_after_parse` in `test_confluence_drawio_extract.py` asserts zero rows have NULL `match_type` whenever rows with `standard_id` exist.

## 6. API impact

None directly. This is an ingestion-layer feature. Future iteration: `/api/admin/attachments/{id}/extracted_apps` endpoint to surface the extraction in the Attachments tab.

## 7. Affected files

- `backend/sql/011_confluence_diagram_extract.sql` (new) — tables + indexes
- `scripts/parse_confluence_drawios.py` (new) — extraction pipeline
- `scripts/load_neo4j_from_pg.py` (modified) — new block to process confluence_diagram_app rows
- `api-tests/test_confluence_drawio_extract.py` (new) — 5 ACs
- `scripts/test-map.json` (modified) — wire new test

## 8. Out of scope

- Parser improvements beyond bug-fixes driven by observed mis-extractions (net-new shape support, new diagram types) — we use the existing drawio_parser as-is. Bug-fixes like EC-7 are tracked here because they change extraction output visible in `confluence_diagram_app`.
- Admin UI changes to display extracted apps inline on the attachment viewer (Phase 2)
- Tech_Arch extraction from Confluence drawios — App_Arch only for now (matches existing loader behaviour)
- Reverse-linking `:Application` nodes to their source drawio page via `DESCRIBED_BY` — already happens for EGM and will carry over because Confluence-only diagrams already get `:Diagram` nodes
