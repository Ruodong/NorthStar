# Backend — NorthStar FastAPI

See root `CLAUDE.md` for project-wide rules. This file only covers backend-specific conventions.

- Entry: `app/main.py`. Backend runs in `network_mode: host` (so it can reach the corp Lenovo S3 endpoint via host VPN) — uvicorn binds directly to host port 8001. There is no internal-vs-host port mapping.
- **Data layout**: ONE Postgres. Relational tables live in the `northstar.*` schema (`app/services/pg_client.py`). The graph lives inside the same Postgres via the **Apache AGE** extension in the `ns_graph` schema/graph (`app/services/neo4j_client.py` — name preserved for legacy reasons; internally wraps openCypher in `SELECT * FROM ag_catalog.cypher('ns_graph', $$ ... $$)`). Standalone Neo4j was migrated out on 2026-04-17.
- Responses are **snake_case** — do NOT map to camelCase. Frontend consumes snake_case directly.
- Wrap all responses in `ApiResponse[T]` from `app/models/schemas.py` (`{success, data, error}`).
- **Schema evolution (two-layer, as of 2026-04-17):**
  - **Baseline (frozen)**: `backend/sql/001..018_*.sql`. Flat idempotent SQL auto-applied on startup by `ensure_sql_migrations()`. Do NOT add new flat files — this layer is immutable.
  - **Forward (Alembic)**: `backend/alembic/versions/NNN_*.py` from `002_*` onwards. Versioned via `northstar.alembic_version`. Applied via `alembic upgrade head`, gated by env-sync. Additive only; downgrades syntactically valid; no data migrations (write a script in `scripts/` for backfill).
- Never write the AGE graph from router code — the graph is a projection of relational data. Writes live in `scripts/load_age_from_pg.py`. Exception: `scripts/ingest.py` + `backend/app/services/ingestion.py` (the interactive Confluence ingest pipeline) — on the cleanup list.
- Ontology invariants (see root CLAUDE.md): `:Application` nodes carry **no** `source_project_id` / `source_fiscal_year`. Use `(:Project)-[:INVESTS_IN {fiscal_year}]->(:Application)`. Non-CMDB apps get diagram-scoped hash ids (`X + sha256(name|diagram_id)[:12]`) — never collapse by name alone.
- No auth, no RBAC — internal network only.
- **Tests**:
  - Run: `python3 -m pytest api-tests/ -v --tb=short` (from repo root, not `backend/`).
  - On 71: `/home/ruodong/.local/bin/pytest` (the system-installed one; `.venv-tests` is present but missing pytest).
  - Shared fixtures: `api-tests/conftest.py` (`api` = httpx.AsyncClient, `pg` = asyncpg conn, `cypher` = AGE read-only query helper).
  - Affected-tests only: `scripts/test-map.json` + `scripts/run-affected-tests.sh`.
  - App Detail `/api/graph/nodes/{app_id}` response is covered by `api-tests/test_graph_capability_count.py` (asserts `capability_count` field consistency with business-capabilities endpoint).
