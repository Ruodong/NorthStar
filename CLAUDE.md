# NorthStar — IT Architect Workbench

## Project Context

NorthStar is Lenovo's internal IT architecture reference tool. It builds a queryable knowledge graph of applications, projects, and integrations by extracting data from Confluence draw.io diagrams and mirroring EGM/EAM master data into Postgres.

**Strategic positioning:** architect's daily-use reference tool (NOT a governance dashboard for management, NOT a workflow tool for review meetings). Core user loop: search → view app detail → understand impact.

**Source of truth for strategy:** `~/.gstack/projects/Ruodong-NorthStar/ceo-plans/2026-04-10-architect-workbench.md`. When evaluating scope additions, check that document first. Do not drift from "architect reference tool" positioning without explicit user approval.

## Project Structure

- `backend/` — FastAPI (Python), entry: `backend/app/main.py`. Runs in `network_mode: host` so it can reach Lenovo's internal S3 endpoint via host VPN — uvicorn binds directly to host port 8001 (no internal-vs-host mapping).
- `backend/sql/` — flat SQL migrations, auto-applied on backend startup (see Schema Evolution below)
- `frontend/` — Next.js 15 + React 19 + TypeScript, container port 3000 → host 3003
- `api-tests/` — pytest API integration tests
- `scripts/` — sync scripts, loaders, host-side ingestion utilities
- `.specify/features/` — feature specs (SpecKit format)
- `.claude/skills/` — closed-loop workflow + speckit commands
- `data/` — local drawio files + Confluence attachment cache (read-only in containers)

## Language & Communication Rules

- Detect and match the language of the user's input
- If the user writes in Chinese, respond in Simplified Chinese (简体中文)
- If the user writes in English, respond in English
- Never respond in Korean, Japanese, or any other language
- Code, variable names, function names, and technical terms always remain in English (e.g. "loader", "ontology", "INVESTS_IN", "INTEGRATES_WITH", "CMDB", "reverse dependency", "fan-out cap")
- Chinese is used ONLY for conversational prose; all technical vocabulary, operations, and concepts prefer English even within Chinese responses
- When language is ambiguous, default to English

## Data Architecture (Two-Layer)

NorthStar has a deliberate two-layer data model. Understand this before touching the data path.

**Layer 1 — Postgres (System of Record):**
- Container `northstar-postgres`, host port 5434, schema `northstar`
- Mirrored master data: `ref_application` (CMDB), `ref_project` (MSPO), `ref_employee`, `ref_request`, `ref_diagram` (with raw drawio_xml), `ref_application_tco`
- Confluence raw data: `confluence_page`, `confluence_attachment`
- NorthStar-owned: `applications_history`, `ingestion_diffs`, `manual_app_aliases`, `pending_app_merge`, `app_normalized_name`
- **Writes come from:** `scripts/sync_from_egm.py` (master data from EGM/EAM, host-side with VPN), `scripts/scan_confluence.py` (Confluence pages, host-side), `/api/admin/aliases/*` (human review decisions), backend `ensure_sql_migrations()` (schema)

**Layer 2 — Neo4j (Derived Projection):**
- Container `northstar-neo4j`, host port 7687, no schemas (Neo4j CE)
- Nodes: `:Application`, `:Project`, `:Diagram`, `:ConfluencePage`
- Relationships: `INVESTS_IN`, `INTEGRATES_WITH`, `HAS_DIAGRAM`, `DESCRIBED_BY`, `HAS_CONFLUENCE_PAGE`, `HAS_REVIEW_PAGE`
- **Writes come from ONE path:** `scripts/load_neo4j_from_pg.py` (idempotent, rebuild-from-PG). Backend does NOT write Neo4j outside the loader.
- `scripts/ingest.py` and `scripts/load_neo4j_from_confluence.py` exist but are legacy alternate loaders — use them only for ad-hoc experiments, not as the primary path.

**Invariant: Neo4j is a projection of Postgres.** If you find yourself writing Neo4j from the FastAPI routers, stop and rethink. Data flows PG → loader → Neo4j, never the reverse.

## Ontology Invariants (MANDATORY — DO NOT VIOLATE)

