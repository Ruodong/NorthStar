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


def _parse_multi(val: Optional[str]) -> list[str]:
    """Split a comma-separated query param into a list of non-empty strings."""
    if not val:
        return []
    return [v.strip() for v in val.split(",") if v.strip()]


@router.get("/applications")
async def list_applications(
    q: Optional[str] = None,
    status: Optional[str] = None,
    app_ownership: Optional[str] = None,
    portfolio_mgt: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """List applications from the full CMDB (ref_application).

    LEFT JOINs ref_application_tco for budget data. Apps without TCO
    show budget/actual as null. Filters accept comma-separated multi-values.
    Default sort: budget_k DESC (nulls last).
    """
    where = []
    args: list = []
    if q:
        args.append(f"%{q}%")
        where.append(
            f"(a.name ILIKE ${len(args)} OR a.app_id ILIKE ${len(args)}"
            f" OR a.app_full_name ILIKE ${len(args)})"
        )

    # Status — supports multi-value + __EMPTY__ sentinel
    status_vals = _parse_multi(status)
    if status_vals:
        has_empty = EMPTY_SENTINEL in status_vals
        real_vals = [v for v in status_vals if v != EMPTY_SENTINEL]
        parts = []
        if real_vals:
            args.append(real_vals)
            parts.append(f"a.status = ANY(${len(args)}::text[])")
        if has_empty:
            parts.append("(a.status IS NULL OR a.status = '')")
        where.append(f"({' OR '.join(parts)})")

    # Ownership — multi-value + __EMPTY__ sentinel
    own_vals = _parse_multi(app_ownership)
    if own_vals:
        has_empty = EMPTY_SENTINEL in own_vals
        real_vals = [v for v in own_vals if v != EMPTY_SENTINEL]
        parts = []
        if real_vals:
            args.append(real_vals)
            parts.append(f"a.app_ownership = ANY(${len(args)}::text[])")
        if has_empty:
            parts.append("(a.app_ownership IS NULL OR a.app_ownership = '')")
        where.append(f"({' OR '.join(parts)})")

    # Portfolio — multi-value + __EMPTY__ sentinel
    port_vals = _parse_multi(portfolio_mgt)
    if port_vals:
        has_empty = EMPTY_SENTINEL in port_vals
        real_vals = [v for v in port_vals if v != EMPTY_SENTINEL]
        parts = []
        if real_vals:
            args.append(real_vals)
            parts.append(f"a.portfolio_mgt = ANY(${len(args)}::text[])")
        if has_empty:
            parts.append("(a.portfolio_mgt IS NULL OR a.portfolio_mgt = '')")
        where.append(f"({' OR '.join(parts)})")

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
        ORDER BY t.budget_k DESC NULLS LAST, a.name ASC NULLS LAST, a.app_id
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
               have_dr, model_type, is_dmz,
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


# Per-platform field selections — each platform has different "most useful"
# columns. The frontend renders whichever of these are non-null.
_PLATFORM_FIELD_SETS: dict[str, list[str]] = {
    "WSO2": [
        "interface_name", "api_postman_url", "source_connection_type",
        "target_connection_type", "source_authentication", "target_authentication",
        "business_area", "source_endpoint", "target_endpoint",
        "source_payload_size", "target_payload_size",
        "developer", "interface_owner", "location", "status",
    ],
    "APIH": [
        "api_name", "source_account_name", "target_account_name",
        "instance", "interface_description", "status",
    ],
    "KPaaS": [
        "topic_name", "source_account_name", "target_account_name",
        "instance", "interface_description", "status",
    ],
    "Talend": [
        "interface_name", "source_endpoint", "target_endpoint",
        "source_dc", "target_dc", "business_area", "status",
    ],
    "PO": [
        "interface_name", "source_endpoint", "target_endpoint",
        "source_connection_type", "target_connection_type",
        "data_mapping_file", "frequency", "status",
    ],
    "Data Service": [
        "interface_name", "source_endpoint", "target_endpoint",
        "source_connection_type", "target_connection_type",
        "source_owner", "target_owner", "git_project", "status",
    ],
    "Axway": [
        "interface_name", "source_connection_type", "target_connection_type",
        "data_mapping_file", "base", "tag", "status",
    ],
    "Axway MFT": [
        "interface_name", "source_endpoint", "target_endpoint",
        "base", "frequency", "tag", "status",
    ],
    "Goanywhere-job": [
        "interface_name", "source_endpoint", "target_endpoint",
        "base", "frequency", "tag", "status",
    ],
    "Goanywhere-web user": [
        "interface_name", "interface_owner", "base", "frequency", "status",
    ],
}

# Always-included fields (regardless of platform) that the frontend uses
# for rendering the header row of each interface card
_CORE_FIELDS = [
    "interface_id",
    "integration_platform",
    "interface_name",
    "source_cmdb_id", "target_cmdb_id",
    "source_app_name", "target_app_name",
    "status",
]


@router.get("/applications/{app_id}/integrations")
async def get_application_integrations(app_id: str) -> ApiResponse:
    """Integration interfaces for an application, grouped by platform.

    Returns inbound (this app is target) and outbound (this app is source)
    interface rows from northstar.integration_interface, grouped per
    integration_platform with platform-specific useful fields.

    Frontend renders each platform as a section with platform-appropriate
    columns per _PLATFORM_FIELD_SETS.
    """
    rows = await pg_client.fetch(
        """
        SELECT *
        FROM northstar.integration_interface
        WHERE source_cmdb_id = $1 OR target_cmdb_id = $1
        ORDER BY integration_platform, interface_name
        """,
        app_id,
    )

    outbound: dict[str, list[dict]] = {}
    inbound: dict[str, list[dict]] = {}
    platforms_seen: set[str] = set()

    for r in rows:
        d = dict(r)
        platform = d["integration_platform"]
        platforms_seen.add(platform)

        # Pick per-platform useful fields; always include core fields
        wanted = set(_CORE_FIELDS + _PLATFORM_FIELD_SETS.get(platform, []))
        # Counterpart side info
        if d["source_cmdb_id"] == app_id:
            # outbound — show target
            wanted.update([
                "target_cmdb_id", "target_app_name", "target_endpoint",
                "target_connection_type", "target_authentication",
                "target_account_name", "target_dc", "target_owner",
                "target_application_type",
            ])
            bucket = outbound
        else:
            wanted.update([
                "source_cmdb_id", "source_app_name", "source_endpoint",
                "source_connection_type", "source_authentication",
                "source_account_name", "source_dc", "source_owner",
                "source_application_type",
            ])
            bucket = inbound

        filtered = {k: v for k, v in d.items() if k in wanted and v is not None}
        # Keep raw_fields nested if present and platform-relevant
        if d.get("raw_fields"):
            filtered["raw_fields"] = d["raw_fields"]

        bucket.setdefault(platform, []).append(filtered)

    # Sort platforms in a stable preferred order, then alphabetical
    PRIORITY = ["WSO2", "APIH", "KPaaS", "Talend", "PO", "Data Service",
                "Axway", "Axway MFT", "Goanywhere-job", "Goanywhere-web user"]
    platform_order = sorted(
        platforms_seen,
        key=lambda p: (PRIORITY.index(p) if p in PRIORITY else 99, p),
    )

    # Totals per platform + overall
    summary = {
        p: {
            "outbound": len(outbound.get(p, [])),
            "inbound": len(inbound.get(p, [])),
            "total": len(outbound.get(p, [])) + len(inbound.get(p, [])),
        }
        for p in platform_order
    }
    total_outbound = sum(s["outbound"] for s in summary.values())
    total_inbound = sum(s["inbound"] for s in summary.values())

    return ApiResponse(data={
        "app_id": app_id,
        "total_interfaces": total_outbound + total_inbound,
        "total_outbound": total_outbound,
        "total_inbound": total_inbound,
        "platforms": platform_order,
        "summary_by_platform": summary,
        "outbound_by_platform": outbound,
        "inbound_by_platform": inbound,
    })


@router.get("/projects")
async def list_projects(
    q: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> ApiResponse:
    """List MSPO projects with application counts derived from draw.io diagrams.

    Each row includes app_count (CMDB-linked apps referenced in diagrams),
    new_count, change_count, sunset_count.
    """
    where = ["1=1"]
    args: list = []
    if q:
        args.append(f"%{q}%")
        where.append(
            f"(p.project_name ILIKE ${len(args)} OR p.project_id ILIKE ${len(args)}"
            f" OR p.pm ILIKE ${len(args)})"
        )
    if status == EMPTY_SENTINEL:
        where.append("(p.status IS NULL OR p.status = '')")
    elif status:
        args.append(status)
        where.append(f"p.status = ${len(args)}")
    where_clause = "WHERE " + " AND ".join(where)
    args.extend([limit, offset])
    rows = await pg_client.fetch(
        f"""
        SELECT p.project_id, p.project_name, p.type, p.status,
               p.pm, p.it_lead, p.dt_lead,
               p.start_date, p.go_live_date, p.end_date, p.source,
               COALESCE(ac.app_count, 0)    AS app_count,
               COALESCE(ac.new_count, 0)    AS new_count,
               COALESCE(ac.change_count, 0) AS change_count,
               COALESCE(ac.sunset_count, 0) AS sunset_count
        FROM northstar.ref_project p
        LEFT JOIN LATERAL (
            SELECT
                count(DISTINCT cda.resolved_app_id)
                    FILTER (WHERE cda.resolved_app_id ~ '^A\\d') AS app_count,
                count(DISTINCT cda.resolved_app_id)
                    FILTER (WHERE cda.application_status = 'New'
                            AND cda.resolved_app_id ~ '^A\\d') AS new_count,
                count(DISTINCT cda.resolved_app_id)
                    FILTER (WHERE cda.application_status = 'Change'
                            AND cda.resolved_app_id ~ '^A\\d') AS change_count,
                count(DISTINCT cda.resolved_app_id)
                    FILTER (WHERE cda.application_status = 'Sunset'
                            AND cda.resolved_app_id ~ '^A\\d') AS sunset_count
            FROM northstar.confluence_diagram_app cda
            JOIN northstar.confluence_attachment ca ON ca.attachment_id = cda.attachment_id
            JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
            WHERE COALESCE(cp.root_project_id, cp.project_id) = p.project_id
        ) ac ON true
        {where_clause}
        ORDER BY ac.app_count DESC NULLS LAST, p.project_id DESC
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    total = await pg_client.fetchval(
        f"SELECT count(*) FROM northstar.ref_project p {where_clause}",
        *args[:-2],
    )
    return ApiResponse(
        data={
            "total": total,
            "rows": [dict(r) for r in rows],
        }
    )


@router.get("/projects/{project_id}")
async def get_project(project_id: str) -> ApiResponse:
    """Single project with its referenced applications (apps-first view)."""
    project = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_project WHERE project_id = $1",
        project_id,
    )
    if project is None:
        raise HTTPException(status_code=404, detail=f"{project_id} not found")

    # Applications referenced in this project's draw.io diagrams (CMDB-linked)
    apps = await pg_client.fetch(
        """
        SELECT DISTINCT
            COALESCE(cda.resolved_app_id, cda.standard_id) AS app_id,
            cda.app_name,
            cda.application_status AS role,
            ra.name              AS cmdb_name,
            ra.status            AS cmdb_status,
            ra.app_ownership,
            ra.portfolio_mgt,
            ra.u_service_area,
            t.budget_k
        FROM northstar.confluence_diagram_app cda
        JOIN northstar.confluence_attachment ca ON ca.attachment_id = cda.attachment_id
        JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
        LEFT JOIN northstar.ref_application ra
            ON ra.app_id = COALESCE(cda.resolved_app_id, cda.standard_id)
        LEFT JOIN northstar.ref_application_tco t
            ON t.app_id = ra.app_id
        WHERE COALESCE(cp.root_project_id, cp.project_id) = $1
          AND COALESCE(cda.resolved_app_id, cda.standard_id) ~ '^A\\d'
        ORDER BY cda.application_status, cda.app_name
        """,
        project_id,
    )

    # Confluence pages for this project (ARD documents)
    pages = await pg_client.fetch(
        """
        SELECT page_id, title, page_url, fiscal_year, depth,
               body_size_chars, q_pm, q_it_lead, q_dt_lead
        FROM northstar.confluence_page
        WHERE project_id = $1 OR root_project_id = $1
        ORDER BY depth, title
        """,
        project_id,
    )

    # Drawio attachments
    diagrams = await pg_client.fetch(
        """
        SELECT ca.attachment_id, ca.title AS file_name, ca.file_kind,
               cp.page_id::text, cp.title AS page_title, cp.fiscal_year
        FROM northstar.confluence_attachment ca
        JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
        WHERE (cp.project_id = $1 OR cp.root_project_id = $1)
          AND ca.file_kind IN ('drawio', 'drawio_xml')
        ORDER BY cp.fiscal_year DESC, ca.title
        """,
        project_id,
    )

    # Convert Decimal
    from decimal import Decimal as _D

    def clean(r: dict) -> dict:
        return {k: (float(v) if isinstance(v, _D) else v) for k, v in r.items()}

    # Role summary counts
    role_counts: dict[str, int] = {}
    for a in apps:
        role = a["role"] or "Unknown"
        role_counts[role] = role_counts.get(role, 0) + 1

    return ApiResponse(data={
        "project": dict(project),
        "applications": [clean(dict(a)) for a in apps],
        "role_summary": role_counts,
        "pages": [dict(p) for p in pages],
        "diagrams": [dict(d) for d in diagrams],
    })


@router.get("/employees/{itcode}")
async def get_employee(itcode: str) -> ApiResponse:
    row = await pg_client.fetchrow(
        "SELECT * FROM northstar.ref_employee WHERE itcode = $1",
        itcode,
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"{itcode} not found")
    return ApiResponse(data=dict(row))
