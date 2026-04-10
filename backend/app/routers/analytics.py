"""Analytics API — /api/analytics/*"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from app.models.schemas import ApiResponse
from app.services import graph_query

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
async def summary(current_fy: Optional[str] = None) -> ApiResponse:
    data = await graph_query.kpi_summary(current_fy)
    return ApiResponse(data=data)


@router.get("/status-distribution")
async def status_distribution() -> ApiResponse:
    data = await graph_query.status_distribution()
    return ApiResponse(data=data)


@router.get("/trend")
async def trend() -> ApiResponse:
    data = await graph_query.fy_trend()
    return ApiResponse(data=data)


@router.get("/hubs")
async def hubs(limit: int = Query(10, ge=1, le=100)) -> ApiResponse:
    data = await graph_query.top_hubs(limit)
    return ApiResponse(data=data)


@router.get("/quality-scores")
async def quality_scores() -> ApiResponse:
    from app.services.ingestion import _quality_reports
    reports = list(_quality_reports.values())
    if not reports:
        return ApiResponse(data={"distribution": [], "average": 0.0})
    scores: list[float] = []
    for r in reports:
        scores.extend(r.project_scores.values())
    if not scores:
        return ApiResponse(data={"distribution": [], "average": 0.0})
    buckets = {"0-60": 0, "60-80": 0, "80-100": 0}
    for s in scores:
        if s < 60:
            buckets["0-60"] += 1
        elif s < 80:
            buckets["60-80"] += 1
        else:
            buckets["80-100"] += 1
    return ApiResponse(
        data={
            "distribution": [{"bucket": k, "count": v} for k, v in buckets.items()],
            "average": round(sum(scores) / len(scores), 1),
        }
    )
