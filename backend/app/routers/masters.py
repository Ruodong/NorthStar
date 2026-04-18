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


# ---------------------------------------------------------------------------
# Application integrations — Provider / Consumer model
# ---------------------------------------------------------------------------
#
# Integration semantics per platform (who provides the endpoint = Provider):
#
#   APIH, KPaaS, Talend, PO, Data Service, Axway, Axway MFT,
#   Goanywhere-job, Goanywhere-web user  → source is Provider
#
#   WSO2 → target is Provider (target_endpoint is the real service URL;
#          source_endpoint is often N/A — the API is proxied via WSO2 to target)
#
# Provider-side aggregation (fan-out):
#   APIH  → (api_name, instance)       # one API per cluster
#   KPaaS → (topic_name, instance)     # one topic per cluster
#   WSO2  → interface_name              # one interface
#   others → interface_name

# Platforms where "source" means the Provider (supplier of the endpoint/topic/data)
_SOURCE_IS_PROVIDER: dict[str, bool] = {
    "APIH": True,
    "KPaaS": True,
    "Talend": True,
    "PO": True,
    "Data Service": True,
    "Axway": True,
    "Axway MFT": True,
    "Goanywhere-job": True,
    "Goanywhere-web user": True,
    "WSO2": False,  # target is Provider
}


def _my_role(row: dict, app_id: str) -> str:
    """Return 'provider' or 'consumer' from app_id's perspective for this row."""
    platform = row.get("integration_platform", "")
    src_is_provider = _SOURCE_IS_PROVIDER.get(platform, True)
    am_source = row.get("source_cmdb_id") == app_id
    if am_source:
        return "provider" if src_is_provider else "consumer"
    return "consumer" if src_is_provider else "provider"


def _aggregation_key(row: dict) -> str:
    """Stable key for grouping Provider rows into one interface/topic (fan-out)."""
    platform = row.get("integration_platform", "")
    if platform == "APIH":
        return "|".join([
            platform,
            row.get("api_name") or row.get("interface_name") or "",
            row.get("instance") or "",
        ])
    if platform == "KPaaS":
        return "|".join([
            platform,
            row.get("topic_name") or row.get("interface_name") or "",
            row.get("instance") or "",
        ])
    # All other platforms group by interface_name
    return f"{platform}|{row.get('interface_name') or ''}"


def _interface_label(row: dict) -> str:
    """Human-readable label for one interface/topic/API."""
    platform = row.get("integration_platform", "")
    if platform == "APIH":
        return row.get("api_name") or row.get("interface_name") or "(unnamed)"
    if platform == "KPaaS":
        return row.get("topic_name") or row.get("interface_name") or "(unnamed)"
    return row.get("interface_name") or "(unnamed)"


# Fields that describe the provided interface itself (shared across all rows
# of the same aggregation key). Frontend shows these once per interface card.
_INTERFACE_COMMON_FIELDS = [
    "integration_platform", "interface_name", "api_name", "topic_name",
    "instance", "location", "business_area", "interface_description",
    "api_postman_url", "api_spec", "data_mapping_file", "base",
    "git_project", "tag", "version", "frequency", "schedule",
    "interface_owner", "developer",
]


