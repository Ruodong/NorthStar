# Ontology Fix — API & Data Reference

Companion to `spec.md`. Read this file when implementing or testing API
endpoints or when changing the Postgres tables touched by the ontology fix.

---

## 1. API Contracts

All responses use the standard envelope:
```ts
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### 1.1 Graph read endpoints (modified by ontology fix)

#### List application nodes
```
GET /api/graph/nodes
Query:
  status?        string   filter by Application.status (Active/Keep/Change/New/Sunset/3rd Party/Unknown)
  fiscal_year?   string   "apps with at least one INVESTS_IN edge where r.fiscal_year = $fiscal_year"
                          (SEMANTICS CHANGED from old source_fiscal_year scalar filter)
  limit?         int      default 200, max 1000
  offset?        int      default 0
Response 200: ApiResponse<ApplicationNode[]>
Errors: 500 (neo4j down)
```

#### Get application detail with investments
```
GET /api/graph/nodes/{app_id}
Path:
  app_id  string  e.g. A000001 or Xabc123def456
Response 200: ApiResponse<{
  app: ApplicationNode;
  outbound: IntegrationEdge[];
  inbound:  IntegrationEdge[];
  investments: ProjectAppInvestment[];   // NEW — one per INVESTS_IN edge
  diagrams: DiagramNode[];                // NEW — via DESCRIBED_BY
  confluence_pages: ConfluencePageNode[]; // NEW — via HAS_CONFLUENCE_PAGE
}>
Errors: 404 (app_id not found)
```

#### N-hop neighbors (unchanged)
```
GET /api/graph/nodes/{app_id}/neighbors
Query: depth? int (1-3, default 1)
Response 200: ApiResponse<{ root, nodes, edges }>
```

#### List integration edges (unchanged)
```
GET /api/graph/edges
Query: status?, interaction_type?
Response 200: ApiResponse<IntegrationEdge[]>
```

#### Full graph for visualization (modified)
```
GET /api/graph/full
Query:
  fiscal_year?  string   filter via INVESTS_IN (semantics changed, see above)
  status?       string
Response 200: ApiResponse<{ nodes: ApplicationNode[]; edges: IntegrationEdge[] }>
```

### 1.2 Analytics summary (modified)

```
GET /api/analytics/summary
Query:
  current_fy?  string  default unset
Response 200: ApiResponse<{
  total_apps: int;
  total_integrations: int;
  new_apps_current_fy: int;  // SEMANTICS: apps where status='New' AND
                             //            some INVESTS_IN edge has fiscal_year=$current_fy
  sunset_apps: int;
}>
```

### 1.3 Aliases (new feature)

#### List pending merge candidates
```
GET /api/aliases/pending
Query: limit? int (default 50), offset? int
Response 200: ApiResponse<PendingMergeCandidate[]>
```

#### Get one pending merge candidate
```
GET /api/aliases/pending/{merge_id}
Path: merge_id int
Response 200: ApiResponse<PendingMergeCandidate>
Errors: 404 (not found)
```

#### Record a human decision
```
POST /api/aliases/decisions/{merge_id}
Path: merge_id int
Body: MergeDecisionRequest
Response 200: ApiResponse<{
  merge_id: int;
  decision: "merge" | "keep_separate";
  aliases_written: int;  // count of manual_app_aliases rows inserted
}>
Errors:
  400 "decision must be 'merge' or 'keep_separate'"
  400 "canonical_id is required when decision=merge"
  400 "canonical_id not in candidate_ids of this merge row"
  404 "merge_id not found"
  409 "merge_id already has a decision; manual SQL required to change"
```

#### List currently applied aliases
```
GET /api/aliases/applied
Query: canonical_id?, limit? int, offset? int
Response 200: ApiResponse<ManualAppAlias[]>
```

---

## 2. Data Models (types)

### 2.1 Pydantic schemas (backend/app/models/schemas.py)

```python
class ApplicationNode(BaseModel):
    app_id: str
    name: str
    status: str = "Keep"
    description: str = ""
    cmdb_linked: bool = False
    last_updated: Optional[datetime] = None
    # NOTE: no source_project_id, no source_fiscal_year

class ProjectAppInvestment(BaseModel):
    project_id: str
    project_name: str = ""
    app_id: str
    fiscal_year: str = ""
    review_status: str = ""
    source_diagram_id: Optional[str] = None
    last_seen_at: Optional[datetime] = None

class DiagramNode(BaseModel):
    diagram_id: str
    diagram_type: str = "Unknown"  # App_Arch | Tech_Arch | Unknown
    file_kind: str = "drawio"       # drawio | image | pdf
    file_name: str = ""
    source_systems: list[str] = []  # ['egm','confluence']
    egm_diagram_id: Optional[str] = None
    confluence_attachment_id: Optional[str] = None
    confluence_page_id: Optional[str] = None
    download_path: Optional[str] = None
    local_path: Optional[str] = None
    has_graph_data: bool = False
    last_updated: Optional[datetime] = None

