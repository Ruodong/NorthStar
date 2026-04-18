"""Data access for Business Capability mappings.

Reads northstar.ref_app_business_capability joined with
northstar.ref_business_capability. Groups results by L1 Domain → L2
Subdomain → L3 leaf. Ordering: L1 by (count DESC, name ASC); L2 by name
ASC; leaves by bc_id ASC.

See .specify/features/business-capabilities/api.md §3.
"""
from __future__ import annotations

from collections import defaultdict

from app.services import pg_client


MAIN_QUERY = """
SELECT
    m.id                                AS mapping_id,
    m.app_id,
    m.data_version                      AS mapping_data_version,
    m.source_updated_at,
    m.synced_at,
    bc.id                               AS bcpf_master_id,
    bc.bc_id,
    bc.bc_name,
    NULLIF(bc.bc_name_cn, '')           AS bc_name_cn,
    NULLIF(bc.bc_description, '')       AS bc_description,
    bc.level,
    COALESCE(bc.lv1_domain, '')         AS lv1_domain,
    NULLIF(bc.lv2_sub_domain, '')       AS lv2_sub_domain,
    NULLIF(bc.lv3_capability_group,'')  AS lv3_capability_group,
    NULLIF(bc.biz_owner, '')            AS biz_owner,
    NULLIF(bc.biz_team, '')             AS biz_team,
    NULLIF(bc.dt_owner, '')             AS dt_owner,
    NULLIF(bc.dt_team, '')              AS dt_team
FROM northstar.ref_app_business_capability m
JOIN northstar.ref_business_capability bc
  ON bc.id = m.bcpf_master_id
WHERE m.app_id = $1
ORDER BY
    COALESCE(bc.lv1_domain, '') ASC,
    bc.lv2_sub_domain ASC NULLS LAST,
    bc.bc_id ASC
"""

ORPHAN_QUERY = """
SELECT COUNT(*) AS orphans
FROM northstar.ref_app_business_capability m
LEFT JOIN northstar.ref_business_capability bc
  ON bc.id = m.bcpf_master_id
WHERE m.app_id = $1 AND bc.id IS NULL
"""


async def get_app_business_capabilities(app_id: str) -> dict:
    rows = await pg_client.fetch(MAIN_QUERY, app_id)
    orphan_count = await pg_client.fetchval(ORPHAN_QUERY, app_id) or 0

    # Bucket leaves under (l1_domain, l2_subdomain)
    l1_buckets: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    versions: set[str] = set()
    last_synced = None

    for r in rows:
        d = dict(r)
        l1 = d["lv1_domain"] or ""
        l2 = d["lv2_sub_domain"] or ""
        leaf = {
            "bc_id": d["bc_id"],
            "bc_name": d["bc_name"],
            "bc_name_cn": d["bc_name_cn"],
            "bc_description": d["bc_description"],
            "level": d["level"],
            "lv3_capability_group": d["lv3_capability_group"] or d["bc_name"],
            "biz_owner": d["biz_owner"],
            "biz_team": d["biz_team"],
            "dt_owner": d["dt_owner"],
            "dt_team": d["dt_team"],
            "data_version": d["mapping_data_version"],
            "source_updated_at": d["source_updated_at"],
        }
        l1_buckets[l1][l2].append(leaf)
        if d["mapping_data_version"]:
            versions.add(d["mapping_data_version"])
        if d["synced_at"] and (last_synced is None or d["synced_at"] > last_synced):
            last_synced = d["synced_at"]

    # Assemble L1 groups, re-sort by (count DESC, l1_domain ASC)
    l1_groups = []
    for l1_name, l2_map in l1_buckets.items():
        l2_groups = [
            {"l2_subdomain": l2_name, "leaves": leaves}
            for l2_name, leaves in sorted(l2_map.items())
        ]
        total = sum(len(g["leaves"]) for g in l2_groups)
        l1_groups.append({
            "l1_domain": l1_name,
            "count": total,
            "l2_groups": l2_groups,
        })
    l1_groups.sort(key=lambda g: (-g["count"], g["l1_domain"]))

    total_count = sum(g["count"] for g in l1_groups)

    return {
        "app_id": app_id,
        "total_count": total_count,
        "l1_groups": l1_groups,
        "taxonomy_versions": sorted(versions),
        "last_synced_at": last_synced,
        "orphan_mappings": int(orphan_count),
    }
