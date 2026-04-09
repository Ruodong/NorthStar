# NorthStar MVP Design Spec

## Overview

NorthStar is an IT operational command system inspired by Palantir's Ontology concept. It builds a queryable, navigable knowledge graph of IT architecture assets by extracting structured data from draw.io architecture diagrams stored in Lenovo's Confluence Architecture Review space.

**Primary users:** IT management
**Product form:** Independent web application
**MVP scope:** Application-level Ontology from architecture diagrams

## Problem Statement

Lenovo's Architecture & Solution Review Confluence space contains 5+ fiscal years (FY2122–FY2627) of IT project architecture reviews, each with standardized draw.io diagrams (App Architecture, Tech Architecture). This data is rich but siloed — trapped in individual project pages with no cross-project visibility, no dependency analysis, and no aggregate view for strategic decision-making.

## Progressive Data Integration Vision

NorthStar is designed for extensibility. The MVP focuses on architecture diagram extraction, but the Ontology model will progressively incorporate:

- Hardware / infrastructure data
- Data center information
- Operations / monitoring data
- Cost / financial data
- Organization structure
- Project investment data

## Four Target Capabilities

1. **Architecture Asset Graph** — queryable IT asset knowledge graph with interactive visualization
2. **Change Impact Analysis** — automated assessment of which systems are affected by new projects/changes
3. **Operational Situational Awareness** — system topology, health status, dependency chains
4. **Governance Dashboard** — tech debt, compliance scores, architecture quality metrics

MVP delivers capabilities 1 and 4; capabilities 2 and 3 are future phases.

---

## Ontology Data Model

### Core Entities (Neo4j Node Labels)

**Application**

| Property | Type | Description |
|----------|------|-------------|
| app_id | string | Standard ID from draw.io (e.g., "A003530"). For apps without standard ID, use deterministic hash: `sha256(name + source_project_id)[:12]` prefixed with "X" (e.g., "X3a7f2b1c9d0e") |
| name | string | Application name |
| status | enum | Keep, Change, New, 3rd Party, Sunset |
| description | string | System description and purpose |
| source_project_id | string | Origin project (e.g., "LI2500073") |
| source_fiscal_year | string | e.g., "FY2526" |
| last_updated | datetime | Last ingestion timestamp |

**Project**

| Property | Type | Description |
|----------|------|-------------|
| project_id | string | e.g., "LI2500073" |
| name | string | Project name |
| fiscal_year | string | e.g., "FY2526" |
| pm | string | Project manager |
| it_lead | string | IT lead |
| dt_lead | string | DT lead |
| review_status | string | Review status from change log |

### Core Relationships (Neo4j Relationship Types)

**INTEGRATES_WITH** (Application → Application)

| Property | Type | Description |
|----------|------|-------------|
| interaction_type | string | Command, Event, Service, Content |
| business_object | string | Extracted from draw.io edge label |
| status | enum | Keep, Change, New |
| protocol | string (optional) | HTTP, Kafka, JDBC, etc. Extracted from edge label when present; empty otherwise |

**INCLUDES** (Project → Application)
- Links a project to the applications it touches.

**DEPENDS_ON** — deferred to Phase 2. Will be derived from INTEGRATES_WITH direction at query time using Cypher traversal, not stored as a separate relationship.

### Future Extension Nodes (not in MVP)

```
DataCenter { name, location, region }
Server { hostname, ip, specs, datacenter_id }
Team { name, org_unit, lead }
CostCenter { code, budget, actual_spend }
TechStack { name, version, category }
```

Adding new entity types requires zero schema migration in Neo4j — just new node labels and relationship types.

---

## System Architecture

