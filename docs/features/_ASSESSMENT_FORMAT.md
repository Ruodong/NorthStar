# Impact Assessment Output Format

Reference for Claude when generating impact assessments for NorthStar feature requests.

Closed-loop Phase 1 output. See `.claude/skills/closed-loop-development.md` for the full 5-phase workflow.

## Decision Matrix

| Risk \ Impact | L1 (UI only) | L2 (Feature-local) | L3 (Cross-feature) | L4 (Global) |
|---|---|---|---|---|
| Low | Auto-approve | Auto-approve | Auto-approve + note | Auto-approve + note |
| Medium | Auto-approve | Pause: review | Pause: review | Pause: review |
| High | Pause: review | Pause: review | Pause: full chain | Pause: full chain |

## Impact Level Signals

| Level | Signals |
|-------|---------|
| **L1** | Only `page.tsx`, CSS variables, styling. No router, no Cypher, no PG schema. |
| **L2** | Single router's logic, single Cypher query, single PG table used only by that router. |
| **L3** | Tables/Cypher edges that other routers consume. Check `_DEPENDENCIES.json` edges. |
| **L4** | `backend/app/main.py`, `neo4j_client.py`, `pg_client.py`, `confluence_body.py`, `drawio_parser.py`, `frontend/src/app/layout.tsx`, `globals.css`. |

## Risk Level Signals

| Level | Signals |
|-------|---------|
| **Low** | Pure additions: new endpoint, new page, new filter, new column with DEFAULT. No existing API shapes change. |
| **Medium** | Renames/removes response fields; changes Cypher query result shape; alters sync source for a ref_* table; needs one-time backfill SQL. |
| **High** | Changes Neo4j edge semantics (e.g. moving fiscal_year from node to edge); changes unique constraint; changes app_id derivation; touches loaders (`load_neo4j_from_*.py`) in a way that affects existing data. |

## Format A: Low Risk (compact)

```
## Impact Assessment

**Feature**: Add status pill color to /admin/confluence list
**Impact**: L1 (UI only) | **Risk**: Low | **Decision**: Auto-approve
No cross-feature impact, no schema changes.
```

For L3/L4 + Low, add a note about which features are touched:

```
## Impact Assessment

**Feature**: Add q_app_id fallback in Confluence list
**Impact**: L3 (touches masters router + Confluence list API) | **Risk**: Low | **Decision**: Auto-approve
Touches: confluence-raw, app-catalog (read-only, no behavior changes).
```

## Format B: Medium/High Risk (full)

```
## Impact Assessment

**Feature**: <feature name>
**Impact Level**: L<n> — <one-line reason>
**Risk Level**: <Medium|High> — <one-line reason>
**Decision**: Pause for review

### Affected Features
| Feature | Relationship | Specific Impact |
|---------|-------------|-----------------|
| graph-core | Cypher shape change | Query returns new edge properties |
| ingestion | Write shape change | MERGE clause rewritten |

### Schema Changes (Postgres)
- [ ] New table: `foo` (columns: id, name)
- [ ] New column: `ref_project.new_col` (VARCHAR, nullable)
- [ ] SQL migration file: `backend/sql/NNN_xxx.sql`

### Neo4j Schema Changes
- [ ] New constraint: `CREATE CONSTRAINT ... FOR ... REQUIRE ...`
- [ ] New edge type: `:FOO_BAR` with properties `{prop1, prop2}`
- [ ] Existing edge `:BAR` is deprecated / removed

### Affected Acceptance Criteria (from existing feature specs)
> core-graph.md AC-3: "Every Application node with cmdb_linked=true has
> a canonical name from ref_application"
> → Your change moves fiscal_year off the Application node. AC-3 still
>   holds but the Application schema in test fixtures needs updating.

### Affected API Contracts
- `GET /api/graph/nodes/{app_id}` — response adds `investments[]` array (additive, non-breaking)
- `GET /api/graph/full?fiscal_year=FY2526` — query semantics change (now "apps with INVESTS_IN.fiscal_year = fy", previously "apps with source_fiscal_year = fy")

### Test Impact
- `api-tests/test_graph_query.py`: all AC tests need rewriting against INVESTS_IN
- New: `api-tests/test_ontology_invest_edge.py` for edge properties
- `e2e-tests/graph.spec.ts`: fiscal year filter assertion needs update

### Rollback Plan
- PG migrations are idempotent — re-run 002_init safe
- Neo4j: wipe and reload from PG (load_neo4j_from_pg.py --wipe)
- No external consumers of `source_fiscal_year` field exist yet (verified in frontend/src/lib/api.ts)
```

## Format C: Full Chain (High Risk + L3/L4)

Same as Format B, but additionally trace **transitive dependencies** from `_DEPENDENCIES.json` edges.

```
### Full Dependency Chain
graph-core (directly affected)
  └─ dashboard (reads /api/analytics/summary which aggregates Neo4j)
  └─ admin-projects (reads /api/admin/projects/{id}/overview which queries Neo4j for investments)
  └─ admin-applications (reads /api/admin/applications/{id}/overview which queries Neo4j for projects)
ingestion
  └─ load_neo4j_from_confluence.py (writes via same edge)
  └─ load_neo4j_from_pg.py (writes via same edge)
  └─ scripts/ingest.py (writes via same edge)

All above feature specs reviewed. Affected ACs listed above.
```
