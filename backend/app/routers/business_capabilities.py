"""Business Capability mappings API — /api/apps/{app_id}/business-capabilities

Reads NorthStar PG (ref_business_capability + ref_app_business_capability),
both synced from EAM via scripts/sync_from_egm.py. No graph access, no
mutations — EAM is the source of truth for mappings.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import ApiResponse, AppBusinessCapabilitiesResponse
from app.services import business_capabilities as bc_service

router = APIRouter(prefix="/api/apps", tags=["business-capabilities"])


@router.get(
    "/{app_id}/business-capabilities",
    response_model=ApiResponse[AppBusinessCapabilitiesResponse],
)
async def get_app_business_capabilities(app_id: str) -> ApiResponse:
    data = await bc_service.get_app_business_capabilities(app_id)
    return ApiResponse(data=data)
