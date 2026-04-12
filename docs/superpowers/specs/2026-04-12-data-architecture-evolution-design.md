# NorthStar Data Architecture Evolution

| Field   | Value                          |
|---------|--------------------------------|
| Author  | Ruodong Yang                   |
| Date    | 2026-04-12                     |
| Status  | Approved                       |

---

## 1. Strategic Goal

NorthStar evolves from an architect's reference tool into an **AI-powered architecture recommendation engine**:

1. Architect searches for an application, understands its integrations, tech stack, deployment, cost
2. Architect describes a new business need in natural language
3. AI retrieves relevant reference architecture templates + historical project architectures from the knowledge graph
4. AI generates a tailored architecture design, grounded in organizational standards and proven patterns

## 2. Four-Layer Data Model

```
+---------------------------------------------+
|  Layer 4: AI Retrieval                       |
|  LLM + Graph RAG + Vector embeddings         |
+---------------------------------------------+
|  Layer 3: Reference Architecture             |
|  Template drawio + design standard docs (PG) |
+---------------------------------------------+
|  Layer 2: Ontology Projection (Neo4j)        |
|  Application-centric knowledge graph         |
+---------------------------------------------+
|  Layer 1: Raw Data (Postgres)                |
|  CMDB, MSPO, Confluence, TCO, Deploy, etc.   |
+---------------------------------------------+
```

**Layer 1 (Postgres)** is the system of record. All external data lands here first. No direct writes to Neo4j from sync scripts or API routers.

**Layer 2 (Neo4j)** is a derived projection rebuilt by `scripts/load_neo4j_from_pg.py`. It contains only data that serves architect queries or AI retrieval. Administrative fields (contract numbers, license keys, internal ticket IDs) stay in Postgres.

**Layer 3 (Postgres + file storage)** holds reference architecture templates (drawio files parsed by the existing pipeline, tagged `is_reference_template = true`) and design standard documents (text, stored with LLM-generated embeddings for vector search).

**Layer 4** is the AI layer. It combines Graph RAG (structured retrieval from Neo4j) with vector search (semantic retrieval from design standards) to generate architecture recommendations.

## 3. Phase 1: Raw Data Completion (Weeks 1-2)

### Objective

Ingest all remaining data domains into Postgres. Do NOT touch Neo4j during this phase.

### Domains to Ingest

| Domain | Source | Postgres Table | Status |
|--------|--------|----------------|--------|
| CMDB Applications | EAM | `ref_application` | Done (3,168 rows) |
| MSPO Projects | EAM | `ref_project` | Done (2,356 rows) |
| Employees | EGM | `ref_employee` | Done (79k rows) |
| Business Capabilities | EAM | `ref_business_capability` | Done |
| Project Teams | EAM | `ref_project_team_member` | Done |
| Project Summaries | EAM | `ref_project_summary` | Done |
| Confluence Pages | Confluence API | `confluence_page` | Done (2,769 pages) |
| Confluence Drawio Extract | Parser | `confluence_diagram_app` | Done (50k rows) |
| Application TCO | EAM | `ref_application_tco` | Sync script exists, PG table NOT created |
| Deployment Topology | TBD (CMDB fields or separate source) | TBD | Not started |
| Tech Stack Master | TBD (CMDB or drawio Tech_Arch extraction) | TBD | Not started |

### Per-Domain Ontology Sketch

After ingesting each domain, record in `ontology-sketch.md`:

```markdown
## Domain: <name>
- Table: <postgres table>
- Row count: <N>
- Key fields:
  - field_x: App property / Independent entity / Edge property
  - field_y: ...
- AI-useful fields: field_x (Y), field_z (Y), field_w (N)
- Data quality: coverage=85%, null_rate(field_x)=12%
- Ontology hypothesis: <one sentence, e.g. "TCO is a yearly property on Application, not a separate node">
```

### What NOT to do in Phase 1

- Do not modify Neo4j schema or loader
- Do not write new ontology nodes/edges
- Do not start on reference architecture ingestion
- Do not build AI features

## 4. Phase 2: Ontology Projection (Week 3)

### Objective

Based on the ontology sketch from Phase 1, design and implement the Neo4j schema in one pass.

### Anticipated Node + Edge Structure

Application-centric graph with these relationships:

```
(:Project)-[:INVESTS_IN {fy, budget_k}]->(:Application)           # Already exists
(:Application)-[:INTEGRATES_WITH {type, bo}]->(:Application)       # Already exists
(:Application)-[:USES_TECH]->(:Technology)                          # New: from Tech_Arch drawio
(:Application)-[:DEPLOYED_ON]->(:Infrastructure)                    # New: depends on raw data shape
(:Application)-[:SERVES]->(:BusinessCapability)                     # New: ref_business_capability data exists
(:Application)-[:HAS_DIAGRAM]->(:Diagram)                          # Already exists
(:Project)-[:HAS_CONFLUENCE_PAGE]->(:ConfluencePage)               # Already exists
```