```
┌─────────────────────────────────────────────────────┐
│                   NorthStar Frontend                 │
│              Next.js 15 + React 19 + TypeScript      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Graph    │  │Dashboard │  │ Ingestion         │  │
│  │ Viewer   │  │          │  │ Console           │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└──────────────────┬──────────────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────────────┐
│                  NorthStar Backend                    │
│                 Python FastAPI                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Graph    │  │Analytics │  │ Ingestion         │  │
│  │ Query    │  │ Service  │  │ Pipeline          │  │
│  │ Service  │  │          │  │                   │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────────────┘  │
│       │              │              │                │
│  ┌────▼──────────────▼──┐    ┌─────▼─────────────┐  │
│  │    Neo4j Driver       │    │ DrawIO Parser     │  │
│  │                       │    │ (reuse from EGM)  │  │
│  └────────┬──────────────┘    │ AI Quality Eval   │  │
│           │                   └─────┬─────────────┘  │
└───────────┼─────────────────────────┼────────────────┘
            │                         │
     ┌──────▼──────┐          ┌───────▼────────┐
     │  Neo4j CE   │          │  Confluence    │
     │  (Docker)   │          │  REST API      │
     └─────────────┘          └────────────────┘
```

### Data Ingestion Pipeline

**Step 1: Collect** — Confluence REST API (`/rest/api/content`) traverses FY project pages, downloads .drawio attachments, extracts project metadata (ID, name, leads, fiscal year).

**Step 2: Parse** — Reuses EGM's `drawio_parser.py` to extract applications (name, ID, status from fillColor), interactions (type, business object, protocol from edge labels), and tech components.

