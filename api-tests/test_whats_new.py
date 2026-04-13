"""Integration tests for /api/whats-new endpoints."""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_whats_new_summary(api):
    """Summary endpoint returns totals and breakdown."""
    r = await api.get("/api/whats-new/summary")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "total" in data
    assert "by_type" in data
    assert isinstance(data["by_type"], dict)
    assert data["total"] >= 0


@pytest.mark.asyncio
async def test_whats_new_feed(api):
    """Feed endpoint returns paginated change items."""
    r = await api.get("/api/whats-new/feed", params={"limit": 5})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "total" in data
    assert "rows" in data
    assert isinstance(data["rows"], list)
    if data["rows"]:
        item = data["rows"][0]
        assert "diff_type" in item


@pytest.mark.asyncio
async def test_whats_new_runs(api):
    """Runs endpoint lists ingestion run history."""
    r = await api.get("/api/whats-new/runs")
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data, list)
