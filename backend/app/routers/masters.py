"""Master data API — /api/masters/*

Reads from the NorthStar postgres `ref_*` tables (seeded from EGM).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import ApiResponse
from app.services import pg_client

router = APIRouter(prefix="/api/masters", tags=["masters"])


@router.get("/applications/statuses")
async def application_statuses() -> ApiResponse:
    rows = await pg_client.fetch(
        """
        SELECT COALESCE(status, '') AS status, count(*) AS count
        FROM northstar.ref_application
        GROUP BY COALESCE(status, '')
        ORDER BY count DESC
        """
    )
    return ApiResponse(data=[dict(r) for r in rows])


@router.get("/projects/statuses")
async def project_statuses() -> ApiResponse:
    rows = await pg_client.fetch(
        """
        SELECT COALESCE(status, '') AS status, count(*) AS count
        FROM northstar.ref_project
        GROUP BY COALESCE(status, '')
        ORDER BY count DESC
        """
    )
    return ApiResponse(data=[dict(r) for r in rows])


@router.get("/summary")
async def summary() -> ApiResponse:
    # 'applications' is the ACTIVE portfolio count (TCO-driven) so that all
    # places that show "Applications: N" agree with the /admin/applications
    # list (also TCO-driven). ref_application is the full 3169-row CMDB
    # mirror which includes decommissioned/legacy entries.
    rows = await pg_client.fetch(
        """
        SELECT 'applications' AS entity, count(*) AS count FROM northstar.ref_application_tco
        UNION ALL SELECT 'applications_total_cmdb', count(*) FROM northstar.ref_application
        UNION ALL SELECT 'employees', count(*) FROM northstar.ref_employee
        UNION ALL SELECT 'projects',  count(*) FROM northstar.ref_project
        UNION ALL SELECT 'diagram_apps', count(*) FROM northstar.ref_diagram_app
        UNION ALL SELECT 'diagram_interactions', count(*) FROM northstar.ref_diagram_interaction
        """
    )
    return ApiResponse(data={r["entity"]: r["count"] for r in rows})


EMPTY_SENTINEL = "__EMPTY__"


@router.get("/applications")
async def list_applications(
    q: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """List applications driven by ref_application_tco (the active portfolio).

    ref_application (full EAM CMDB, 3169 rows) contains decommissioned and
    legacy records. ref_application_tco (1237 rows) is EAM's *active* tracked
    set — apps that have budget allocation this fiscal year. Using TCO as the
    driving table gives a cleaner, more current list.

    Each row LEFT JOINs ref_application for display metadata (name, status,
    owners, classification).
    """
    where = []
    args: list = []
    if q:
        args.append(f"%{q}%")
        where.append(
            f"(COALESCE(a.name, t.app_name) ILIKE ${len(args)} OR t.app_id ILIKE ${len(args)})"
        )
    if status == EMPTY_SENTINEL:
        where.append("(a.status IS NULL OR a.status = '')")
    elif status:
        args.append(status)
        where.append(f"a.status = ${len(args)}")
    where_clause = ("WHERE " + " AND ".join(where)) if where else ""
    args.extend([limit, offset])
    rows = await pg_client.fetch(
        f"""
        SELECT
            t.app_id,
            COALESCE(a.name, t.app_name)     AS name,
            a.app_full_name,
            COALESCE(a.status, 'Active')     AS status,
            a.u_service_area,
            a.portfolio_mgt,
            COALESCE(a.app_classification, t.application_classification) AS app_classification,
            t.budget_k,
            t.actual_k
        FROM northstar.ref_application_tco t
        LEFT JOIN northstar.ref_application a ON a.app_id = t.app_id
        {where_clause}
        ORDER BY t.budget_k DESC NULLS LAST, t.app_id
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    total = await pg_client.fetchval(
        f"""
        SELECT count(*)
        FROM northstar.ref_application_tco t
        LEFT JOIN northstar.ref_application a ON a.app_id = t.app_id
        {where_clause}
        """,
        *args[:-2],
    )

    # Convert Decimal → float for JSON
    from decimal import Decimal as _D

    def clean(r: dict) -> dict:
        return {k: (float(v) if isinstance(v, _D) else v) for k, v in r.items()}

    return ApiResponse(
        data={
            "total": total,
            "rows": [clean(dict(r)) for r in rows],
        }
    )


@router.get("/applications/{app_id}")
async def get_application(app_id: str) -> ApiResponse:
    row = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_application WHERE app_id = $1",
        app_id,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"{app_id} not found")
    return ApiResponse(data=dict(row))


@router.get("/projects")
async def list_projects(
    q: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    where = []
    args: list = []
    if q:
        args.append(f"%{q}%")
        where.append(f"(project_name ILIKE ${len(args)} OR project_id ILIKE ${len(args)})")
    if status == EMPTY_SENTINEL:
        where.append("(status IS NULL OR status = '')")
    elif status:
        args.append(status)
        where.append(f"status = ${len(args)}")
    where_clause = ("WHERE " + " AND ".join(where)) if where else ""
    args.extend([limit, offset])
    rows = await pg_client.fetch(
        f"""
        SELECT project_id, project_name, type, status, pm, it_lead, dt_lead,
               start_date, go_live_date, end_date, source
        FROM northstar.ref_project
        {where_clause}
        ORDER BY project_id DESC
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    total = await pg_client.fetchval(
        f"SELECT count(*) FROM northstar.ref_project {where_clause}",
        *args[:-2],
    )
    return ApiResponse(
        data={
            "total": total,
            "rows": [dict(r) for r in rows],
        }
    )


@router.get("/employees/{itcode}")
async def get_employee(itcode: str) -> ApiResponse:
    row = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_employee WHERE itcode = $1",
        itcode,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"{itcode} not found")
    return ApiResponse(data=dict(row))
