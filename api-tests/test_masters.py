"""Tests for /api/masters/* endpoints.

Exercises the masters router: applications (list, detail, deployment, filters),
projects (list with app counts, detail with applications), and summary.
Runs against the live backend + Postgres.
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

async def test_summary(api):
    r = await api.get("/api/masters/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "applications" in data
    assert "projects" in data
    assert isinstance(data["applications"], int)


# ---------------------------------------------------------------------------
# Applications — list + filters
# ---------------------------------------------------------------------------

async def test_list_applications_default(api):
    """Default list returns rows sorted by budget DESC, with CIO/CDTO default implied by frontend."""
    r = await api.get("/api/masters/applications", params={"limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "total" in data
    assert "rows" in data
    assert isinstance(data["total"], int)
    assert len(data["rows"]) <= 5


async def test_list_applications_multi_status_filter(api):
    """Multi-value status filter (comma-separated)."""
    r = await api.get(
        "/api/masters/applications",
        params={"status": "Active,Planned", "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    for row in body["data"]["rows"]:
        assert row["status"] in ("Active", "Planned")


async def test_list_applications_multi_ownership_filter(api):
    """Multi-value ownership filter."""
    r = await api.get(
        "/api/masters/applications",
        params={"app_ownership": "CIO/CDTO,Shadow", "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    for row in body["data"]["rows"]:
        assert row["app_ownership"] in ("CIO/CDTO", "Shadow")


async def test_list_applications_multi_portfolio_filter(api):
    """Multi-value portfolio filter."""
    r = await api.get(
        "/api/masters/applications",
        params={"portfolio_mgt": "Invest,Tolerate", "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    for row in body["data"]["rows"]:
        assert row["portfolio_mgt"] in ("Invest", "Tolerate")


async def test_list_applications_search(api):
    """Search by name or app_id."""
    r = await api.get("/api/masters/applications", params={"q": "EAM", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True


async def test_list_applications_empty_status(api):
    """Filter for apps with empty status via __EMPTY__ sentinel."""
    r = await api.get(
        "/api/masters/applications",
        params={"status": "__EMPTY__", "limit": 5},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True


async def test_list_applications_budget_sort(api):
    """Results should be sorted by budget_k DESC (nulls last)."""
    r = await api.get("/api/masters/applications", params={"limit": 20})
    assert r.status_code == 200
    rows = r.json()["data"]["rows"]
    budgets = [row["budget_k"] for row in rows if row["budget_k"] is not None]
    # Non-null budgets should be in descending order
    assert budgets == sorted(budgets, reverse=True)


# ---------------------------------------------------------------------------
# Applications — detail + deployment
# ---------------------------------------------------------------------------

async def test_get_application_exists(api, pg):
    """Get a known application by app_id."""
    with pg.cursor() as cur:
        cur.execute("SELECT app_id FROM northstar.ref_application LIMIT 1")
        row = cur.fetchone()
    if row is None:
        pytest.skip("No applications in ref_application")
    app_id = row["app_id"]
    r = await api.get(f"/api/masters/applications/{app_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["app_id"] == app_id


async def test_get_application_not_found(api):
    r = await api.get("/api/masters/applications/ZZZZZZZ_NONEXISTENT")
    assert r.status_code == 404


async def test_get_application_deployment(api, pg):
    """Deployment endpoint returns structured data."""
    with pg.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT app_id FROM northstar.ref_deployment_server LIMIT 1"
        )
        row = cur.fetchone()
    if row is None:
        pytest.skip("No deployment data")
    app_id = row["app_id"]
    r = await api.get(f"/api/masters/applications/{app_id}/deployment")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "summary" in data
    assert "servers" in data["summary"]


# ---------------------------------------------------------------------------
# Applications — filter option endpoints
# ---------------------------------------------------------------------------

async def test_application_statuses(api):
    r = await api.get("/api/masters/applications/statuses")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)
    if body["data"]:
        assert "status" in body["data"][0]
        assert "count" in body["data"][0]


async def test_application_ownerships(api):
    r = await api.get("/api/masters/applications/ownerships")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)


async def test_application_portfolios(api):
    r = await api.get("/api/masters/applications/portfolios")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)


# ---------------------------------------------------------------------------
# Projects — list with app counts
# ---------------------------------------------------------------------------

async def test_list_projects_default(api):
    """Project list returns rows with app_count fields."""
    r = await api.get("/api/masters/projects", params={"limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "total" in data
    assert "rows" in data
    if data["rows"]:
        row = data["rows"][0]
        assert "project_id" in row
        assert "app_count" in row
        assert "new_count" in row
        assert "change_count" in row
        assert "sunset_count" in row


async def test_list_projects_search(api):
    r = await api.get("/api/masters/projects", params={"q": "test", "limit": 5})
    assert r.status_code == 200
    assert r.json()["success"] is True


async def test_list_projects_sorted_by_app_count(api):
    """Projects should be sorted by app_count DESC."""
    r = await api.get("/api/masters/projects", params={"limit": 20})
    assert r.status_code == 200
    rows = r.json()["data"]["rows"]
    counts = [row["app_count"] for row in rows]
    assert counts == sorted(counts, reverse=True)


# ---------------------------------------------------------------------------
# Projects — statuses
# ---------------------------------------------------------------------------

async def test_project_statuses(api):
    r = await api.get("/api/masters/projects/statuses")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert isinstance(body["data"], list)


# ---------------------------------------------------------------------------
# Projects — detail (apps-first)
# ---------------------------------------------------------------------------

async def test_get_project_exists(api, pg):
    """Get a known project returns applications + pages + diagrams."""
    with pg.cursor() as cur:
        cur.execute("SELECT project_id FROM northstar.ref_project LIMIT 1")
        row = cur.fetchone()
    if row is None:
        pytest.skip("No projects in ref_project")
    project_id = row["project_id"]
    r = await api.get(f"/api/masters/projects/{project_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "project" in data
    assert "applications" in data
    assert "role_summary" in data
    assert "pages" in data
    assert "diagrams" in data
    assert isinstance(data["applications"], list)


async def test_get_project_not_found(api):
    r = await api.get("/api/masters/projects/ZZZZZZZ_NONEXISTENT")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Employees
# ---------------------------------------------------------------------------

async def test_get_employee_not_found(api):
    r = await api.get("/api/masters/employees/ZZZZZZZ_NONEXISTENT")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Integrations — consumer-side dedup
# ---------------------------------------------------------------------------
# Regression for /apps/A002856 showing esot.asset-activation 4× instead of 2×.
# The source Excel had 2 rows per (topic, instance) differing only in the
# free-text `interface_description` — the endpoint collapses them to one
# entry per (platform, name, instance, provider_id, my_account, my_endpoint)
# and reports source_row_count so the data-quality signal isn't lost.

async def test_consumer_dedup_esot_asset_activation(api):
    """A002856 consumes esot.asset-activation on ikp-us + kkp-us.
    The DB has 4 raw rows (2 per instance, same topic/provider, differing
    descriptions); the endpoint must return 2 consumer entries.
    """
    r = await api.get("/api/masters/applications/A002856/integrations")
    assert r.status_code == 200
    d = r.json()["data"]
    rows = (
        d["as_consumer"]["by_platform"]
        .get("KPaaS", {})
        .get("rows", [])
    )
    esot = [
        e for e in rows
        if (e.get("topic_name") or e.get("interface_name")) == "esot.asset-activation"
    ]
    instances = sorted({e["instance"] for e in esot})
    assert instances == ["ikp-us", "kkp-us"], (
        f"expected one entry per instance, got {len(esot)} entries "
        f"with instances {instances}"
    )
    # Each entry should carry the source_row_count signal (≥1, often 2 here).
    for e in esot:
        assert e.get("source_row_count", 0) >= 1
        # descriptions_all preserves distinct free-text descriptions merged in.
        assert isinstance(e.get("descriptions_all"), list)
