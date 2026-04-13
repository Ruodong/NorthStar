# NorthStar — IT Architect Workbench

NorthStar is Lenovo's internal IT architecture reference tool. It builds a queryable knowledge graph of applications, projects, and integrations by extracting data from Confluence draw.io diagrams and mirroring EGM/EAM master data into Postgres.

**Core user loop:** search an app name or ID &rarr; view its detail page &rarr; understand integrations, impact, and applicable standards &mdash; in seconds, not minutes.

## Screenshots

| Search (Cmd+K) | App Detail | Deployment Map |
|:-:|:-:|:-:|
| Unified search across apps, projects, EA standards | 8-tab detail page: Overview, Integrations, Deployment, Impact, Investments, Diagrams, Confluence, Knowledge Base | Geographic visualization with Prod/Non-Prod breakdown |

## Architecture

```
                    ┌──────────────────────┐
                    │   Next.js 15 + React 19  │  :3003
                    │   (Orbital Ops dark UI)   │
                    └───────────┬──────────┘
                                │
                    ┌───────────▼──────────┐
                    │   FastAPI (Python)     │  :8001
                    │   async PG + Neo4j     │
                    └──┬────────────────┬──┘
                       │                │
            ┌──────────▼──┐   ┌────────▼────────┐
            │  PostgreSQL  │   │   Neo4j CE       │
            │  (system of  │   │   (derived       │
            │   record)    │   │    projection)   │
            │  :5434       │   │   :7687          │
            └──────────────┘   └─────────────────┘
                   ▲                    ▲
                   │                    │
        ┌──────────┴──────────┐        │
        │  Host-side scripts   │────────┘
        │  (VPN required)      │
        │  sync_from_egm.py    │  EGM/EAM master data
        │  scan_confluence.py  │  Confluence pages & attachments
        │  sync_ea_documents.py│  EA Standards & Guidelines
        │  load_neo4j_from_pg  │  PG → Neo4j rebuild
        └─────────────────────┘
```

### Two-Layer Data Model

| Layer | Store | Role | Data |
|-------|-------|------|------|
| **Layer 1** | PostgreSQL | System of Record | CMDB apps (3,169), MSPO projects (2,325), employees (79K), Confluence pages, EA documents (131), deployment infra, TCO |
| **Layer 2** | Neo4j CE | Derived Projection | Application &rarr; Integration graph, Project &rarr; App investment edges, Diagram references |

**Invariant:** Data flows PG &rarr; loader &rarr; Neo4j, never the reverse. Backend routers never write to Neo4j.

## Features

### For Architects

- **Unified Search** &mdash; `Cmd+K` / `/` searches apps, projects, and EA standards simultaneously. PG `tsvector` + `pg_trgm` for typo-tolerant fuzzy matching.
- **App Detail Page** (`/apps/[app_id]`) &mdash; 8 tabs covering everything about an application:
  - **Overview** &mdash; CMDB metadata, owners, deployment summary, TCO, applicable EA standards
  - **Integrations** &mdash; upstream/downstream connections with business objects
  - **Deployment** &mdash; servers, containers, databases with geographic map visualization
  - **Impact Analysis** &mdash; 1/2/3-hop reverse dependency traversal via Neo4j
  - **Investments** &mdash; which projects invest in this app, across fiscal years
  - **Diagrams** &mdash; draw.io thumbnails grouped by project, with grid/list toggle
  - **Confluence** &mdash; EA review pages with parsed questionnaire sections
  - **Knowledge Base** &mdash; cross-space CQL search for pages mentioning this app
- **EA Standards & Guidelines** (`/standards`) &mdash; browse page for Lenovo EA standards, guidelines, reference architectures, and templates from the Confluence EA space, with domain and type filters.
- **What's New** (`/whats-new`) &mdash; weekly ingestion diffs showing added/changed/removed apps and integrations.
- **Reverse Dependency** &mdash; "If I decommission this system, who gets hurt?" answered in seconds.

### For Admins

- **Reference Data** (`/admin`) &mdash; browse and manage applications, projects, Confluence pages with full questionnaire rendering.
- **App Alias Management** &mdash; merge non-CMDB apps via fuzzy-match candidates review.
- **Ingestion Console** (`/ingestion`) &mdash; trigger draw.io parsing pipelines per fiscal year.

## Project Structure

```
NorthStar/
├── backend/                 # FastAPI (Python)
│   ├── app/
│   │   ├── main.py          # Entry + migration runner
│   │   ├── routers/         # API endpoints (graph, search, admin, ea_documents, ...)
│   │   ├── services/        # PG client, Neo4j client, Confluence search, draw.io parser
│   │   ├── models/          # Pydantic schemas (ApiResponse[T])
│   │   └── config.py        # Settings from .env
│   └── sql/                 # Flat SQL migrations (001-016), idempotent, auto-applied on startup
├── frontend/                # Next.js 15 + React 19 + TypeScript
│   └── src/
│       ├── app/             # Pages: /, /apps/[app_id], /dashboard, /standards, /admin, ...
│       ├── components/      # CommandPalette, DeploymentMap, Pager, StarMark
│       └── lib/             # API client wrapper
├── scripts/                 # Host-side data sync & loader scripts
│   ├── sync_from_egm.py     # EGM/EAM → PG (CMDB, MSPO, employees, TCO, deployment)
│   ├── scan_confluence.py   # Confluence ARD space → PG (pages, attachments, drawio refs)
│   ├── sync_ea_documents.py # Confluence EA space → PG (standards, guidelines, templates)
│   ├── load_neo4j_from_pg.py# PG → Neo4j (idempotent full rebuild)
│   ├── weekly_sync.sh       # Cron wrapper: 4-stage weekly pipeline
│   └── test-map.json        # Source → test file mapping
├── api-tests/               # pytest integration tests
├── data/                    # Local drawio files + Confluence attachment cache
├── .specify/features/       # Feature specs (SpecKit format)
├── docker-compose.yml       # 5 services: neo4j, postgres, backend, frontend, converter
├── CLAUDE.md                # AI assistant instructions (closed-loop workflow, ontology rules)
└── DESIGN.md                # Visual design system (Orbital Ops)
```

