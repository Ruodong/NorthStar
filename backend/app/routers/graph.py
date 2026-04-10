"""Graph query API — /api/graph/*"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import ApiResponse
from app.services import graph_query

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("/nodes")
async def list_nodes(
    status: Optional[str] = None,
    fiscal_year: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    data = await graph_query.list_applications(status, fiscal_year, limit, offset)
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