These rules were locked in during the 2026-04-10 ontology repositioning. They override any conflicting pattern you might find in old code or docs.

1. **`:Application` nodes MUST NOT carry `source_project_id` or `source_fiscal_year`.** An application is a long-lived entity; it does not "belong to" a project. Multiple projects invest in the same app over time.

2. **Project → App ownership is expressed via `(:Project)-[:INVESTS_IN {fiscal_year, review_status, source_diagram_id, last_seen_at}]->(:Application)`.** The fiscal year lives on the edge, not on the node. A single app can have N investment edges from N different projects in N different years.

3. **Non-CMDB apps get diagram-scoped hash ids (`X + sha256(name|diagram_id)[:12]`).** Never collapse non-CMDB apps by name alone — two different "订单系统" in different domains would wrongly merge. Manual alias overrides go through `northstar.manual_app_aliases`, reviewed at `/admin/aliases`.

4. **`:Diagram` is unified across EGM and Confluence sources.** The `source_systems` array property tracks provenance. The loader soft-matches via `diagram_identity_key(file_name, project_id)`. Diagrams without parseable graph data (`has_graph_data=false`) — image/PDF tech arch — still get nodes so `:Application -[:DESCRIBED_BY]-> :Diagram` can link them.

5. **App search surface = Postgres, not Neo4j.** PG holds the full CMDB (3168 apps) and trigger projects (2356), while Neo4j only holds what's been extracted from diagrams. `/api/search` queries PG via `pg_trgm` + `tsvector`. Architects can search for an app that doesn't have a Neo4j node and still land on the App Detail Page; the page gracefully degrades when Neo4j data is absent.

If you need to change any of the above, stop and ask the user. These are strategic commitments, not implementation details.

## Development Servers

NorthStar is designed for **local edit → git push → remote pull** on server 71 (192.168.68.71). You do not run the stack locally on your laptop — you let 71 host it.

```bash
# Local: edit code, commit, push
git add . && git commit -m "..." && git push

# On 71: pull + rebuild the changed service
ssh northstar-server 'cd ~/NorthStar && git pull && docker compose up -d --build backend'
```

**Services on 71:**

| Service    | Host port | URL                                   |
|------------|-----------|---------------------------------------|
| Frontend   | 3003      | http://192.168.68.71:3003             |
| Backend    | 8001      | http://192.168.68.71:8001/docs        |
| Neo4j UI   | 7474      | http://192.168.68.71:7474             |
| Neo4j Bolt | 7687      | bolt://192.168.68.71:7687             |
| Postgres   | 5434      | `psql -h 192.168.68.71 -p 5434 -U northstar` |

**Rebuild rules:**
- `docker compose up -d --build backend` — backend code changes (picks up new routers, new SQL migrations)
- `docker compose up -d --build frontend` — frontend code changes
- Neo4j data persists in the `neo4j_data` volume; PG data in `postgres_data`
- Never `docker compose down -v` on 71 unless the user explicitly asks — that nukes both databases

## Closed-Loop Workflow (MANDATORY)

All code changes MUST follow `.claude/skills/closed-loop-development.md` (Assess → Doc → Code → Test → Verify).

Skip only for: documentation-only changes, test-only changes, dependency version bumps with no code changes.

### PRE-EDIT GATE (Enforced)

**Before writing ANY code (Edit/Write), Claude MUST output the following block. No exceptions.**

```
┌─ CLOSED-LOOP GATE ────────────────────────────┐
│ Task: <one-line description>                   │
│ Phase: <1-Assess | 2-Doc | 3-Code | 4-Test | 5-Verify> │
│ Impact: <L1 | L2 | L3 | L4>                   │
│ Risk: <Low | Medium | High>                    │
│ Feature Doc: <path or "N/A for L1">            │
│ Test Plan: <which tests will verify this>      │
└────────────────────────────────────────────────┘
```