## Deployment

NorthStar runs on **server 71** (192.168.68.71). Development is local edit &rarr; git push &rarr; remote pull.

### Services

| Service | Container Port | Host Port | URL |
|---------|---------------|-----------|-----|
| Frontend | 3000 | 3003 | http://192.168.68.71:3003 |
| Backend API | 8000 | 8001 | http://192.168.68.71:8001/docs |
| Neo4j Browser | 7474 | 7474 | http://192.168.68.71:7474 |
| Neo4j Bolt | 7687 | 7687 | bolt://192.168.68.71:7687 |
| PostgreSQL | 5432 | 5434 | `psql -h 192.168.68.71 -p 5434 -U northstar` |

### First-Time Setup

```bash
ssh northstar-server
cd ~ && git clone https://github.com/Ruodong/NorthStar.git
cd NorthStar
cp .env.example .env   # edit: set passwords, Confluence token, etc.
docker compose up -d --build

# Host-side venv for sync scripts (needs VPN)
python3 -m venv .venv-ingest
.venv-ingest/bin/pip install -r scripts/requirements.txt
```

### Dev Loop

```bash
# Local: edit, commit, push
git add . && git commit -m "..." && git push

# On 71: pull + rebuild changed service
ssh northstar-server 'cd ~/NorthStar && git pull && docker compose up -d --build backend'
ssh northstar-server 'cd ~/NorthStar && git pull && docker compose up -d --build frontend'
```

### Weekly Sync (Cron)

`scripts/weekly_sync.sh` runs 4 stages every Monday at 08:00:

1. `sync_from_egm.py` &mdash; EGM/EAM master data &rarr; PG
2. `load_neo4j_from_pg.py --wipe` &mdash; PG &rarr; Neo4j full rebuild
3. `generate_merge_candidates.py` &mdash; fuzzy merge candidates (non-fatal)
4. `sync_ea_documents.py` &mdash; EA Confluence space documents (non-fatal)

```bash
# Install cron (crontab -e):
0 8 * * 1 /home/lenovo/NorthStar/scripts/weekly_sync.sh >> /var/log/northstar-sync.log 2>&1
```

## API Endpoints

| Prefix | Router | Description |
|--------|--------|-------------|
| `/api/search` | `search.py` | Unified search (apps + projects + EA docs) |
| `/api/graph/nodes/{app_id}` | `graph.py` | App detail (integrations, investments, diagrams) |
| `/api/graph/nodes/{app_id}/impact` | `graph.py` | Reverse dependency (1-3 hop) |
| `/api/graph/nodes/{app_id}/knowledge` | `graph.py` | Cross-space Confluence CQL search |
| `/api/ea-documents` | `ea_documents.py` | EA standards browse, filter, contextual match |
| `/api/analytics/*` | `analytics.py` | Dashboard summary, status distribution, trends |
| `/api/masters/*` | `masters.py` | Reference data (apps, projects, employees, deployment) |
| `/api/whats_new/*` | `whats_new.py` | Ingestion diffs timeline |
| `/api/admin/*` | `admin.py` | Confluence page admin, attachment preview |
| `/api/aliases/*` | `aliases.py` | App alias management (merge candidates) |
| `/api/ingestion/*` | `ingestion.py` | Draw.io ingestion pipeline |

Full OpenAPI docs: http://192.168.68.71:8001/docs

## Testing

```bash
# From repo root (needs PG + Neo4j accessible)
python3 -m pytest api-tests/ -v --tb=short

# Run only tests affected by a specific file change
./scripts/run-affected-tests.sh
```

Test-to-source mapping is defined in `scripts/test-map.json`.

## Design System

**Orbital Ops** &mdash; dark base, single amber accent (`#f6a623`), sharp 2-6px radii, no gradients, no illustrations.

| Role | Font | Usage |
|------|------|-------|
| Display | Space Grotesk | Page titles, KPI numbers |
| Body | Geist Sans | UI text, labels, descriptions |
| Data | JetBrains Mono | App IDs, code, tabular data |

See `DESIGN.md` for the complete design system specification.

## Data Sources

| Source | What | Sync Method |
|--------|------|-------------|
| EGM/EAM (ServiceNow) | CMDB applications, MSPO projects, employees, TCO, deployment infra | `sync_from_egm.py` (VPN required) |
| Confluence ARD Space | Project pages, draw.io diagrams, questionnaires, attachments | `scan_confluence.py` |
| Confluence EA Space | Standards, guidelines, reference architectures, templates | `sync_ea_documents.py` |
| Draw.io Diagrams | Application nodes, integration edges, business objects | `parse_confluence_drawios.py` + `resolve_confluence_drawio_apps.py` |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Next.js 15, React 19, TypeScript |
| Backend | Python, FastAPI, asyncpg, async Neo4j driver |
| Database | PostgreSQL 16 (pg_trgm + tsvector FTS) |
| Graph DB | Neo4j 5 Community Edition |
| Deployment | Docker Compose (5 containers) |
| Data Sync | httpx, psycopg, Confluence REST API |
| Design | Hand-written CSS, no UI library |
