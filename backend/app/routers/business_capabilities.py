"""Business Capability APIs.

Two router prefixes:
  /api/apps/{app_id}/business-capabilities  — BCs for one app (existing)
  /api/business-capabilities                 — browse the BC taxonomy + apps

All reads hit Postgres (ref_business_capability + ref_app_business_capability),
both synced from EAM. No mutations — EAM is source of truth.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import ApiResponse, AppBusinessCapabilitiesResponse
from app.services import business_capabilities as bc_service
from app.services import pg_client

router = APIRouter(tags=["business-capabilities"])


@router.get(
    "/api/apps/{app_id}/business-capabilities",
    response_model=ApiResponse[AppBusinessCapabilitiesResponse],
)
async def get_app_business_capabilities(app_id: str) -> ApiResponse:
    data = await bc_service.get_app_business_capabilities(app_id)
    return ApiResponse(data=data)


@router.get("/api/business-capabilities")
async def list_business_capabilities() -> ApiResponse:
    """Return the full BC taxonomy as a 3-level tree with app counts.

    Shape:
      [
        {
          bc_id, bc_name, level=1, app_count,
          children: [  // L2
            {
              bc_id, bc_name, level=2, app_count,
              children: [  // L3
                {bc_id, bc_name, level=3, app_count}
              ]
            }
          ]
        }, ...
      ]
    """
    # The ref_business_capability table holds multiple data_versions of the
    # same BC. Dedup by bc_id, keeping the latest-synced row. We do this as
    # a subquery; same approach for app mappings.
    bcs = await pg_client.fetch(
        """
        SELECT DISTINCT ON (bc_id)
            bc_id, parent_bc_id, bc_name, bc_name_cn, level, bc_description
        FROM northstar.ref_business_capability
        ORDER BY bc_id, synced_at DESC, data_version DESC
        """
    )

    # Load all unique (bc_id → app_id) pairs. JOIN on bc_id (not the bigint
    # master_id) since the master_id is version-specific but bc_id is stable.
    try:
        app_rows = await pg_client.fetch(
            """
            SELECT DISTINCT
                COALESCE(m.bc_id, bc.bc_id) AS bc_id,
                m.app_id
            FROM northstar.ref_app_business_capability m
            LEFT JOIN northstar.ref_business_capability bc
              ON bc.id = m.bcpf_master_id
            WHERE COALESCE(m.bc_id, bc.bc_id) IS NOT NULL
            """
        )
        bc_to_apps: dict[str, set[str]] = {}
        for r in app_rows:
            bc_to_apps.setdefault(r["bc_id"], set()).add(r["app_id"])
    except Exception:
        bc_to_apps = {}

    # Index BCs
    bc_by_id: dict[str, dict] = {}
    for r in bcs:
        bc_by_id[r["bc_id"]] = {
            "bc_id": r["bc_id"],
            "bc_name": r["bc_name"],
            "bc_name_cn": r["bc_name_cn"],
            "level": r["level"],
            "description": r["bc_description"],
            "children": [],
            "_app_set": set(bc_to_apps.get(r["bc_id"], set())),
        }

    # Link children to parents
    roots: list[dict] = []
    for r in bcs:
        node = bc_by_id[r["bc_id"]]
        parent_id = r["parent_bc_id"]
        if not parent_id or parent_id == "root" or parent_id not in bc_by_id:
            roots.append(node)
        else:
            bc_by_id[parent_id]["children"].append(node)

    # Rollup app sets bottom-up (L3 → L2 → L1)
    def rollup(node: dict) -> set[str]:
        apps = set(node["_app_set"])
        for c in node["children"]:
            apps |= rollup(c)
        node["_app_set"] = apps
        node["app_count"] = len(apps)
        return apps

    for root in roots:
        rollup(root)

    # Strip internal _app_set; sort children by app_count DESC then bc_id
    def clean(node: dict) -> dict:
        node.pop("_app_set", None)
        node["children"] = sorted(
            [clean(c) for c in node["children"]],
            key=lambda n: (-n["app_count"], n["bc_id"]),
        )
        return node

    roots_clean = sorted(
        [clean(n) for n in roots],
        key=lambda n: (-n["app_count"], n["bc_id"]),
    )

    return ApiResponse(data={
        "total_bcs": len(bcs),
        "total_mapped_apps": len({a for apps in bc_to_apps.values() for a in apps}),
        "tree": roots_clean,
    })


@router.get("/api/business-capabilities/{bc_id}/apps")
async def get_apps_by_business_capability(
    bc_id: str,
    include_descendants: bool = True,
) -> ApiResponse:
    """Return all apps mapped to the given BC.

    include_descendants=True (default): recursively include apps in child
    BCs too (typical case — selecting L1 "Product Development" should
    surface all apps in any descendant).

    include_descendants=False: only direct mappings on this exact BC.
    """
    # Resolve target BC ids
    if include_descendants:
        bc_ids_rows = await pg_client.fetch(
            """
            WITH RECURSIVE latest_bc AS (
                SELECT DISTINCT ON (bc_id)
                    bc_id, parent_bc_id, bc_name, level
                FROM northstar.ref_business_capability
                ORDER BY bc_id, synced_at DESC, data_version DESC
            ),
            descendants AS (
                SELECT bc_id, parent_bc_id, bc_name, level
                FROM latest_bc
                WHERE bc_id = $1
                UNION ALL
                SELECT b.bc_id, b.parent_bc_id, b.bc_name, b.level
                FROM latest_bc b
                JOIN descendants d ON b.parent_bc_id = d.bc_id
            )
            SELECT DISTINCT bc_id FROM descendants
            """,
            bc_id,
        )
        target_ids = [r["bc_id"] for r in bc_ids_rows]
    else:
        target_ids = [bc_id]

    if not target_ids:
        return ApiResponse(data={"bc_id": bc_id, "apps": [], "total": 0})

    # Load the root BC details — dedup by bc_id, keep latest synced
    root = await pg_client.fetchrow(
        """
        SELECT DISTINCT ON (bc_id)
            bc_id, bc_name, bc_name_cn, level, bc_description
        FROM northstar.ref_business_capability
        WHERE bc_id = $1
        ORDER BY bc_id, synced_at DESC, data_version DESC
        """,
        bc_id,
    )

    # Fetch mapped apps. Match on bc_id (stable) not bigint id (version-specific).
    # Dedup by app_id — keep one row per app even if the mapping table has
    # multiple rows across data versions.
    try:
        app_rows = await pg_client.fetch(
            """
            WITH latest_bc AS (
                SELECT DISTINCT ON (bc_id)
                    bc_id, bc_name, level
                FROM northstar.ref_business_capability
                ORDER BY bc_id, synced_at DESC, data_version DESC
            )
            SELECT DISTINCT ON (a.app_id)
                a.app_id, a.name, a.status, a.app_ownership,
                a.u_service_area, a.portfolio_mgt,
                bc.bc_id    AS mapped_bc_id,
                bc.bc_name  AS mapped_bc_name,
                bc.level    AS mapped_bc_level
            FROM northstar.ref_app_business_capability m
            JOIN latest_bc bc
              ON bc.bc_id = COALESCE(m.bc_id, (
                SELECT bc2.bc_id FROM northstar.ref_business_capability bc2
                WHERE bc2.id = m.bcpf_master_id LIMIT 1
              ))
            JOIN northstar.ref_application a
              ON a.app_id = m.app_id
            WHERE bc.bc_id = ANY($1::text[])
            ORDER BY a.app_id, bc.level DESC
            """,
            target_ids,
        )
    except Exception:
        app_rows = []

    # Dedup by app_id — keep the deepest (leaf) BC match
    apps_by_id: dict[str, dict] = {}
    for r in app_rows:
        d = dict(r)
        existing = apps_by_id.get(d["app_id"])
        if not existing or (d["mapped_bc_level"] or 0) > (existing["mapped_bc_level"] or 0):
            apps_by_id[d["app_id"]] = d

    apps = sorted(apps_by_id.values(), key=lambda x: x["app_id"])

    return ApiResponse(data={
        "bc_id": bc_id,
        "bc_name": root["bc_name"] if root else None,
        "bc_name_cn": root["bc_name_cn"] if root else None,
        "level": root["level"] if root else None,
        "include_descendants": include_descendants,
        "total": len(apps),
        "apps": apps,
    })