**Rules:**
- Phase 1 (Assess) must complete BEFORE any Edit/Write tool call
- Phase 2 (Doc) must complete BEFORE Phase 3 (Code) for L2+ changes
- If Claude outputs an Edit/Write without this gate block in the same message, it is a workflow violation
- Multiple small fixes in one task are OK — one gate block covers the task, not each edit
- When user reports a bug: still assess first (impact + risk), then fix
- **Bug fix minimum:** Even L1 single-line fixes require the gate block. "Quick fix" is not a skip reason. Only documentation / test-only / dependency changes are exempt.
- **Gate file signal:** After outputting the gate block, Claude MUST run `touch /tmp/northstar-closed-loop-gate` via Bash BEFORE any Edit/Write call. A PostToolUse hook (`scripts/check-closed-loop-gate.sh`) checks this file; if missing or stale (>30 min), it prints a warning. Warnings are non-blocking but indicate a workflow violation to backfill.

**Phase completion enforcement (L2+):**
- **L2+ changes MUST use TodoWrite** to track all 5 phases
- Phase 2 (Doc) blocker: Claude MUST NOT call Edit/Write on source files until `.specify/features/<feature>/spec.md` exists
- Phase 4 (Test) blocker: Claude MUST NOT report task as "done" until api-test files exist and pass
- **Violation recovery:** If a phase was skipped (e.g., code written before doc), Claude must immediately backfill the skipped phase before proceeding

## Schema Evolution Rules (MANDATORY)

NorthStar does **NOT** use Alembic. SQL migrations are flat files in `backend/sql/` applied on backend container startup by `ensure_sql_migrations()` in `app/main.py`. This means migrations run EVERY startup, not just once.

**Rules for `backend/sql/NNN_*.sql` files:**

