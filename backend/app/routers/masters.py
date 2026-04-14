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


@router.get("/applications/ownerships")
async def application_ownerships() -> ApiResponse:
    rows = await pg_client.fetch(
        """
        SELECT COALESCE(app_ownership, '') AS ownership, count(*) AS count
        FROM northstar.ref_application
        GROUP BY COALESCE(app_ownership, '')
        ORDER BY count DESC
        """
    )
    return ApiResponse(data=[dict(r) for r in rows])


@router.get("/applications/portfolios")
async def application_portfolios() -> ApiResponse:
    rows = await pg_client.fetch(
        """
        SELECT COALESCE(portfolio_mgt, '') AS portfolio, count(*) AS count
        FROM northstar.ref_application
        GROUP BY COALESCE(portfolio_mgt, '')
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
    # 'applications' is the full CMDB count (ref_application) — the authoritative
    # app registry. ref_application_tco is a subset with budget data.
    rows = await pg_client.fetch(
        """
        SELECT 'applications' AS entity, count(*) AS count FROM northstar.ref_application
        UNION ALL SELECT 'applications_with_tco', count(*) FROM northstar.ref_application_tco
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
    """List applications from the full CMDB (ref_application).

    LEFT JOINs ref_application_tco for budget data. Apps without TCO
    show budget/actual as null. Default sort: name ASC.
    """
    where = []
    args: list = []
    if q:
        args.append(f"%{q}%")
        where.append(
            f"(a.name ILIKE ${len(args)} OR a.app_id ILIKE ${len(args)}"
            f" OR a.app_full_name ILIKE ${len(args)})"
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
            a.app_id,
            a.name,
            a.app_full_name,
            a.status,
            a.app_ownership,
            a.u_service_area,
            a.portfolio_mgt,
            a.app_classification,
            t.budget_k,
            t.actual_k
        FROM northstar.ref_application a
        LEFT JOIN northstar.ref_application_tco t ON t.app_id = a.app_id
        {where_clause}
        ORDER BY a.name ASC NULLS LAST, a.app_id
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    total = await pg_client.fetchval(
        f"""
        SELECT count(*)
        FROM northstar.ref_application a
        LEFT JOIN northstar.ref_application_tco t ON t.app_id = a.app_id
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


@router.get("/applications/{app_id}/deployment")
async def get_application_deployment(app_id: str) -> ApiResponse:
    """Infrastructure deployment data for an application: servers, containers, databases.

    Returns summary counts + per-category rows with city information.
    Container city is derived from cluster_name; database city is joined
    from ref_deployment_server via host_name.
    """
    # Servers (VM/PM) — city + env (landscape → Production/Non-Production)
    servers = await pg_client.fetch(
        """
        SELECT name, ip_address, app_name, device_type, is_virtualized,
               os_type, os_version, cpu_count, ram, disk_space,
               "City" AS city, location, operational_status, landscape,
               have_dr, model_type,
               CASE
                 WHEN lower(landscape) = 'production' THEN 'Production'
                 WHEN landscape IS NULL OR landscape = '' THEN 'Unknown'
                 ELSE 'Non-Production'
               END AS env
        FROM northstar.ref_deployment_server
        WHERE app_id = $1
        ORDER BY
            CASE WHEN lower(landscape) = 'production' THEN 0
                 WHEN landscape IS NULL OR landscape = '' THEN 2
                 ELSE 1 END,
            "City", name
        """,
        app_id,
    )

    # Containers — derive city + env from cluster_name
    containers = await pg_client.fetch(
        """
        SELECT name AS project_name, cluster_name, limit_cpu, limit_mem,
               operational_status, owner, type,
               CASE
                 WHEN cluster_name ILIKE '%SHENYANG%' THEN 'SY'
                 WHEN cluster_name ILIKE '%SY-%' OR cluster_name ILIKE '%-SY-%' THEN 'SY'
                 WHEN cluster_name ILIKE '%RESTON%' THEN 'US-Reston'
                 WHEN cluster_name ILIKE '%FRANKFURT%' THEN 'Frankfurt'
                 WHEN cluster_name ILIKE '%CHICAGO%' THEN 'US-Chicago'
                 WHEN cluster_name ILIKE '%BEIJING%' OR cluster_name ILIKE '%BJ%' THEN 'BJ'
                 WHEN cluster_name ILIKE '%NANCHANG%' OR cluster_name ILIKE '%NC%' THEN 'NM'
                 WHEN cluster_name ILIKE '%HOHHOT%' OR cluster_name ILIKE '%-NM-%' THEN 'NM'
                 WHEN cluster_name ILIKE '%HK%' OR cluster_name ILIKE '%HONGKONG%' THEN 'HK'
                 WHEN cluster_name ILIKE '%NA-%' OR cluster_name ILIKE '%-NA-%' THEN 'NA'
                 WHEN cluster_name ILIKE '%AWSUS%' THEN 'NA'
                 ELSE cluster_name
               END AS city,
               CASE
                 WHEN cluster_name ILIKE '%-PRD-%' OR cluster_name ILIKE '%-PRD' THEN 'Production'
                 WHEN cluster_name ILIKE '%-STG-%' OR cluster_name ILIKE '%-UAT-%'
                   OR cluster_name ILIKE '%-DEV-%' OR cluster_name ILIKE '%-QA-%'
                   OR cluster_name ILIKE '%-TEST-%' THEN 'Non-Production'
                 ELSE 'Unknown'
               END AS env
        FROM northstar.ref_deployment_container
        WHERE app_id = $1
        ORDER BY
            CASE WHEN cluster_name ILIKE '%-PRD-%' OR cluster_name ILIKE '%-PRD' THEN 0
                 WHEN cluster_name ILIKE '%-STG-%' OR cluster_name ILIKE '%-UAT-%'
                   OR cluster_name ILIKE '%-DEV-%' OR cluster_name ILIKE '%-QA-%'
                   OR cluster_name ILIKE '%-TEST-%' THEN 1
                 ELSE 2 END,
            cluster_name
        """,
        app_id,
    )

    # Databases — join server table for city; env from used_for
    databases = await pg_client.fetch(
        """
        SELECT d.name, d.db_instance_name, d.app_name,
               d."className" AS db_type, d.version, d.host_name,
               d.operational_status, d.ha_type, d.ha_role, d.port,
               d.u_db_size_in_mb AS db_size_mb,
               d.used_for,
               s."City" AS city, s.location,
               CASE
                 WHEN lower(d.used_for) = 'production' THEN 'Production'
                 WHEN d.used_for IS NULL OR d.used_for = '' THEN 'Unknown'
                 ELSE 'Non-Production'
               END AS env
        FROM northstar.ref_deployment_database d
        LEFT JOIN LATERAL (
            SELECT DISTINCT ON (s2."City") s2."City", s2.location
            FROM northstar.ref_deployment_server s2
            WHERE s2.name = d.host_name
               OR s2.fqdn = d.host_name
            LIMIT 1
        ) s ON true
        WHERE d.app_id = $1
        ORDER BY
            CASE WHEN lower(d.used_for) = 'production' THEN 0
                 WHEN d.used_for IS NULL OR d.used_for = '' THEN 2
                 ELSE 1 END,
            d."className", d.name
        """,
        app_id,
    )

    # Object Storage — has landscape (env) + location (full city name)
    object_storage = await pg_client.fetch(
        """
        SELECT name, app_name, max_size, max_buckets, endpoint,
               location AS city, operational_status, landscape, owner,
               CASE
                 WHEN lower(landscape) = 'production' THEN 'Production'
                 WHEN landscape IS NULL OR landscape = '' THEN 'Unknown'
                 ELSE 'Non-Production'
               END AS env
        FROM northstar.ref_deployment_object_storage
        WHERE app_id = $1
        ORDER BY
            CASE WHEN lower(landscape) = 'production' THEN 0
                 WHEN landscape IS NULL OR landscape = '' THEN 2
                 ELSE 1 END,
            name
        """,
        app_id,
    )

    # NAS Storage — has landscape (env) + location (full city name)
    nas = await pg_client.fetch(
        """
        SELECT name, app_name, capacity, type, path,
               location AS city, operational_status, landscape, owner,
               CASE
                 WHEN lower(landscape) = 'production' THEN 'Production'
                 WHEN landscape IS NULL OR landscape = '' THEN 'Unknown'
                 ELSE 'Non-Production'
               END AS env
        FROM northstar.ref_deployment_nas
        WHERE app_id = $1
        ORDER BY
            CASE WHEN lower(landscape) = 'production' THEN 0
                 WHEN landscape IS NULL OR landscape = '' THEN 2
                 ELSE 1 END,
            name
        """,
        app_id,
    )

    # City × Env summary across all 5 sources, splitting servers into PM/VM
    ZERO = {"pm": 0, "vm": 0, "k8s": 0, "db": 0,
            "oss": 0, "nas": 0}
    cell_counts: dict[tuple[str, str], dict[str, int]] = {}
    for r in servers:
        key = (r["city"] or "Unknown", r["env"] or "Unknown")
        cell_counts.setdefault(key, {**ZERO})
        virt = (r.get("is_virtualized") or "").lower()
        if "physical" in virt:
            cell_counts[key]["pm"] += 1
        else:
            cell_counts[key]["vm"] += 1
    for r in containers:
        key = (r["city"] or "Unknown", r["env"] or "Unknown")
        cell_counts.setdefault(key, {**ZERO})
        cell_counts[key]["k8s"] += 1
    for r in databases:
        key = (r["city"] or "Unknown", r["env"] or "Unknown")
        cell_counts.setdefault(key, {**ZERO})
        cell_counts[key]["db"] += 1
    for r in object_storage:
        key = (r["city"] or "Unknown", r["env"] or "Unknown")
        cell_counts.setdefault(key, {**ZERO})
        cell_counts[key]["oss"] += 1
    for r in nas:
        key = (r["city"] or "Unknown", r["env"] or "Unknown")
        cell_counts.setdefault(key, {**ZERO})
        cell_counts[key]["nas"] += 1

    by_city_env = sorted(
        [{"city": k[0], "env": k[1], **v,
          "total": sum(v.values())}
         for k, v in cell_counts.items()],
        key=lambda x: (
            {"Production": 0, "Non-Production": 1}.get(x["env"], 2),
            -x["total"],
            x["city"],
        ),
    )

    city_totals: dict[str, dict[str, int]] = {}
    for row in by_city_env:
        c = row["city"]
        city_totals.setdefault(c, {**ZERO})
        for k in ZERO:
            city_totals[c][k] += row[k]
    by_city = sorted(
        [{"city": k, **v, "total": sum(v.values())}
         for k, v in city_totals.items()],
        key=lambda x: -x["total"],
    )

    return ApiResponse(data={
        "summary": {
            "servers": len(servers),
            "containers": len(containers),
            "databases": len(databases),
            "object_storage": len(object_storage),
            "nas": len(nas),
        },
        "by_city": by_city,
        "by_city_env": by_city_env,
        "servers": [dict(r) for r in servers],
        "containers": [dict(r) for r in containers],
        "databases": [dict(r) for r in databases],
        "object_storage": [dict(r) for r in object_storage],
        "nas": [dict(r) for r in nas],
    })


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
