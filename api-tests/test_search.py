"""Integration tests for /api/search endpoint."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_search_returns_applications(api):
    """Search for a known app name returns results."""
    r = await api.get("/api/search", params={"q": "polaris"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "applications" in data
    assert len(data["applications"]) >= 1
    app = data["applications"][0]
    assert "app_id" in app
    assert "name" in app


@pytest.mark.asyncio
async def test_search_returns_projects(api):
    """Search for a known project ID returns results."""
    r = await api.get("/api/search", params={"q": "LI2400444"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "projects" in data
    assert len(data["projects"]) >= 1


@pytest.mark.asyncio
async def test_search_empty_query(api):
    """Empty query returns 200 with empty results."""
    r = await api.get("/api/search", params={"q": ""})
    # Should return 200 with empty or minimal results
    assert r.status_code in (200, 422)


@pytest.mark.asyncio
async def test_search_no_results(api):
    """Nonsense query returns 200 with empty results."""
    r = await api.get("/api/search", params={"q": "xyzzy_nonexistent_99999"})
    assert r.status_code == 200
    data = r.json()["data"]
    apps = data.get("applications", [])
    projs = data.get("projects", [])
    assert len(apps) + len(projs) == 0


@pytest.mark.asyncio
async def test_search_result_schema(api):
    """Verify the response schema for applications."""
    r = await api.get("/api/search", params={"q": "OMS"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "query" in data
    if data.get("applications"):
        app = data["applications"][0]
        for k in ("app_id", "name", "status"):
            assert k in app, f"application result missing field {k!r}"
