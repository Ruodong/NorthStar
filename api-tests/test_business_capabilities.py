"""Integration tests for /api/apps/{app_id}/business-capabilities.

Tests run against the NorthStar backend with EAM-synced data. The
anchor apps below are from EAM snapshot 2026-04-18:

  A000005  — 7 BCs across 4 L1 domains   (Badge&Facial Service)
  A002507  — mixed data_version (1.4/1.7/1.8)
  A999999  — unmapped (assert empty)
  X<hash>  — non-CMDB diagram-hash id (assert 200 empty, not 404)

If the sync has not yet populated ref_app_business_capability, tests
that require real data are skipped with a clear message.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


APP_MULTI_DOMAIN = "A000005"
APP_MIXED_VERSIONS = "A002507"
APP_UNMAPPED = "A999999"
APP_NON_CMDB = "XDEADBEEF0000"  # diagram-hash style, guaranteed no mapping


def _mapped_count(pg, app_id: str) -> int:
    with pg.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) AS n FROM northstar.ref_app_business_capability WHERE app_id = %s",
            (app_id,),
        )
        return cur.fetchone()["n"]


async def test_endpoint_200_for_unmapped_app(api):
    """AC-2: unmapped app → 200 with empty groups and count 0."""
    r = await api.get(f"/api/apps/{APP_UNMAPPED}/business-capabilities")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    d = body["data"]
    assert d["app_id"] == APP_UNMAPPED
    assert d["total_count"] == 0
    assert d["l1_groups"] == []


async def test_non_cmdb_app_returns_200_empty(api):
    """AC-4: non-CMDB app_id (X-prefixed) → 200 empty, never 404."""
    r = await api.get(f"/api/apps/{APP_NON_CMDB}/business-capabilities")
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["total_count"] == 0


async def test_multi_domain_grouping(api, pg):
    """AC-1: A000005 maps to multiple L1 domains with correct structure."""
    if _mapped_count(pg, APP_MULTI_DOMAIN) == 0:
        pytest.skip(f"{APP_MULTI_DOMAIN} has no mappings — run sync first")
    r = await api.get(f"/api/apps/{APP_MULTI_DOMAIN}/business-capabilities")
    assert r.status_code == 200
    d = r.json()["data"]
    assert d["total_count"] >= 2, "A000005 should have multiple BCs per EAM snapshot"
    assert len(d["l1_groups"]) >= 2, "should span >=2 L1 domains"
    # L1 order: count DESC, l1_domain ASC
    counts = [g["count"] for g in d["l1_groups"]]
    assert counts == sorted(counts, reverse=True), "L1 groups must be sorted by count DESC"
    # Each leaf has required fields
    first = d["l1_groups"][0]["l2_groups"][0]["leaves"][0]
    for field in ("bc_id", "bc_name", "level", "lv3_capability_group"):
        assert field in first
    assert first["level"] == 3, "only L3 leaves mapped per EAM data model"


async def test_owner_fields_present(api, pg):
    """FR-14: Owner fields (biz_owner/biz_team/dt_owner/dt_team) are in response."""
    if _mapped_count(pg, APP_MULTI_DOMAIN) == 0:
        pytest.skip(f"{APP_MULTI_DOMAIN} has no mappings — run sync first")
    r = await api.get(f"/api/apps/{APP_MULTI_DOMAIN}/business-capabilities")
    leaf = r.json()["data"]["l1_groups"][0]["l2_groups"][0]["leaves"][0]
    for field in ("biz_owner", "biz_team", "dt_owner", "dt_team"):
        assert field in leaf  # value may be null, key must exist


async def test_mixed_taxonomy_versions(api, pg):
    """AC-3: A002507 has mappings with mixed data_version → taxonomy_versions has >1 entry."""
    if _mapped_count(pg, APP_MIXED_VERSIONS) == 0:
        pytest.skip(f"{APP_MIXED_VERSIONS} has no mappings — run sync first")
    r = await api.get(f"/api/apps/{APP_MIXED_VERSIONS}/business-capabilities")
    d = r.json()["data"]
    # per EAM snapshot 2026-04-18, A002507 has versions 1.4, 1.7, 1.8
    assert len(d["taxonomy_versions"]) >= 2, f"expected mixed versions, got {d['taxonomy_versions']}"
    assert d["taxonomy_versions"] == sorted(d["taxonomy_versions"]), "versions must be sorted"


async def test_alembic_head_applied(pg):
    """AC-7: alembic_version table has 002_business_capabilities (or later)."""
    with pg.cursor() as cur:
        cur.execute("SELECT version_num FROM northstar.alembic_version")
        version = cur.fetchone()["version_num"]
    assert version != "001_baseline", "migration 002 should be applied"
    cur2 = pg.cursor()
    cur2.execute("""
        SELECT to_regclass('northstar.ref_business_capability') AS t1,
               to_regclass('northstar.ref_app_business_capability') AS t2
    """)
    row = cur2.fetchone()
    cur2.close()
    assert row["t1"] is not None
    assert row["t2"] is not None


async def test_orphan_mapping_counter_present(api, pg):
    """AC-6: orphan_mappings field is present and is a non-negative int."""
    r = await api.get(f"/api/apps/{APP_MULTI_DOMAIN}/business-capabilities")
    d = r.json()["data"]
    assert "orphan_mappings" in d
    assert isinstance(d["orphan_mappings"], int)
    assert d["orphan_mappings"] >= 0
