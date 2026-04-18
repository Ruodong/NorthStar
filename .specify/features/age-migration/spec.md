# Neo4j → Apache AGE Migration

| Field   | Value                |
|---------|----------------------|
| Author  | Ruodong Yang         |
| Date    | 2026-04-17           |
| Status  | Draft                |

---

## 1. Context

NorthStar's graph layer currently runs on **Neo4j 5 Community Edition** as a
separate container (`northstar-neo4j`) on server 71. The two-layer
architecture (Postgres = system of record, Neo4j = derived projection) is
documented in `CLAUDE.md` and enforced by `scripts/load_neo4j_from_pg.py` as
the sole Neo4j writer.

This migration replaces Neo4j with **Apache AGE**, a Postgres extension that
adds openCypher support directly to the existing `northstar-postgres`
container. The strategic wins:

- **One fewer container.** Graph data lives in PG schemas; no second DB to run,
  monitor, back up, or upgrade. RAM footprint on 71 drops by ~1-2 GB.
- **Strict OSI open source.** AGE is Apache 2.0 (Apache Software Foundation
  incubating project). Neo4j CE is GPLv3 with commercial-use restrictions via
  the "Neo4j Sweden Trademark License" — AGE removes that ambiguity.
- **Architecture alignment.** The "Neo4j is a projection of Postgres"
  invariant becomes *literally true* — the graph is a derived schema inside
  the same DB. Cross-DB consistency issues disappear.
- **Unified transactions.** Loader can (optionally) wrap PG + graph writes in
  a single transaction. Not currently planned, but the option opens up.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Install AGE into existing `northstar-postgres` via `apache/age:PG16_latest` image** rather than spinning up a second PG instance | Zero-cost reuse. The AGE image is `postgres:16` + compiled extension; identical ops surface. |
