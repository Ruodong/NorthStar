# Backend — NorthStar FastAPI

See root `CLAUDE.md` for project-wide rules. This file only covers backend-specific conventions.

- Entry: `app/main.py`, container port 8000 → host 8001
- Two data backends: Postgres (`app/services/pg_client.py`) and Neo4j (`app/services/neo4j_client.py`)
- Responses are **snake_case** — do NOT map to camelCase. Frontend consumes snake_case directly.
- Wrap all responses in `ApiResponse[T]` from `app/models/schemas.py` (`{success, data, error}`).
- SQL migrations: flat files in `backend/sql/NNN_*.sql`, auto-applied on startup by `ensure_sql_migrations()`. Every DDL must use `IF NOT EXISTS`. Additive only.
- Never write Neo4j from router code — Neo4j is a derived projection, writes live in `scripts/load_neo4j_from_pg.py`. Exception: `scripts/ingest.py` + `backend/app/services/ingestion.py` (the interactive Confluence ingest pipeline).
- Ontology invariants (see root CLAUDE.md): `:Application` nodes carry **no** `source_project_id` / `source_fiscal_year`. Use `(:Project)-[:INVESTS_IN {fiscal_year}]->(:Application)`.
- No auth, no RBAC — internal network only.
- Tests: `python3 -m pytest api-tests/ -v --tb=short` (run from repo root, not `backend/`)
- Shared fixtures: `api-tests/conftest.py`