### Design Criteria

For each candidate node/edge, apply the test: **"Does this improve AI's ability to find relevant architecture patterns?"**

- YES: `USES_TECH -> (:Technology {name: "Kafka"})` helps AI find "all architectures using event streaming"
- NO: `HAS_LICENSE -> (:License {key: "xxx"})` is administrative, no retrieval value

Nodes that fail the test stay as Postgres-only fields.

### Key Decisions Deferred to Phase 2

These depend on what the raw data actually looks like:

1. **Deployment**: node (:Infrastructure) vs Application property (hosting_type, region)
2. **TCO**: edge property on INVESTS_IN vs separate yearly node
3. **Technology**: node per tech vs array property on Application — depends on whether architects query "all apps using X"

## 5. Phase 3: Reference Architecture Ingestion (Weeks 4-5)

### Template Drawio Files

- Parse with the existing `parse_drawio_xml()` pipeline
- Store in `confluence_diagram_app` / `confluence_diagram_interaction` with a flag: `is_reference_template = true`
- In Neo4j: tag with `:ReferenceArchitecture` label so they can be retrieved separately from project architectures

### Design Standard Documents

- Store raw text in Postgres (`ref_design_standard` table)
- Generate vector embeddings (OpenAI or local model) for semantic search
- Index embeddings in pgvector or a dedicated vector store
- Documents describe constraints and guidelines (e.g., "all customer-facing services must use API Gateway", "data residency requires CN region deployment for PRC data")

### Template vs History Distinction

| Aspect | Reference Template | Historical Project |
|--------|--------------------|--------------------|
| Source | Manually designed by architecture team | Extracted from project drawio files |
| Role in AI | **Prescriptive** — "this is the recommended pattern" | **Descriptive** — "this is what was actually built" |
| Neo4j label | `:ReferenceArchitecture` | `:Diagram` (existing) |
| AI weight | Higher (organizational standard) | Lower (one team's interpretation) |

## 6. Phase 4: AI Architecture Recommendation (Separate Project)

### Prerequisites

- Layers 1-3 stable and populated
- Sufficient reference templates ingested (target: 10+ covering major business domains)
- Design standards documented and embedded

### Architecture

```
User: "I need an order management system for overseas markets,
       integrating with SAP ERP and supporting multi-currency"
                    |
                    v
        +---------------------+
        | Query Understanding  |  LLM parses intent into structured query:
        | (LLM)               |  capabilities: [order_mgmt, multi_currency]
        +---------------------+  integrations: [SAP_ERP]
                    |             deployment: [overseas]
                    v
        +---------------------+
        | Graph RAG            |  Neo4j Cypher:
        | (Neo4j)              |  MATCH (a:Application)-[:SERVES]->(bc)
        +---------------------+  WHERE bc.name CONTAINS 'order'
                    |             MATCH (a)-[:INTEGRATES_WITH]->(sap)
                    v             WHERE sap.name CONTAINS 'SAP'
        +---------------------+
        | Vector Search        |  pgvector similarity search on
        | (Design Standards)   |  "overseas order management SAP"
        +---------------------+
                    |
                    v
        +---------------------+
        | LLM Generation       |  Combines:
        |                     |  - Matching reference templates
        +---------------------+  - Historical project architectures
                    |             - Applicable design standards
                    v             - User requirements
          Architecture Design
          (text + suggested drawio)
```

### Not in Scope for This Design

- UI for the recommendation engine
- Feedback loop (architect rates AI output)
- Auto-generation of drawio XML from AI output
- Multi-turn refinement dialogue

## 7. Implementation Sequence Summary

```
Week 1-2:  Phase 1 — Raw data ingestion + ontology sketch notes
Week 3:    Phase 2 — Neo4j ontology one-shot implementation
Week 4-5:  Phase 3 — Reference architecture + design standards ingestion
Later:     Phase 4 — AI recommendation engine (separate project scope)
```

**Critical invariant**: Phase 1 and Phase 2 must NOT interleave. Complete all raw data ingestion before touching Neo4j. This prevents premature ontology commitments from being invalidated by later data domains.

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Deployment data turns out to be just 2 CMDB fields | Ontology sketch saves wasted Neo4j node design | Phase 1 sketch identifies this early |
| Reference templates are too abstract for useful AI retrieval | AI generates generic recommendations | Phase 3: supplement with historical project examples |
| Too many Tech_Arch components flood Neo4j | Graph becomes noisy | Phase 2: set cardinality caps, merge similar technologies |
| Ontology changes needed after Phase 2 | Loader rewrite | Neo4j is idempotent rebuild — just re-run loader |
