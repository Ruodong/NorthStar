"""Cypher query wrappers for graph and analytics endpoints."""
from __future__ import annotations

from typing import Any, Optional

from app.services import neo4j_client


def _build_filter_clause(filters: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    conditions = []
    params: dict[str, Any] = {}
    for key, value in filters.items():
        if value is None or value == "":
            continue
        conditions.append(f"a.{key} = ${key}")
        params[key] = value
    where = "WHERE " + " AND ".join(conditions) if conditions else ""
    return where, params


async def list_applications(
    status: Optional[str] = None,
    fiscal_year: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict]:
    where, params = _build_filter_clause({"status": status, "source_fiscal_year": fiscal_year})
    cypher = f"""
    MATCH (a:Application)
    {where}
    RETURN a
    ORDER BY a.name
    SKIP $offset LIMIT $limit
    """
    params.update({"limit": limit, "offset": offset})
    rows = await neo4j_client.run_query(cypher, params)
    return [row["a"] for row in rows]


async def get_application(app_id: str) -> Optional[dict]:
    cypher = """
    MATCH (a:Application {app_id: $app_id})
    OPTIONAL MATCH (a)-[r:INTEGRATES_WITH]->(other:Application)
    WITH a, collect(DISTINCT {target: other.app_id, target_name: other.name, type: r.interaction_type, business_object: r.business_object, protocol: r.protocol}) AS out_edges
    OPTIONAL MATCH (src:Application)-[r2:INTEGRATES_WITH]->(a)
    WITH a, out_edges, collect(DISTINCT {source: src.app_id, source_name: src.name, type: r2.interaction_type, business_object: r2.business_object, protocol: r2.protocol}) AS in_edges
    OPTIONAL MATCH (p:Project)-[:INCLUDES]->(a)
    RETURN a AS app, out_edges, in_edges, collect(DISTINCT {project_id: p.project_id, name: p.name, fiscal_year: p.fiscal_year}) AS projects
    """
    rows = await neo4j_client.run_query(cypher, {"app_id": app_id})
    if not rows:
        return None
    row = rows[0]
    return {
        "app": row["app"],
        "outbound": [e for e in row["out_edges"] if e.get("target")],
        "inbound": [e for e in row["in_edges"] if e.get("source")],
        "projects": [p for p in row["projects"] if p.get("project_id")],
    }


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
    node_where, node_params = _build_filter_clause({"source_fiscal_year": fiscal_year, "status": status})
    node_cypher = f"""
    MATCH (a:Application)
    {node_where}
    RETURN a
    LIMIT 5000
    """
    nodes_rows = await neo4j_client.run_query(node_cypher, node_params)
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
    cypher = """
    MATCH (a:Application)
    WITH count(a) AS total_apps,
         sum(CASE WHEN a.status = 'New' AND ($fy IS NULL OR a.source_fiscal_year = $fy) THEN 1 ELSE 0 END) AS new_apps,
         sum(CASE WHEN a.status = 'Sunset' THEN 1 ELSE 0 END) AS sunset_apps
    OPTIONAL MATCH ()-[r:INTEGRATES_WITH]->()
    RETURN total_apps, new_apps, sunset_apps, count(r) AS total_integrations
    """
    rows = await neo4j_client.run_query(cypher, {"fy": current_fy})
    if not rows:
        return {"total_apps": 0, "total_integrations": 0, "new_apps_current_fy": 0, "sunset_apps": 0}
    row = rows[0]
    return {
        "total_apps": row["total_apps"] or 0,
        "total_integrations": row["total_integrations"] or 0,
        "new_apps_current_fy": row["new_apps"] or 0,
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
    cypher = """
    MATCH (a:Application)
    WHERE a.source_fiscal_year IS NOT NULL AND a.source_fiscal_year <> ''
    RETURN a.source_fiscal_year AS fiscal_year,
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
