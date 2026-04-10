"""Ingestion API — /api/ingestion/*"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import ApiResponse, IngestionRunRequest
from app.services import ingestion as ingestion_svc

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])


@router.post("/run")
async def run_ingestion(payload: IngestionRunRequest) -> ApiResponse:
    if not payload.fiscal_years:
        raise HTTPException(status_code=400, detail="fiscal_years required")
    task = ingestion_svc.create_task(payload.fiscal_years, payload.limit)
    await ingestion_svc.start_task(task)
    return ApiResponse(data=task)


@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    tasks = ingestion_svc.list_tasks(status, limit, offset)
    return ApiResponse(data=tasks)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str) -> ApiResponse:
    task = ingestion_svc.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return ApiResponse(data=task)


@router.get("/tasks/{task_id}/quality")
async def get_quality(task_id: str) -> ApiResponse:
    report = ingestion_svc.get_quality_report(task_id)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Quality report for {task_id} not found")
    return ApiResponse(data=report)