@router.get("/applications/{app_id}/integrations")
async def get_application_integrations(
    app_id: str,
    include_sunset: bool = Query(False, description="Include SUNSET-status interfaces"),
) -> ApiResponse:
    """Integration interfaces for an application.

    Returns two sections:
      - as_provider: interfaces I expose, grouped by (platform, interface_key),
        each group listing consumers (fan-out).
      - as_consumer: interfaces I use, one row per subscription.

    SUNSET-status rows are filtered by default; pass include_sunset=true to
    include them.
    """
    sql = """
        SELECT *
        FROM northstar.integration_interface
        WHERE source_cmdb_id = $1 OR target_cmdb_id = $1
        ORDER BY integration_platform, interface_name, interface_id
    """
    rows = await pg_client.fetch(sql, app_id)

    # Bucket rows by role (from app_id's perspective)
    provider_rows: list[dict] = []
    consumer_rows: list[dict] = []
    sunset_count = 0

    for r in rows:
        d = dict(r)
        status = (d.get("status") or "").upper()
        if status == "SUNSET":
            sunset_count += 1
            if not include_sunset:
                continue

        role = _my_role(d, app_id)
        if role == "provider":
            provider_rows.append(d)
        else:
            consumer_rows.append(d)

    # ---- Provider side: aggregate by interface key ----
    # {platform: {agg_key: {interface_info, consumers: [...]}}}
    provider_by_platform: dict[str, dict[str, dict]] = {}
    for r in provider_rows:
        platform = r["integration_platform"]
        key = _aggregation_key(r)
        platform_bucket = provider_by_platform.setdefault(platform, {})
        if key not in platform_bucket:
            # First row for this interface — capture common fields
            info = {k: r.get(k) for k in _INTERFACE_COMMON_FIELDS if r.get(k) is not None}
            info["key"] = key
            info["label"] = _interface_label(r)
            # Provider-side endpoint: for WSO2 it's target_endpoint; for others source_endpoint
            if platform == "WSO2":
                info["endpoint"] = r.get("target_endpoint")
                info["authentication"] = r.get("target_authentication")
                info["dc"] = r.get("target_dc")
                info["application_type"] = r.get("target_application_type")
            else:
                info["endpoint"] = r.get("source_endpoint")
                info["authentication"] = r.get("source_authentication")
                info["dc"] = r.get("source_dc")
                info["application_type"] = r.get("source_application_type")
            # My account name on provider side
            if platform in ("APIH", "KPaaS"):
                info["account_name"] = (
                    r.get("target_account_name") if platform == "WSO2"
                    else r.get("source_account_name")
                )
            # Statuses present across this interface's rows
            info["statuses"] = set()
            info["consumers"] = []
            info["_seen_consumer_keys"] = set()
            platform_bucket[key] = info

        info = platform_bucket[key]
        # Consumer (the OTHER side of this row)
        if platform == "WSO2":
            consumer_id = r.get("source_cmdb_id")
            consumer_name = r.get("source_app_name")
            consumer_account = r.get("source_account_name")
            consumer_endpoint = r.get("source_endpoint")
        else:
            consumer_id = r.get("target_cmdb_id")
            consumer_name = r.get("target_app_name")
            consumer_account = r.get("target_account_name")
            consumer_endpoint = r.get("target_endpoint")

        consumer_key = f"{consumer_id or ''}|{consumer_account or ''}|{consumer_endpoint or ''}"
        if consumer_key not in info["_seen_consumer_keys"]:
            info["_seen_consumer_keys"].add(consumer_key)
            info["consumers"].append({
                "app_id": consumer_id,
                "app_name": consumer_name,
                "account_name": consumer_account,
                "endpoint": consumer_endpoint,
                "status": r.get("status"),
                "interface_id": r["interface_id"],
            })
        if r.get("status"):
            info["statuses"].add(r["status"])

    # Sanitize: convert set → list, drop internal fields
    provider_out: dict[str, dict] = {}
    for platform, bucket in provider_by_platform.items():
        interfaces = []
        total_consumers = 0
        for info in bucket.values():
            info["statuses"] = sorted(info["statuses"])
            info.pop("_seen_consumer_keys", None)
            total_consumers += len(info["consumers"])
            interfaces.append(info)
        # Sort interfaces by consumer count DESC, then by label
        interfaces.sort(key=lambda x: (-len(x["consumers"]), x["label"]))
        provider_out[platform] = {
            "total_interfaces": len(interfaces),
            "total_consumers": total_consumers,
            "interfaces": interfaces,
        }

    # ---- Consumer side: list per-row, grouped only by platform ----
    consumer_out: dict[str, dict] = {}
    for r in consumer_rows:
        platform = r["integration_platform"]
        # The Provider is the OTHER side
        if platform == "WSO2":
            provider_id = r.get("target_cmdb_id")
            provider_name = r.get("target_app_name")
            provider_endpoint = r.get("target_endpoint")
            my_endpoint = r.get("source_endpoint")
            my_account = r.get("source_account_name")
        else:
            provider_id = r.get("source_cmdb_id")
            provider_name = r.get("source_app_name")
            provider_endpoint = r.get("source_endpoint")
            my_endpoint = r.get("target_endpoint")
            my_account = r.get("target_account_name")

        entry = {
            "interface_id": r["interface_id"],
            "label": _interface_label(r),
            "integration_platform": platform,
            "interface_name": r.get("interface_name"),
            "api_name": r.get("api_name"),
            "topic_name": r.get("topic_name"),
            "instance": r.get("instance"),
            "provider": {
                "app_id": provider_id,
                "app_name": provider_name,
                "endpoint": provider_endpoint,
            },
            "my_account_name": my_account,
            "my_endpoint": my_endpoint,
            "business_area": r.get("business_area"),
            "description": r.get("interface_description"),
            "status": r.get("status"),
            "interface_owner": r.get("interface_owner"),
            "frequency": r.get("frequency"),
            "location": r.get("location"),
            "api_postman_url": r.get("api_postman_url"),
            "data_mapping_file": r.get("data_mapping_file"),
            "base": r.get("base"),
        }
        consumer_out.setdefault(platform, {"total": 0, "rows": []})
        consumer_out[platform]["rows"].append(entry)

    for platform, bucket in consumer_out.items():
        bucket["total"] = len(bucket["rows"])
        bucket["rows"].sort(key=lambda x: (x["label"], x["interface_id"]))

    # Platform ordering — preferred then alphabetical
    PRIORITY = ["WSO2", "APIH", "KPaaS", "Talend", "PO", "Data Service",
                "Axway", "Axway MFT", "Goanywhere-job", "Goanywhere-web user"]
    all_platforms = sorted(
        set(provider_out.keys()) | set(consumer_out.keys()),
        key=lambda p: (PRIORITY.index(p) if p in PRIORITY else 99, p),
    )

    total_provider_interfaces = sum(
        v["total_interfaces"] for v in provider_out.values()
    )
    total_provider_consumers = sum(
        v["total_consumers"] for v in provider_out.values()
    )
    total_consumer = sum(v["total"] for v in consumer_out.values())

    return ApiResponse(data={
        "app_id": app_id,
        "platforms": all_platforms,
        "sunset_count": sunset_count,
        "include_sunset": include_sunset,
        "as_provider": {
            "total_interfaces": total_provider_interfaces,
            "total_consumers": total_provider_consumers,
            "by_platform": provider_out,
        },
        "as_consumer": {
            "total": total_consumer,
            "by_platform": consumer_out,
        },
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