**Step 3: Evaluate** — AI quality evaluation (reusing EGM's analysis patterns) assesses completeness (missing IDs, unlabeled edges), consistency (conflicting statuses across projects), and accuracy.

**Step 4: Load** — Neo4j `MERGE` statements upsert Application nodes and relationships. Idempotent — same app appearing in multiple projects is deduplicated by `app_id`. Content hash tracks changes for incremental updates.

### Key Design Decisions

1. **Confluence data via REST API** — not browser scraping. Reliable, paginated, supports attachment download.
2. **DrawIO Parser reuse** — copy EGM's `drawio_parser.py` into NorthStar as a service module. No cross-project dependency.
3. **Idempotent ingestion** — `MERGE` on `app_id` ensures no duplicates. Multiple projects referencing the same application create a single node with multiple `INCLUDES` edges.
4. **Incremental updates** — content hash per project page; only re-process changed projects.
5. **Neo4j via Docker** — `docker-compose.yml` includes Neo4j CE container for local dev and deployment.

### Neo4j Schema Setup

Run on first startup:

```cypher
CREATE CONSTRAINT app_id_unique IF NOT EXISTS
  FOR (a:Application) REQUIRE a.app_id IS UNIQUE;

CREATE CONSTRAINT project_id_unique IF NOT EXISTS
  FOR (p:Project) REQUIRE p.project_id IS UNIQUE;

CREATE INDEX app_status_idx IF NOT EXISTS
  FOR (a:Application) ON (a.status);

CREATE INDEX app_fy_idx IF NOT EXISTS
  FOR (a:Application) ON (a.source_fiscal_year);
```

### Confluence Authentication

MVP uses **Personal Access Token (PAT)** for Confluence REST API authentication. Token is passed via `CONFLUENCE_TOKEN` environment variable and sent as `Bearer` header. The token must have read access to the Architecture & Solution Review space (ARD).

### Failure Handling

- **Per-project isolation** — one corrupt draw.io file or API error does not abort the batch. Each project is processed independently; failures are logged and skipped.
- **Retry policy** — Confluence API calls retry up to 3 times with exponential backoff (1s, 2s, 4s) on 429/5xx responses.
- **Error persistence** — failed projects are recorded in the ingestion task result with error details, surfaced in the Ingestion Console.
- **Partial results** — successfully parsed projects are loaded into Neo4j even if others fail. The ingestion task status reflects "completed_with_errors" when partial failures occur.

---

## API Design

Standard response envelope:

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
```

### Graph Query API (`/api/graph`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/graph/nodes` | List all Application nodes. Query params: `status`, `fiscal_year`, `limit`, `offset` |
| GET | `/api/graph/nodes/{app_id}` | Get single Application with its relationships |
| GET | `/api/graph/nodes/{app_id}/neighbors` | Get N-hop neighbors. Query param: `depth` (default 1, max 3) |
| GET | `/api/graph/edges` | List all INTEGRATES_WITH edges. Query params: `status`, `interaction_type` |
| GET | `/api/graph/full` | Full graph data (nodes + edges) for Cytoscape.js rendering. Query params: `fiscal_year`, `status` |

### Analytics API (`/api/analytics`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/summary` | KPI cards: total apps, total integrations, new/sunset counts |
| GET | `/api/analytics/status-distribution` | Status breakdown (Keep/Change/New/Sunset/3rd Party) |
| GET | `/api/analytics/trend` | Per-FY change trend (new/changed/sunset counts) |
| GET | `/api/analytics/hubs` | Top N most-connected applications. Query param: `limit` (default 10) |
| GET | `/api/analytics/quality-scores` | AI evaluation score distribution |

### Ingestion API (`/api/ingestion`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ingestion/run` | Start ingestion. Body: `{ fiscal_years: string[] }` |
| GET | `/api/ingestion/tasks` | List ingestion tasks. Query params: `status`, `limit`, `offset` |
| GET | `/api/ingestion/tasks/{task_id}` | Get task details including per-project results |
| GET | `/api/ingestion/tasks/{task_id}/quality` | AI quality evaluation report for this ingestion |

---

## AI Quality Evaluation

### What is reused from EGM

Only the **LLM calling pattern** is reused: the `_llm_json_call` wrapper with JSON output enforcement, temperature 0.3, and error handling. The 5-dimension analysis framework and RAG/embeddings are NOT reused — NorthStar has a different evaluation context (architecture diagram quality vs. domain review quality).

### NorthStar Evaluation Dimensions

The AI evaluator assesses each project's extracted architecture data on 3 dimensions:

1. **Completeness** — Are all applications identified with standard IDs? Are all edges labeled with interaction types? Are there orphan nodes (no connections)?
2. **Consistency** — Does the same application have conflicting statuses across diagrams? Do bidirectional integrations match?
3. **Quality Score** — Overall 0-100 score combining completeness and consistency metrics.

Input to LLM: structured JSON of extracted applications and interactions.
Output: JSON with per-dimension findings and overall score.

---

## Frontend Design

### Asset Graph Viewer

- **Full graph view** — force-directed layout of all Application nodes and INTEGRATES_WITH edges
- **Node colors** — mapped from status: Keep=blue, Change=yellow, New=red, Sunset=gray, 3rd Party=white
- **Search + focus** — type app name/ID, highlight node and N-hop neighbors, fade others
- **Node click** — side drawer with app details: ID, status, projects, upstream/downstream list
- **Edge click** — integration details: interaction type, business object, protocol
- **Filters** — by fiscal year, status, project

**Tech:** Cytoscape.js

### Management Dashboard

**KPI cards (top row):**

| Total Apps | Total Integrations | New Apps (current FY) | Sunset Apps |
|---|---|---|---|

**Charts:**
- Tech stack distribution — pie chart (Keep/Change/New/Sunset proportions)
- FY change trend — line chart (new/changed/sunset counts per fiscal year)
- Integration heatmap — top 10 most-connected applications (hub analysis)
- Architecture quality scores — AI evaluation score distribution

**Tech:** Recharts

### Ingestion Console

- **Task list** — each ingestion run showing FY scope, project count, status (running/done/failed)
- **Manual trigger** — select fiscal year(s) → start ingestion
- **Results summary** — X new applications discovered, Y integrations, Z quality issues
- **Quality report** — AI evaluation results: which projects have missing/contradictory architecture info

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 15 + React 19 + TypeScript | Modern React, SSR support |
| Graph visualization | Cytoscape.js | Mature, large-scale graph, rich layouts |
| Charts | Recharts | Lightweight, React-native, declarative |
| Backend | Python FastAPI | Async support, consistent with EGM |
| Graph database | Neo4j Community Edition (Docker) | Native graph engine, Cypher queries |
| Neo4j driver | neo4j Python async driver | Official driver with async support |
| AI evaluation | Azure OpenAI (reuse EGM pattern) | JSON output, quality assessment |
| DrawIO parsing | Reuse EGM drawio_parser.py | Battle-tested parsing logic |

## Project Structure

```
NorthStar/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── graph/              # Asset graph page
│   │   │   ├── dashboard/          # Management dashboard
│   │   │   └── ingestion/          # Ingestion console
│   │   ├── components/
│   │   │   ├── graph/              # Cytoscape.js wrapper
│   │   │   ├── charts/             # Recharts components
│   │   │   └── ui/                 # Shared UI components
│   │   └── lib/                    # API client, utilities
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── routers/
│   │   │   ├── graph.py            # Graph query API
│   │   │   ├── analytics.py        # Statistics/analytics API
│   │   │   └── ingestion.py        # Ingestion task API
│   │   ├── services/
│   │   │   ├── neo4j_client.py     # Neo4j connection management
│   │   │   ├── graph_query.py      # Cypher query wrappers
│   │   │   ├── confluence.py       # Confluence REST API client
│   │   │   ├── drawio_parser.py    # Reused from EGM
│   │   │   ├── ai_evaluator.py     # Architecture quality AI evaluation
│   │   │   └── ingestion.py        # Pipeline orchestration
│   │   ├── models/                 # Pydantic schemas
│   │   └── config.py               # Configuration management
│   └── requirements.txt
├── docker-compose.yml              # Neo4j CE + Backend + Frontend
└── docs/
```

## Deployment (Docker Compose)

```yaml
# docker-compose.yml sketch
services:
  neo4j:
    image: neo4j:5-community
    ports:
      - "7474:7474"    # Neo4j Browser
      - "7687:7687"    # Bolt protocol
    volumes:
      - neo4j_data:/data
    environment:
      - NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - neo4j
    environment:
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=${NEO4J_PASSWORD}
      - CONFLUENCE_BASE_URL=https://km.xpaas.lenovo.com
      - CONFLUENCE_TOKEN=${CONFLUENCE_TOKEN}
      - LLM_BASE_URL=${LLM_BASE_URL}
      - LLM_API_KEY=${LLM_API_KEY}
      - LLM_MODEL=${LLM_MODEL:-gpt-4o}

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  neo4j_data:
```

All secrets via `.env` file (not committed to git):

```env
NEO4J_PASSWORD=your_password
CONFLUENCE_TOKEN=your_confluence_pat
LLM_BASE_URL=https://your-openai-endpoint
LLM_API_KEY=your_api_key
LLM_MODEL=gpt-4o
```

## MVP Scope Summary

| Feature | In MVP | Future |
|---------|--------|--------|
| Confluence draw.io ingestion | Yes | |
| DrawIO parsing (app + interactions) | Yes | |
| AI quality evaluation | Yes | |
| Neo4j Ontology (Application + Project) | Yes | |
| Asset Graph Viewer (Cytoscape.js) | Yes | |
| Management Dashboard (KPI + charts) | Yes | |
| Ingestion Console | Yes | |
| Change Impact Analysis | | Phase 2 |
| Real-time ops monitoring | | Phase 3 |
| Hardware/DC/cost/org data integration | | Progressive |
| Service/component-level Ontology | | Progressive |
| User auth & RBAC | | Phase 2 |

## Reuse from EGM

| Component | EGM Source | NorthStar Usage |
|-----------|-----------|-----------------|
| drawio_parser.py | `EGM/backend/app/services/drawio_parser.py` | Copy into NorthStar, extract app-level data |
| AI analysis patterns | `EGM/backend/app/services/ai_review_analysis.py` | Adapt prompts for architecture quality evaluation |
| Color/status mappings | drawio_parser FILL_COLOR_MAP, STROKE_COLOR_MAP | Direct reuse |
| Component classification | drawio_parser _classify_component() | Future use for tech-level Ontology |