1. **Naming:** `NNN_short_description.sql` where NNN is a zero-padded 3-digit number, strictly monotonic. Conflicts are the author's responsibility — coordinate via git.
2. **Idempotent ONLY:** Every DDL statement must use `IF NOT EXISTS` / `IF EXISTS`. `CREATE EXTENSION IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. A non-idempotent migration will crash backend startup and keep crashing.
3. **Additive only:** NEVER `DROP COLUMN`, `RENAME COLUMN`, `RENAME TABLE`, `ALTER TYPE`. If you need to change a column's semantics, add a new column, backfill, and switch readers — never destructively alter.
4. **New columns MUST be nullable or have a `DEFAULT`** — existing data must keep working.
5. **All migrations SET `search_path TO northstar, public;`** at the top — the backend pool doesn't set it globally.
6. **No data migrations in SQL files** — if you need to backfill a value, write a Python script in `scripts/` instead. Keep DDL and data seeding separate.
7. **Extensions MUST pin to `public`** — any `CREATE EXTENSION` line MUST use `WITH SCHEMA public` explicitly (e.g. `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;`). NorthStar may be deployed in a dedicated DB (local Docker) OR co-tenant in a shared DB (e.g. corp `dxp_config_nacos` where pg_trgm already lives in `public`). Without `WITH SCHEMA public`, Postgres places the extension in the first `search_path` schema the user can `CREATE` in, which lands it in `northstar` locally but would collide with existing `public.pg_trgm` on shared DBs. Operator classes (`gin_trgm_ops`) must stay **unqualified** inside index DDL so they resolve via `search_path` regardless of actual location.

**Pre-Edit Gate for schema changes:** Before any `backend/sql/*.sql` Edit/Write, the CLOSED-LOOP GATE block must include:

```
│ Migration: backend/sql/NNN_xxx.sql              │
│ Additive Only: Yes (explain what's added)       │
│ Idempotent: Yes (all DDL uses IF NOT EXISTS)    │
```

## Loader Rules (scripts/load_neo4j_from_pg.py)

The Neo4j loader is the ONLY authoritative writer to Neo4j. Rules:

1. **Always idempotent** — running `load_neo4j_from_pg.py --wipe` twice must produce identical Neo4j state. No order-dependent writes.
2. **Read from PG, write to Neo4j** — never read from Confluence directly, never write back to PG except `applications_history` + `ingestion_diffs` (see What's New infra in `004_whats_new.sql`).
3. **Preserve ontology invariants** (see Ontology Invariants above). The `MERGE (a:Application)` block must never `SET a.source_project_id` or `SET a.source_fiscal_year`.
4. **Apply `manual_app_aliases`** — load the table once at start, pass to `derive_app_id()`, non-CMDB ids flow through the alias map.
5. **Emit diffs** — after all Neo4j writes, call `write_history_and_diffs()` to snapshot and compare. Failures here must NOT break the loader; wrap in try/except and log.
6. **`projects_merged` is counted by unique set, not per-diagram.** Stats counts must reflect entities, not write operations.

When editing the loader, re-read the top-of-file docstring and make sure your change doesn't silently break one of these rules. The loader is load-bearing for the entire product.

## Feature Specs (Single Source of Truth)

All feature documentation uses the **SpecKit** format at `.specify/features/<feature>/`:

- `spec.md` (EN) — core logic spec, always read by closed-loop. Contains: Context, FR, NFR, AC, Edge Cases, Affected Files, Test Coverage, State Machine, Out of Scope.
- `api.md` (EN) — API & data reference, read on demand when task involves API/schema. Contains: API contracts, table definitions, Cypher queries.
- `arch.md` (ZH) — architecture view for architects/stakeholders. Updated only when ontology/schema/permissions/dependencies change.
- Full template: `.specify/TEMPLATE.md`
- Generate via `/speckit-specify`; full pipeline via `/spec-driven-workflow`

## Testing

- Source → test mappings: `scripts/test-map.json` (single source of truth)
- `scripts/run-affected-tests.sh` — runs pytest only on tests affected by changed files
- New router → create `api-tests/test_<name>.py`, register in `main.py`, add to `test-map.json`
- Full suite: `cd /path/to/NorthStar && python3 -m pytest api-tests/ -v --tb=short`
- Tests are Python only — there is no Playwright E2E suite yet. Frontend verification is manual + `next build` in Docker.

## Design System

Always read `DESIGN.md` before making any visual or UI decisions. The aesthetic is **Orbital Ops** — dark base, single amber accent (`#f6a623`), sharp 2-6px radii, no gradients, no illustrations. All font choices, colors, spacing, and components are defined there. Do not deviate without explicit user approval.

In QA / design-review mode, flag any code that doesn't match DESIGN.md.

## Code Conventions

**Backend (FastAPI):**
- All responses use **snake_case** JSON keys — do NOT map to camelCase. The frontend consumes snake_case directly.
- Queries use asyncpg (PG) via `app/services/pg_client.py` (`fetch`, `fetchrow`, `fetchval`, `execute_script`).
- Cypher queries use async Neo4j driver via `app/services/neo4j_client.py` (`run_query`, `run_write`).
- No auth, no RBAC — NorthStar is internal network only. Never add `require_permission()`-style guards without asking first.
- Pydantic schemas live in `app/models/schemas.py`. Router responses wrap in `ApiResponse[T]` (`success`, `data`, `error`).
- Routers in `app/routers/*.py`, registered in `app/main.py`.

**Frontend (Next.js 15 + React 19):**
- No UI library. No Ant Design. Components are hand-written with inline styles referencing CSS custom properties from `globals.css` / DESIGN.md.
- API client: `@/lib/api` wraps fetch.
- Dynamic app detail route: `/apps/[app_id]`. New deep-linkable entities follow the same `/[entity]/[id]` pattern.
- Global command palette (`Cmd+K` / `/`) mounted in `layout.tsx` — if you add a new entity type, extend `CommandPalette.tsx` to include it.
- Font imports are Google Fonts (`Space Grotesk`, `Geist`, `JetBrains Mono`) loaded in `layout.tsx`.

**Scripts:**
- Host-side scripts (sync_from_egm, scan_confluence, load_neo4j_from_pg) run from `.venv-ingest` on 71 because the docker network can't reach EGM over VPN.
- Weekly automation: `scripts/weekly_sync.sh` wraps sync + loader + merge candidates. Cron-installed on 71.

## Plan Mode 规范

- 已经用户确认并执行过的 plan 步骤,不得再次提出确认
- 每个步骤执行完后,在回复开头明确标注 ✅ 已完成
- 不要在新的回复中重新列出整个 plan,只展示当前步骤