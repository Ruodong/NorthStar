"""Graph query API — /api/graph/*"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import ApiResponse
from app.services import confluence_search, graph_query, pg_client

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("/nodes")
async def list_nodes(
    status: Optional[str] = None,
    fiscal_year: Optional[str] = None,
    app_ownership: Optional[str] = None,
    portfolio_mgt: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    data = await graph_query.list_applications(
        status, fiscal_year, limit, offset,
        app_ownership=app_ownership, portfolio_mgt=portfolio_mgt,
    )
    return ApiResponse(data=data)


@router.get("/nodes/{app_id}")
async def get_node(app_id: str) -> ApiResponse:
    data = await graph_query.get_application(app_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Application {app_id} not found")
    return ApiResponse(data=data)


@router.get("/nodes/{app_id}/neighbors")
async def get_neighbors(app_id: str, depth: int = Query(1, ge=1, le=3)) -> ApiResponse:
    data = await graph_query.get_neighbors(app_id, depth)
    return ApiResponse(data=data)


@router.get("/nodes/{app_id}/impact")
async def get_impact(
    app_id: str,
    depth: int = Query(2, ge=1, le=3, description="Traversal depth (1-3)"),
) -> ApiResponse:
    """Reverse dependency analysis — who upstream is affected if this app changes.

    Traverses INTEGRATES_WITH edges in reverse up to `depth` hops. Returns
    results bucketed by distance, with per-bucket fan-out cap and
    business-object aggregation. See graph_query.reverse_dependency for
    semantic details.
    """
    data = await graph_query.reverse_dependency(app_id, depth)
    if data.get("root") is None:
        raise HTTPException(
            status_code=404, detail=f"Application {app_id} not found"
        )
    return ApiResponse(data=data)


@router.get("/nodes/{app_id}/knowledge")
async def get_knowledge_base(app_id: str) -> ApiResponse:
    """Cross-space Confluence knowledge base for an application.

    Looks up the app name from PG (CMDB or Neo4j), then queries Confluence
    CQL for pages whose title mentions that name outside the ARD space.
    Results are grouped by space and cached for 5 minutes.
    """
    # Resolve app_id → app_name from PG (CMDB first, then Neo4j app node)
    row = await pg_client.fetchrow(
        "SELECT name FROM northstar.ref_application WHERE app_id = $1",
        app_id,
    )
    if row:
        app_name = row["name"]
    else:
        # Non-CMDB app — try Neo4j node name via graph_query
        app_data = await graph_query.get_application(app_id)
        if app_data and app_data.get("app"):
            app_name = app_data["app"].get("name", "")
        else:
            raise HTTPException(status_code=404, detail=f"Application {app_id} not found")

    if not app_name:
        return ApiResponse(data={"total": 0, "app_name": "", "spaces": []})

    data = await confluence_search.search_knowledge_base(app_name)
    return ApiResponse(data=data)


@router.get("/edges")
async def list_edges(
    status: Optional[str] = None,
    interaction_type: Optional[str] = None,
) -> ApiResponse:
    data = await graph_query.list_edges(status, interaction_type)
    return ApiResponse(data=data)


@router.get("/full")
async def full_graph(
    fiscal_year: Optional[str] = None,
    status: Optional[str] = None,
) -> ApiResponse:
    data = await graph_query.full_graph(fiscal_year, status)
    return ApiResponse(data=data)
