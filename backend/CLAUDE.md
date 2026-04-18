# Backend — NorthStar FastAPI

See root `CLAUDE.md` for project-wide rules. This file only covers backend-specific conventions.

- Entry: `app/main.py`. Backend runs in `network_mode: host` (so it can reach the corp Lenovo S3 endpoint via host VPN) — uvicorn binds directly to host port 8001. There is no internal-vs-host port mapping.
- One database (Postgres), two logical layers: relational via `app/services/pg_client.py` (asyncpg) and graph via `app/services/graph_client.py` (asyncpg + Apache AGE extension). Neo4j was retired in 2026-04.
- Responses are **snake_case** — do NOT map to camelCase. Frontend consumes snake_case directly.
- Wrap all responses in `ApiResponse[T]` from `app/models/schemas.py` (`{success, data, error}`).
- SQL migrations: flat files in `backend/sql/NNN_*.sql`, auto-applied on startup by `ensure_sql_migrations()`. Every DDL must use `IF NOT EXISTS`. Additive only.
- Never write the graph from router code — the graph is a derived projection, writes live in `scripts/load_age_from_pg.py`. Exception: `backend/app/services/ingestion.py` (the interactive Confluence ingest pipeline).
- Ontology invariants (see root CLAUDE.md): `:Application` nodes carry **no** `source_project_id` / `source_fiscal_year`. Use `(:Project)-[:INVESTS_IN {fiscal_year}]->(:Application)`.
- No auth, no RBAC — internal network only.
- Tests: `python3 -m pytest api-tests/ -v --tb=short` (run from repo root, not `backend/`)
- Shared fixtures: `api-tests/conftest.py`
