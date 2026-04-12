"""Cypher query wrappers for graph and analytics endpoints.

Post-ontology-fix version. All references to a.source_project_id /
a.source_fiscal_year have been replaced with joins through the
(:Project)-[:INVESTS_IN]->(:Application) edge, which carries fiscal_year on
its properties.
"""
from __future__ import annotations

from typing import Any, Optional

from app.services import neo4j_client, pg_client


async def list_applications(
    status: Optional[str] = None,
    fiscal_year: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    """List applications, optionally filtered by status and/or fiscal year.

    fiscal_year semantics: "applications that have at least one :INVESTS_IN
    edge with fiscal_year = $fy". This means "apps touched by any project in
    that FY", which replaces the old scalar filter.
    """
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if fiscal_year:
        cypher = """
        MATCH (p:Project)-[r:INVESTS_IN]->(a:Application)
        WHERE r.fiscal_year = $fiscal_year
        """
        params["fiscal_year"] = fiscal_year
        if status:
            cypher += " AND a.status = $status"
            params["status"] = status
        cypher += """
        WITH DISTINCT a
        RETURN a
        ORDER BY a.name
        SKIP $offset LIMIT $limit
        """
    else:
        cypher = "MATCH (a:Application)"
        if status:
            cypher += " WHERE a.status = $status"
            params["status"] = status
        cypher += """
        RETURN a
        ORDER BY a.name
        SKIP $offset LIMIT $limit
        """
    rows = await neo4j_client.run_query(cypher, params)
    return [row["a"] for row in rows]


async def get_application(app_id: str) -> Optional[dict]:
    """Fetch an application with its integrations, investing projects, and diagrams.

    Investments are now sourced from Postgres (confluence_diagram_app → page → project)
    instead of Neo4j INVESTS_IN edges, giving richer data (project_name, page_id for
    deep-links) and covering the full CMDB surface.
    """
    # --- Neo4j: app node + integrations + diagrams + confluence pages ---
    cypher = """
    MATCH (a:Application {app_id: $app_id})
    OPTIONAL MATCH (a)-[r:INTEGRATES_WITH]->(other:Application)
    WITH a, collect(DISTINCT {
        target: other.app_id,
        target_name: other.name,
        type: r.interaction_type,
        business_object: r.business_object,
        protocol: r.protocol
    }) AS out_edges
    OPTIONAL MATCH (src:Application)-[r2:INTEGRATES_WITH]->(a)
    WITH a, out_edges, collect(DISTINCT {
        source: src.app_id,
        source_name: src.name,
        type: r2.interaction_type,
        business_object: r2.business_object,
        protocol: r2.protocol
    }) AS in_edges
    OPTIONAL MATCH (a)-[:DESCRIBED_BY]->(d:Diagram)
    WITH a, out_edges, in_edges, collect(DISTINCT {
        diagram_id: d.diagram_id,
        diagram_type: d.diagram_type,
        file_kind: d.file_kind,
        file_name: d.file_name,
        source_systems: d.source_systems,
        has_graph_data: d.has_graph_data
    }) AS diagrams
    OPTIONAL MATCH (a)-[:HAS_CONFLUENCE_PAGE]->(cp:ConfluencePage)
    RETURN a AS app,
           out_edges,
           in_edges,
           diagrams,
           collect(DISTINCT {
               page_id: cp.page_id,
               title: cp.title,
               page_url: cp.page_url
           }) AS confluence_pages
    """
    rows = await neo4j_client.run_query(cypher, {"app_id": app_id})
    if not rows:
        return None
    row = rows[0]

    # --- Postgres: investments (project → app via confluence_diagram_app) ---
    investments = await _fetch_investments_from_pg(app_id)

    # --- Postgres: CMDB enrichment (full ref_application row) ---
    app_dict = dict(row["app"])
    cmdb = await _fetch_cmdb_enrichment(app_id)
    if cmdb:
        app_dict.update(cmdb)

    # --- Postgres: drawio diagram references (confluence_diagram_app) ---
    pg_diagrams = await _fetch_diagram_refs_from_pg(app_id)

    # Merge Neo4j diagrams (DESCRIBED_BY edges) with Postgres drawio refs
    neo4j_diagrams = [d for d in row["diagrams"] if d.get("diagram_id")]
    seen_att_ids = {d.get("diagram_id") for d in neo4j_diagrams}
    for pd in pg_diagrams:
        if pd["attachment_id"] not in seen_att_ids:
            neo4j_diagrams.append(pd)

    return {
        "app": app_dict,
        "outbound": [e for e in row["out_edges"] if e.get("target")],
        "inbound": [e for e in row["in_edges"] if e.get("source")],
        "investments": investments,
        "diagrams": neo4j_diagrams,
        "confluence_pages": [c for c in row["confluence_pages"] if c.get("page_id")],
    }


async def _fetch_cmdb_enrichment(app_id: str) -> Optional[dict]:
    """Fetch full CMDB fields from ref_application to enrich the Neo4j app node.

    Neo4j only stores 6 properties (app_id, name, status, cmdb_linked,
    description, last_updated). The CMDB has 22+ columns with ownership,
    classification, deployment, and organizational data. This enrichment
    adds them to the app dict so the frontend can display the full BASIC panel.
    """
    sql = """
    SELECT
        a.short_description, a.app_full_name,
        a.u_service_area, a.app_classification, a.app_ownership,
        a.app_solution_type, a.portfolio_mgt,
        a.owned_by,            e_o.name  AS owned_by_name,
        a.app_it_owner,        e_it.name AS app_it_owner_name,
        a.app_dt_owner,        e_dt.name AS app_dt_owner_name,
        a.app_operation_owner, e_op.name AS app_operation_owner_name,
        a.app_owner_tower, a.app_owner_domain,
        a.app_operation_owner_tower, a.app_operation_owner_domain,
        a.patch_level, a.decommissioned_at,
        a.data_residency_geo, a.data_residency_country, a.data_center,
        a.support, a.source_system
    FROM northstar.ref_application a
    LEFT JOIN northstar.ref_employee e_o  ON e_o.itcode  = a.owned_by
    LEFT JOIN northstar.ref_employee e_it ON e_it.itcode = a.app_it_owner
    LEFT JOIN northstar.ref_employee e_dt ON e_dt.itcode = a.app_dt_owner
    LEFT JOIN northstar.ref_employee e_op ON e_op.itcode = a.app_operation_owner
    WHERE a.app_id = $1
    """
    row = await pg_client.fetchrow(sql, app_id)
    if row is None:
        return None
    return {k: v for k, v in dict(row).items() if v is not None}


async def _fetch_diagram_refs_from_pg(app_id: str) -> list[dict]:
    """Find drawio attachments that reference this app via confluence_diagram_app.

    Returns attachment-level summaries so the Diagrams tab can show which
    drawio files contain this application, with links to the Confluence page.
    """
    sql = """
    SELECT DISTINCT
        ca.attachment_id,
        ca.title       AS file_name,
        ca.file_kind,
        cp.page_id::text AS page_id,
        cp.title       AS page_title,
        cp.page_url,
        cp.fiscal_year
    FROM northstar.confluence_diagram_app cda
    JOIN northstar.confluence_attachment ca ON ca.attachment_id = cda.attachment_id
    JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
    WHERE COALESCE(cda.resolved_app_id, cda.standard_id) = $1
    ORDER BY cp.fiscal_year DESC, ca.title
    """
    rows = await pg_client.fetch(sql, app_id)
    return [dict(r) for r in rows]


async def _fetch_investments_from_pg(app_id: str) -> list[dict]:
    """Query Postgres for projects that reference this app via drawio diagrams.

    Returns one row per project_id with {project_id, project_name, fiscal_year,
    root_page_id}.  project_name comes from ref_project.  root_page_id is the
    depth-1 Confluence page for the project (used for the detail link).
    """
    sql = """
    SELECT DISTINCT ON (cp.project_id)
        cp.project_id,
        rp.project_name,
        cp.fiscal_year,
        (SELECT p2.page_id::text
           FROM northstar.confluence_page p2
          WHERE p2.project_id = cp.project_id AND p2.depth = 1
          ORDER BY p2.page_id LIMIT 1
        ) AS root_page_id
    FROM northstar.confluence_diagram_app cda
    JOIN northstar.confluence_attachment ca ON ca.attachment_id = cda.attachment_id
    JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
    LEFT JOIN northstar.ref_project rp ON rp.project_id = cp.project_id
    WHERE COALESCE(cda.resolved_app_id, cda.standard_id) = $1
      AND cp.project_id IS NOT NULL
    ORDER BY cp.project_id, cp.fiscal_year DESC
    """
    rows = await pg_client.fetch(sql, app_id)
    # Re-sort by fiscal_year DESC for display
    result = [dict(r) for r in rows]
    result.sort(key=lambda r: (r.get("fiscal_year") or "", r.get("project_id") or ""), reverse=True)
    return result


async def get_neighbors(app_id: str, depth: int = 1) -> dict:
    depth = max(1, min(depth, 3))
    cypher = f"""
    MATCH (root:Application {{app_id: $app_id}})
    OPTIONAL MATCH path = (root)-[:INTEGRATES_WITH*1..{depth}]-(neighbor:Application)
    WITH root, collect(DISTINCT neighbor) AS neighbors, collect(DISTINCT relationships(path)) AS rels
    RETURN root,
           [n IN neighbors WHERE n IS NOT NULL | n] AS nodes,
           [rel_list IN rels | [r IN rel_list | {{source: startNode(r).app_id, target: endNode(r).app_id, type: r.interaction_type, status: r.status}}]] AS edges
    """
    rows = await neo4j_client.run_query(cypher, {"app_id": app_id})
    if not rows:
        return {"root": None, "nodes": [], "edges": []}
    row = rows[0]
    flat_edges: list[dict] = []
    seen: set[tuple] = set()
    for rel_list in row["edges"] or []:
        for e in rel_list:
            key = (e["source"], e["target"], e.get("type", ""))
            if key in seen:
                continue
            seen.add(key)
            flat_edges.append(e)
    return {"root": row["root"], "nodes": row["nodes"], "edges": flat_edges}


async def list_edges(status: Optional[str] = None, interaction_type: Optional[str] = None) -> list[dict]:
    conditions = []
    params: dict[str, Any] = {}
    if status:
        conditions.append("r.status = $status")
        params["status"] = status
    if interaction_type:
        conditions.append("r.interaction_type = $interaction_type")
        params["interaction_type"] = interaction_type
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    cypher = f"""
    MATCH (a:Application)-[r:INTEGRATES_WITH]->(b:Application)
    {where}
    RETURN a.app_id AS source_app_id,
           b.app_id AS target_app_id,
           r.interaction_type AS interaction_type,
           r.business_object AS business_object,
           r.status AS status,
           r.protocol AS protocol
    LIMIT 5000
    """
    return await neo4j_client.run_query(cypher, params)


async def full_graph(fiscal_year: Optional[str] = None, status: Optional[str] = None) -> dict:
    """Full graph for visualization.

    When fiscal_year is given, only apps invested in by a project with that FY
    (and their edges among themselves) are returned.
    """
    params: dict[str, Any] = {}
    if fiscal_year:
        node_cypher = """
        MATCH (p:Project)-[r:INVESTS_IN]->(a:Application)
        WHERE r.fiscal_year = $fiscal_year
        """
        params["fiscal_year"] = fiscal_year
        if status:
            node_cypher += " AND a.status = $status"
            params["status"] = status
        node_cypher += """
        WITH DISTINCT a
        RETURN a
        LIMIT 5000
        """
    else:
        node_cypher = "MATCH (a:Application)"
        if status:
            node_cypher += " WHERE a.status = $status"
            params["status"] = status
        node_cypher += " RETURN a LIMIT 5000"

    nodes_rows = await neo4j_client.run_query(node_cypher, params)
    nodes = [row["a"] for row in nodes_rows]
    node_ids = {n.get("app_id") for n in nodes}

    edge_cypher = """
    MATCH (a:Application)-[r:INTEGRATES_WITH]->(b:Application)
    WHERE a.app_id IN $ids AND b.app_id IN $ids
    RETURN a.app_id AS source_app_id,
           b.app_id AS target_app_id,
           r.interaction_type AS interaction_type,
           r.business_object AS business_object,
           r.status AS status,
           r.protocol AS protocol
    LIMIT 10000
    """
    edges_rows = await neo4j_client.run_query(edge_cypher, {"ids": list(node_ids)})
    return {"nodes": nodes, "edges": edges_rows}


# ---------------------------------------------------------------------------
# Analytics queries
# ---------------------------------------------------------------------------


async def kpi_summary(current_fy: Optional[str] = None) -> dict:
    """KPI summary cards.

    new_apps_current_fy: apps that have a :INVESTS_IN edge with fiscal_year=$fy
    AND status='New' on the application. (An app is "new in FY2526" if a
    project in FY2526 invested in it while the app's global status is New.)
    """
    if current_fy:
        new_apps_cypher = """
        MATCH (p:Project)-[r:INVESTS_IN]->(a:Application)
        WHERE r.fiscal_year = $fy AND a.status = 'New'
        RETURN count(DISTINCT a) AS c
        """
        new_apps_rows = await neo4j_client.run_query(new_apps_cypher, {"fy": current_fy})
        new_apps_count = new_apps_rows[0]["c"] if new_apps_rows else 0
    else:
        new_apps_cypher = "MATCH (a:Application) WHERE a.status = 'New' RETURN count(a) AS c"
        new_apps_rows = await neo4j_client.run_query(new_apps_cypher)
        new_apps_count = new_apps_rows[0]["c"] if new_apps_rows else 0

    totals_cypher = """
    MATCH (a:Application)
    WITH count(a) AS total_apps,
         sum(CASE WHEN a.status = 'Sunset' THEN 1 ELSE 0 END) AS sunset_apps
    OPTIONAL MATCH ()-[r:INTEGRATES_WITH]->()
    RETURN total_apps, sunset_apps, count(r) AS total_integrations
    """
    rows = await neo4j_client.run_query(totals_cypher)
    if not rows:
        return {
            "total_apps": 0,
            "total_integrations": 0,
            "new_apps_current_fy": new_apps_count,
            "sunset_apps": 0,
        }
    row = rows[0]
    return {
        "total_apps": row["total_apps"] or 0,
        "total_integrations": row["total_integrations"] or 0,
        "new_apps_current_fy": new_apps_count or 0,
        "sunset_apps": row["sunset_apps"] or 0,
    }


async def status_distribution() -> list[dict]:
    cypher = """
    MATCH (a:Application)
    RETURN a.status AS status, count(a) AS count
    ORDER BY count DESC
    """
    return await neo4j_client.run_query(cypher)


async def fy_trend() -> list[dict]:
    """Fiscal year trend: for each FY in which any project invested in any
    app, count how many of those apps are currently marked New / Change / Sunset.

    Note: this counts apps by their current global status, bucketed into the
    FY in which they were first (or any time) invested in. If you want "new
    in FY2526" strictly, cross-filter with a.status='New' and r.fiscal_year=$fy.
    """
    cypher = """
    MATCH (p:Project)-[r:INVESTS_IN]->(a:Application)
    WHERE r.fiscal_year IS NOT NULL AND r.fiscal_year <> ''
    WITH r.fiscal_year AS fiscal_year, a
    RETURN fiscal_year,
           sum(CASE WHEN a.status = 'New' THEN 1 ELSE 0 END) AS new_count,
           sum(CASE WHEN a.status = 'Change' THEN 1 ELSE 0 END) AS change_count,
           sum(CASE WHEN a.status = 'Sunset' THEN 1 ELSE 0 END) AS sunset_count
    ORDER BY fiscal_year
    """
    return await neo4j_client.run_query(cypher)


async def top_hubs(limit: int = 10) -> list[dict]:
    cypher = """
    MATCH (a:Application)
    OPTIONAL MATCH (a)-[r:INTEGRATES_WITH]-()
    WITH a, count(r) AS degree
    WHERE degree > 0
    RETURN a.app_id AS app_id, a.name AS name, degree
    ORDER BY degree DESC
    LIMIT $limit
    """
    return await neo4j_client.run_query(cypher, {"limit": limit})


# ---------------------------------------------------------------------------
# Reverse dependency / Impact Analysis
# ---------------------------------------------------------------------------
# "If I sunset this app, who breaks?" — traverse INTEGRATES_WITH edges in
# reverse (callers upstream) for 1, 2, or 3 hops. Neo4j does not support
# parameterizing the path length, so we keep three hard-coded queries.
#
# Per-depth handling in Python:
#   - group results by distance
#   - cap each distance bucket at FAN_OUT_CAP entries (default 50)
#   - aggregate "directly impacted business objects" from the first edge
#     of each path (the one closest to the target — that's the hop that
#     actually exposes the business impact of removing the target)

IMPACT_FAN_OUT_CAP = 50
IMPACT_TOTAL_LIMIT = 400  # Cypher LIMIT — pulled down to 200 after grouping

_REVERSE_CYPHER_BY_DEPTH: dict[int, str] = {
    1: """
    MATCH path=(a:Application {app_id: $app_id})<-[r:INTEGRATES_WITH*1..1]-(up:Application)
    RETURN up.app_id AS app_id,
           up.name AS name,
           coalesce(up.status, '') AS status,
           coalesce(up.cmdb_linked, false) AS cmdb_linked,
           length(path) AS distance,
           [rel IN r | coalesce(rel.business_object, '')] AS path_business_objects,
           [rel IN r | coalesce(rel.interaction_type, '')] AS path_types
    ORDER BY distance, up.name
    LIMIT $limit
    """,
    2: """
    MATCH path=(a:Application {app_id: $app_id})<-[r:INTEGRATES_WITH*1..2]-(up:Application)
    RETURN up.app_id AS app_id,
           up.name AS name,
           coalesce(up.status, '') AS status,
           coalesce(up.cmdb_linked, false) AS cmdb_linked,
           length(path) AS distance,
           [rel IN r | coalesce(rel.business_object, '')] AS path_business_objects,
           [rel IN r | coalesce(rel.interaction_type, '')] AS path_types
    ORDER BY distance, up.name
    LIMIT $limit
    """,
    3: """
    MATCH path=(a:Application {app_id: $app_id})<-[r:INTEGRATES_WITH*1..3]-(up:Application)
    RETURN up.app_id AS app_id,
           up.name AS name,
           coalesce(up.status, '') AS status,
           coalesce(up.cmdb_linked, false) AS cmdb_linked,
           length(path) AS distance,
           [rel IN r | coalesce(rel.business_object, '')] AS path_business_objects,
           [rel IN r | coalesce(rel.interaction_type, '')] AS path_types
    ORDER BY distance, up.name
    LIMIT $limit
    """,
}


async def reverse_dependency(app_id: str, depth: int = 2) -> dict:
    """Return upstream impact analysis for an application.

    Args:
        app_id: The target application id.
        depth: Traversal depth (1, 2, or 3). Values outside this range are clamped.

    Returns:
        {
            "root": {app_id, name, status},
            "depth": int,
            "total_upstream": int (unique callers across all depths, pre-cap),
            "by_distance": [
                {
                    "distance": 1,
                    "total": <unique callers at this distance>,
                    "shown": <min(total, FAN_OUT_CAP)>,
                    "apps": [... up to FAN_OUT_CAP rows ...],
                },
                ...
            ],
            "business_objects": [{"name": str, "count": int}, ...],
            "truncated_at_cypher_limit": bool,
        }
    """
    depth = max(1, min(depth, 3))

    # 1. Verify the root app exists — gives a clean 404 path in the caller
    root_row = await neo4j_client.run_query(
        """
        MATCH (a:Application {app_id: $app_id})
        RETURN a.app_id AS app_id, a.name AS name, coalesce(a.status, '') AS status
        """,
        {"app_id": app_id},
    )
    if not root_row:
        return {"root": None, "depth": depth, "by_distance": [], "business_objects": []}

    cypher = _REVERSE_CYPHER_BY_DEPTH[depth]
    rows = await neo4j_client.run_query(
        cypher,
        {"app_id": app_id, "limit": IMPACT_TOTAL_LIMIT},
    )

    truncated = len(rows) >= IMPACT_TOTAL_LIMIT

    # Deduplicate: the same upstream app can show up on multiple paths at the
    # same distance. Keep the first row per (app_id, distance) so downstream
    # budgets stay honest.
    seen: set[tuple[str, int]] = set()
    unique_rows: list[dict] = []
    for r in rows:
        key = (r["app_id"], r["distance"])
        if key in seen:
            continue
        seen.add(key)
        unique_rows.append(r)

    # 2. Bucket by distance, apply fan-out cap per bucket
    buckets: dict[int, list[dict]] = {}
    for r in unique_rows:
        buckets.setdefault(r["distance"], []).append(r)

    by_distance: list[dict] = []
    for d in sorted(buckets.keys()):
        full = buckets[d]
        shown = full[:IMPACT_FAN_OUT_CAP]
        by_distance.append(
            {
                "distance": d,
                "total": len(full),
                "shown": len(shown),
                "apps": [
                    {
                        "app_id": row["app_id"],
                        "name": row["name"],
                        "status": row["status"],
                        "cmdb_linked": row["cmdb_linked"],
                    }
                    for row in shown
                ],
            }
        )

    # 3. Business-object aggregation
    # Semantics: for each upstream path, take only the TERMINAL edge's
    # business_object (the edge closest to the query app_id). This reflects
    # "what business concern is directly exposed to the target app". For
    # reverse traversal `a <- up`, the terminal edge is the first element of
    # the edge list since we traverse from root outward.
    bo_counter: dict[str, int] = {}
    for r in unique_rows:
        bos = r.get("path_business_objects") or []
        if not bos:
            continue
        terminal = bos[0]
        if not terminal:
            terminal = "Unlabeled"
        bo_counter[terminal] = bo_counter.get(terminal, 0) + 1
    business_objects = [
        {"name": k, "count": v}
        for k, v in sorted(bo_counter.items(), key=lambda kv: kv[1], reverse=True)
    ][:10]

    return {
        "root": root_row[0],
        "depth": depth,
        "total_upstream": len(unique_rows),
        "by_distance": by_distance,
        "business_objects": business_objects,
        "truncated_at_cypher_limit": truncated,
        "fan_out_cap": IMPACT_FAN_OUT_CAP,
    }