| **Graph name = `ns_graph` (single graph)** | Cannot use `northstar` because AGE's `create_graph` creates a schema with the graph name, and `northstar` schema is already occupied by relational tables (from `001_init.sql`). Short prefix `ns_` keeps queries compact. |
| **Keep the `run_query(cypher, params)` + `run_write(cypher, params)` abstraction in a new `graph_client.py`** — internally wrap each call in `SELECT * FROM cypher('ns_graph', $$...$$, $1) as (...)` | All 48 router/service Cypher sites stay unchanged at call-site. The agtype↔dict marshalling is localised. |
| **Result shape: one `agtype` column per Cypher `RETURN` expression**, declared in the SQL wrapper's `AS (col1 agtype, col2 agtype, ...)` clause | Preserves Neo4j driver's `record.data()` semantics (dict keyed by RETURN aliases). Auto-parsing via a regex of the Cypher RETURN clause. |
| **Parameter passing via a single `jsonb` argument** (AGE's native idiom), not positional $1/$2 | Matches `neo4j` Python driver's `params: dict` signature — zero change to callers. |
| **Uniqueness enforced via PostgreSQL `UNIQUE INDEX` on AGE's vertex tables**, not Cypher `CREATE CONSTRAINT` (unsupported in AGE) | AGE stores each label as a table `<graph>.<label>` with a `properties` agtype column; we index `((properties->>'app_id'))`. Semantically equivalent. |
| **Migrate via 3 sequential PRs (infra → dual-write → cutover)** rather than big-bang | Preserves rollback at every step. After PR 1, Neo4j still runs. After PR 2, both stores agree. PR 3 flips the switch and removes Neo4j. |
| **Fork the loader** to `scripts/load_age_from_pg.py` during PR 2 (dual-write) rather than mutating the existing loader in place | Lets us run both loaders on the same PG data and diff results. Merges back into a single loader in PR 3. |
| **No data export/import** — AGE graph rebuilt from PG on PR 1 via the existing loader invariant (data is a projection) | Saves the pain of `neo4j-admin dump` + custom import. The loader is already the canonical source. |
| **Keep `NEO4J_*` env var names during PR 1 + PR 2** for minimal diff; rename to `GRAPH_*` in PR 3 | Reduces cross-cutting churn in early PRs. Renaming is a trivial sed once everything works. |

---

## 2. Functional Requirements

### 2.1 Infrastructure (PR 1)

| ID | Requirement |
|----|-------------|
| FR-INF-1 | The `postgres` service in `docker-compose.yml` MUST use `apache/age:PG16_latest` (or pinned equivalent) instead of `postgres:16`. |
| FR-INF-2 | Existing `postgres_data` volume MUST remain unchanged — AGE adds a shared library, not schema changes to existing tables. |
| FR-INF-3 | A new SQL migration `backend/sql/018_enable_age.sql` MUST `CREATE EXTENSION IF NOT EXISTS age;` and invoke `ag_catalog.create_graph('ns_graph')` wrapped in an idempotent DO block (no-op if graph already exists). |
| FR-INF-4 | On backend startup, after migrations run, the PG session MUST be able to execute a trivial `cypher('ns_graph', $$MATCH (n) RETURN count(n)$$) as (c agtype)` query successfully. |
| FR-INF-5 | Neo4j service (`northstar-neo4j`) MUST keep running through PR 1 and PR 2 — removed only in PR 3. |

### 2.2 Graph Client (PR 2)

| ID | Requirement |
|----|-------------|
| FR-CLT-1 | A new module `backend/app/services/graph_client.py` MUST expose `connect()`, `close()`, `ensure_schema()`, `run_query(cypher, params)`, `run_write(cypher, params)` with the **same signatures** as `neo4j_client.py`. |
| FR-CLT-2 | `run_query` MUST return `list[dict[str, Any]]` where each dict is keyed by the Cypher RETURN aliases (same shape as Neo4j driver's `record.data()`). |
| FR-CLT-3 | `run_query` and `run_write` MUST accept `params: dict[str, Any]` and marshal them into a single JSONB parameter for AGE. Cypher placeholders `$name` in the query MUST work transparently. |
| FR-CLT-4 | `agtype` values MUST be decoded into native Python types: nodes/edges → `dict`, lists → `list`, scalars → their native type. Graph element metadata (`_id`, `_label`, etc.) MAY be dropped unless the test suite needs it. |
| FR-CLT-5 | `ensure_schema()` MUST create the graph (idempotent) and install `UNIQUE INDEX` equivalents for the 4 existing Neo4j constraints (app_id, project_id, diagram_id, page_id). |
| FR-CLT-6 | The module MUST use asyncpg (already a dependency) and share the same DSN as `pg_client.py` — no second connection pool. |

### 2.3 Loader (PR 2)

| ID | Requirement |
|----|-------------|
| FR-LDR-1 | `scripts/load_age_from_pg.py` MUST produce a semantically identical graph to `scripts/load_neo4j_from_pg.py` for the same PG state, measured by: node counts per label, edge counts per type, and per-entity property equivalence. |
| FR-LDR-2 | The AGE loader MUST remain idempotent — `--wipe` followed by a full load MUST produce identical state regardless of run count. |
| FR-LDR-3 | The AGE loader MUST respect the same ontology invariants listed in `CLAUDE.md` (no `source_project_id` on Application nodes, INVESTS_IN carries fiscal_year, etc.). |
| FR-LDR-4 | `applications_history` + `ingestion_diffs` snapshotting MUST still run after AGE writes complete. Failures in this stage MUST NOT abort the loader. |

### 2.4 Cutover (PR 3)

| ID | Requirement |
|----|-------------|
| FR-CUT-1 | Backend router imports of `neo4j_client` MUST be replaced with `graph_client` — no Cypher query strings change. |
| FR-CUT-2 | `docker-compose.yml` MUST no longer contain a `neo4j` service; `neo4j_data` and `neo4j_logs` volumes MUST be removed. |
| FR-CUT-3 | `CLAUDE.md` "Data Architecture (Two-Layer)" section MUST be rewritten to reflect the single-layer architecture with AGE as an internal graph schema. |
| FR-CUT-4 | `api-tests/conftest.py` `cypher` fixture MUST switch from the `neo4j` bolt driver to psycopg against the AGE graph, preserving the `cypher(query, **params) → list[dict]` signature so test files need no changes. |
| FR-CUT-5 | `scripts/weekly_sync.sh` MUST invoke the AGE loader, not the Neo4j loader. |
| FR-CUT-6 | `backend/CLAUDE.md` + `.env.example` MUST drop all references to Neo4j. |

---

## 3. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Migration MUST be reversible at each PR boundary. A rollback means reverting the single merge commit. |
| NFR-2 | p95 latency of `GET /api/apps/{id}` after cutover MUST be within 2× the Neo4j baseline. If AGE's variable-length path queries (`*1..3`) blow up, we stop and re-plan. |
| NFR-3 | Loader wall-time after cutover MUST be within 2× the Neo4j baseline (currently ~90s for full rebuild on 71). |
| NFR-4 | The AGE extension MUST be pinned — `apache/age:PG16_latest` gets re-tagged; we pin to a specific digest in `docker-compose.yml`. |
| NFR-5 | No test regressions — the full `pytest api-tests/` suite MUST pass after PR 3. |
| NFR-6 | All new Cypher-via-SQL wrapping MUST use parameterised queries — no string interpolation of user input. |

---

## 4. Acceptance Criteria

| ID | Given / When / Then | Ref |
|----|---------------------|-----|
| AC-1 | **Given** PR 1 merged, **When** `docker compose up -d --build backend postgres` on 71, **Then** backend starts, `ensure_sql_migrations()` creates the `northstar` graph, and `GET /api/health` returns 200. | FR-INF-1..5 |
| AC-2 | **Given** PR 2 merged and loader run, **When** running a diff script comparing Neo4j vs AGE node/edge counts, **Then** counts match exactly per label/type. | FR-LDR-1 |
| AC-3 | **Given** PR 2 merged, **When** calling `GET /api/apps/{id}` for 10 sampled app_ids, **Then** the response JSON equals the Neo4j-backed response (modulo map ordering). | FR-CLT-2, FR-LDR-1 |
| AC-4 | **Given** PR 3 merged, **When** running `pytest api-tests/ -v`, **Then** all tests pass with no `neo4j` driver in the loop. | FR-CUT-4, NFR-5 |
| AC-5 | **Given** PR 3 merged, **When** inspecting `docker ps` on 71, **Then** no `northstar-neo4j` container exists. | FR-CUT-2 |
| AC-6 | **Given** PR 3 merged, **When** running `GET /api/apps/{id}/reverse-dependency?depth=3` for a high-fan-out app, **Then** the response returns within 2× the pre-migration p95 latency. | NFR-2 |
| AC-7 | **Given** any phase, **When** running the loader twice back-to-back with `--wipe`, **Then** final AGE state is byte-identical between runs. | FR-LDR-2 |

---

## 5. Edge Cases

| ID | Scenario | Expected Behavior |
|----|----------|-------------------|
| EC-1 | `create_graph('northstar')` called on a PG that already has the graph | Wrapped in a DO block checking `ag_catalog.ag_graph` — no-op if exists. |
| EC-2 | Cypher query returns zero columns (e.g., a pure write `MERGE ... RETURN`) | `run_write` ignores columns; does not crash on empty column list. |
| EC-3 | `agtype` scalar contains an embedded newline or quote | JSONB parser handles escape correctly; no SQL injection or parse error. |
| EC-4 | Cypher uses `$list` parameter with a Python `list[str]` | JSONB array; AGE accepts `IN $list` — verify with unit test. |
| EC-5 | Backend starts before PG extension is installed (cold start race) | `ensure_sql_migrations()` runs `CREATE EXTENSION` before any Cypher call; if extension load fails, backend startup aborts with a clear error. |
| EC-6 | PR 2 period: both loaders run the same day | Neither loader reads from the other; they write to distinct stores. Safe. |
| EC-7 | A Cypher query uses Neo4j-only function (e.g., `elementId()`, `apoc.*`) | Would fail at AGE time. We grep-verified none exist; if one slips in, the `graph_client.py` error message includes the offending function name. |
| EC-8 | Reverse-dependency query `*1..3` on a 50-degree hub app | AGE may plan this as a recursive CTE; measured latency is the gate. If >2× baseline, we add query-level `LIMIT`s earlier or pre-compute paths. |

---

## 6. API Contracts

**No external API contracts change.** All backend routes keep their snake_case
JSON schemas. This is an infrastructure substitution, not a product feature.

---

## 7. Data Models

### 7.1 Graph model (unchanged semantics)

Labels (`:Application`, `:Project`, `:Diagram`, `:ConfluencePage`) and edges
(`INVESTS_IN`, `INTEGRATES_WITH`, `HAS_DIAGRAM`, `DESCRIBED_BY`,
`HAS_CONFLUENCE_PAGE`, `HAS_REVIEW_PAGE`) are preserved. Properties on nodes
and edges are unchanged.

### 7.2 Physical storage (AGE-specific)

AGE creates a schema `ns_graph` inside the PG DB (distinct from the existing
`northstar` relational schema). Inside it:

- One table per node label: `ns_graph."Application"`, `ns_graph."Project"`, etc.
  Each has columns `id bigint`, `properties agtype`.
- One table per edge type: `ns_graph."INVESTS_IN"`, etc.
  Each has columns `id bigint`, `start_id bigint`, `end_id bigint`, `properties agtype`.
- `ag_catalog.ag_graph` / `ag_catalog.ag_label` metadata tables.

These are internal to AGE. The loader and client never address them
directly; all access goes through `cypher(...)`.

### 7.3 Indexes (replaces Neo4j constraints)

```sql
-- Uniqueness (replaces Neo4j CREATE CONSTRAINT)
CREATE UNIQUE INDEX IF NOT EXISTS app_id_uniq
    ON ns_graph."Application" ((properties->>'app_id'));
CREATE UNIQUE INDEX IF NOT EXISTS project_id_uniq
    ON ns_graph."Project" ((properties->>'project_id'));
CREATE UNIQUE INDEX IF NOT EXISTS diagram_id_uniq
    ON ns_graph."Diagram" ((properties->>'diagram_id'));
CREATE UNIQUE INDEX IF NOT EXISTS page_id_uniq
    ON ns_graph."ConfluencePage" ((properties->>'page_id'));

-- Filter indexes (replaces Neo4j CREATE INDEX)
CREATE INDEX IF NOT EXISTS app_status_idx
    ON ns_graph."Application" ((properties->>'status'));
CREATE INDEX IF NOT EXISTS app_cmdb_linked_idx
    ON ns_graph."Application" ((properties->>'cmdb_linked'));
CREATE INDEX IF NOT EXISTS project_fy_idx
    ON ns_graph."Project" ((properties->>'fiscal_year'));
CREATE INDEX IF NOT EXISTS diagram_type_idx
    ON ns_graph."Diagram" ((properties->>'diagram_type'));
CREATE INDEX IF NOT EXISTS invests_in_fy_idx
    ON ns_graph."INVESTS_IN" ((properties->>'fiscal_year'));
```

Label tables (`ns_graph."Application"` etc.) don't exist until the loader
creates them via AGE's `create_vlabel` / `create_elabel` (or implicitly on
first MERGE). `graph_client.ensure_schema()` (introduced in PR 2) runs
`create_vlabel` / `create_elabel` idempotently then applies these indexes,
so the order is: extension → graph → labels → indexes.

---

## 8. Affected Files

### Backend
- `backend/app/services/graph_client.py` — **NEW** (replaces `neo4j_client.py` semantically)
- `backend/app/services/neo4j_client.py` — **DELETED** in PR 3
- `backend/app/services/graph_query.py` — 1-line import swap in PR 3
- `backend/app/services/ingestion.py` — 1-line import swap in PR 3
- `backend/app/routers/admin.py` — 1-line import swap in PR 3
- `backend/app/main.py` — `ensure_schema()` caller updated in PR 3
- `backend/app/config.py` — may gain `GRAPH_NAME=northstar` setting (or keep hardcoded)

### Database
- `backend/sql/018_enable_age.sql` — **NEW** (extension + graph, no indexes yet — those move into graph_client.ensure_schema in PR 2 because they need label tables to exist)

### Docker
- `docker-compose.yml` — postgres image swap in PR 1, neo4j service removal in PR 3

### Scripts
- `scripts/load_age_from_pg.py` — **NEW** in PR 2 (forked from neo4j loader)
- `scripts/load_neo4j_from_pg.py` — **DELETED** in PR 3 (merged back as the only loader)
- `scripts/weekly_sync.sh` — 1-line stage 2 command update in PR 3
- `scripts/load_neo4j_from_confluence.py`, `scripts/ingest.py` — legacy alt loaders, updated only if still in use at PR 3 time (decide then)

### Tests
- `api-tests/conftest.py` — `cypher` fixture + `neo4j_driver` fixture rewritten in PR 3

### Env / Config
- `.env.example` — NEO4J_* keys removed in PR 3
- `backend/CLAUDE.md` — Neo4j mentions updated in PR 3
- `CLAUDE.md` — "Data Architecture (Two-Layer)" rewritten in PR 3

---

## 9. Test Coverage

### Existing tests that MUST continue to pass
| Test File | Covers |
|-----------|--------|
| `api-tests/test_ontology.py` | Ontology invariants (checks Cypher returns expected shapes) |
| `api-tests/test_deployment.py` | Smoke tests on running stack |
| `api-tests/test_ea_documents.py`, `test_confluence_child_pages.py`, etc. | All API-level tests that transitively exercise the graph |

### New tests
| Test File | Covers |
|-----------|--------|
| `api-tests/test_age_parity.py` (PR 2) | For each of 5 canonical queries, assert Neo4j and AGE return the same result set. Marked `@pytest.mark.slow`. Deleted in PR 3 (Neo4j is gone). |
| `api-tests/test_graph_client.py` (PR 2) | Unit-level: agtype decoding, param passing, connection lifecycle. |

---

## 10. Cross-Feature Dependencies

### This feature depends on:

| Feature | Dependency Type | Details |
|---------|----------------|---------|
| ontology-fix | Semantic | The new AGE graph must preserve ontology-fix's invariants byte-for-byte. |

### Features that depend on this:

*All graph-backed features* — reverse-dependency, full-graph visualization,
top-hubs, KPI integration counts, FY trend. Any regression here cascades.
Priority test coverage: `graph_query.py::reverse_dependency` +
`full_graph` + `kpi_summary`.

---

## 11. State Machine / Workflow

### Migration phasing

```
State A: Neo4j only (current)
    ↓ PR 1 merged
State B: PG has AGE extension + empty graph; Neo4j still authoritative
    ↓ PR 2 merged + load_age_from_pg.py run once
State C: AGE populated; backend still reads from Neo4j; loader writes both
    ↓ PR 3 merged
State D: AGE authoritative; Neo4j container removed
```

Rollback from each state:
- B → A: revert PR 1 merge. AGE extension lingers but unused; PG volume unaffected.
- C → B: revert PR 2 merge. AGE graph data lingers; unused.
- D → C: revert PR 3 merge. Neo4j service returns, but volume is gone — need a rebuild. **This is the only lossy rollback window.** We mitigate by keeping a manual `neo4j-admin dump` taken immediately before PR 3 deploy.

---

## 12. Out of Scope / Future Considerations

| Item | Reason |
|------|--------|
| Shared-DB mode (NorthStar as co-tenant in corp PG) | CLAUDE.md allows it in theory; AGE requires DBA install of the extension, which may not be possible in a shared DB. Deferred until a real shared-DB deployment is requested. |
| Multi-graph (per-FY snapshots) | Potentially useful ("show me FY2526 as of April"), but no user has asked. Deferred. |
| Removing `neo4j` Python package from requirements | Done in PR 3 as part of cleanup, no separate work. |
| Rewriting Cypher to use PG-native SQL/graph queries | Would give us better planner control but blows up the change surface. Keep Cypher. |
| AGE property indexes on edge properties beyond `INVESTS_IN.fiscal_year` | Add only if a query shows up in slow logs. Premature optimization otherwise. |
| Backup strategy for AGE graph data | Inherits PG backup (`pg_dump` covers extension data). No separate process needed. Document in runbook post-cutover. |
| Removing `NEO4J_*` env vars entirely vs renaming to `GRAPH_*` | Done in PR 3. If renaming churn becomes noisy, we may keep `NEO4J_*` as a harmless alias — decide at PR 3 review. |