class ConfluencePageNode(BaseModel):
    page_id: str
    title: str = ""
    page_type: str = "other"  # application | project | other
    page_url: str = ""
    fiscal_year: str = ""
    last_updated: Optional[datetime] = None

class PendingMergeCandidate(BaseModel):
    id: int
    norm_key: str
    candidate_ids: list[str]
    raw_names: list[str]
    projects: list[str]
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    decision: Optional[str] = None  # None | "merge" | "keep_separate"
    decided_by: Optional[str] = None
    canonical_id: Optional[str] = None
    note: Optional[str] = None

class MergeDecisionRequest(BaseModel):
    decision: str                        # "merge" | "keep_separate"
    canonical_id: Optional[str] = None   # required when decision=="merge"
    decided_by: str = "unknown"
    note: Optional[str] = None

class ManualAppAlias(BaseModel):
    alias_id: str
    canonical_id: str
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    note: Optional[str] = None
```

### 2.2 TypeScript types (frontend/src/lib/api.ts)

```ts
export interface ApplicationNode {
  app_id: string;
  name: string;
  status: string;
  description?: string;
  cmdb_linked?: boolean;
  last_updated?: string;
}

export interface ProjectAppInvestment {
  project_id: string;
  name?: string;
  fiscal_year?: string;
  review_status?: string;
}
```

---

## 3. Postgres Table Definitions

All live in schema `northstar` under `backend/sql/003_ontology_fix.sql`. Idempotent; safe to re-apply.

### 3.1 `app_normalized_name`

Cache of normalized names for fuzzy matching non-CMDB apps.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| app_id | VARCHAR | NO | — | PK; the X-prefixed app_id from Neo4j |
| raw_name | VARCHAR | NO | — | Original app name from drawio cell |
| norm_key | VARCHAR | NO | — | Output of `app.services.name_normalize.normalize_name()` |
| diagram_id | VARCHAR | YES | — | Which diagram the app was first seen in |
| first_seen_at | TIMESTAMP | YES | NOW() | First time the loader saw this app_id |
| last_seen_at | TIMESTAMP | YES | NOW() | Most recent loader run that touched it |

Index: `idx_app_norm_key ON (norm_key)` — used by merge-candidate generator.

### 3.2 `pending_app_merge`

Groups of app_ids sharing a norm_key, awaiting human review.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | SERIAL | NO | — | PK |
| norm_key | VARCHAR | NO | — | The shared normalized key |
| candidate_ids | VARCHAR[] | NO | — | e.g. `['X3a7f2b1c9d0e','X8b2c4d5e6f7g']` |
| raw_names | VARCHAR[] | NO | — | Original names in the same order as candidate_ids |
| projects | VARCHAR[] | NO | — | Project IDs where these apps appeared (dedup) |
| created_at | TIMESTAMP | YES | NOW() | When generate_merge_candidates.py wrote this row |
| reviewed_at | TIMESTAMP | YES | — | Set when decision is recorded |
| decision | VARCHAR | YES | NULL | NULL (pending) / 'merge' / 'keep_separate' |
| decided_by | VARCHAR | YES | — | itcode or 'unknown' |
| canonical_id | VARCHAR | YES | — | Required when decision='merge'; the winner |
| note | TEXT | YES | — | Human note, optional |

Indexes:
- `idx_pending_merge_pending ON (created_at DESC) WHERE decision IS NULL` — pending work queue
- `idx_pending_merge_norm_key ON (norm_key)` — lookup by normalized key

### 3.3 `manual_app_aliases`

Confirmed alias→canonical mappings; read by the loader on every run.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| alias_id | VARCHAR | NO | — | PK; the id to be replaced |
| canonical_id | VARCHAR | NO | — | The canonical id it maps to |
| decided_at | TIMESTAMP | YES | NOW() | When the decision was recorded |
| decided_by | VARCHAR | YES | — | itcode or 'unknown' |
| source_merge_id | INT | YES | — | FK → pending_app_merge(id); nullable for manual SQL entries |
| note | TEXT | YES | — | Optional |

Index: `idx_alias_canonical ON (canonical_id)` — find all apps that map TO a given canonical.

**Semantics:** the loader reads this whole table at startup into a Python dict
`{alias_id: canonical_id}`. In `derive_app_id()`, after computing the diagram-scoped
X-id, it does `return alias_map.get(x_id, x_id)`. No SQL lookup per row — one bulk
read per loader invocation.

**Rollback:** `DELETE FROM manual_app_aliases WHERE source_merge_id = <N>` undoes
a merge decision. The next loader run rebuilds the graph with the original
(un-merged) X-ids. The pending_app_merge row's `decision` should also be cleared
to `NULL` to re-open for review.
