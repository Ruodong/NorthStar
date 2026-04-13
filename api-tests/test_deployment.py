"""Integration tests for /api/masters/applications/{app_id}/deployment endpoint."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.deployment


# A000394 (LBP) is known to have servers, containers, and databases
TEST_APP = "A000394"
# A000005 has object storage
TEST_APP_OSS = "A000005"


@pytest.mark.asyncio
async def test_deployment_returns_summary(api):
    """Deployment endpoint returns summary counts."""
    r = await api.get(f"/api/masters/applications/{TEST_APP}/deployment")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "summary" in data
    s = data["summary"]
    assert "servers" in s
    assert "containers" in s
    assert "databases" in s
    assert "object_storage" in s
    assert "nas" in s
    assert s["servers"] + s["containers"] + s["databases"] > 0


@pytest.mark.asyncio
async def test_deployment_returns_by_city(api):
    """Deployment endpoint returns city breakdown."""
    r = await api.get(f"/api/masters/applications/{TEST_APP}/deployment")
    assert r.status_code == 200
    data = r.json()["data"]
    assert "by_city" in data
    assert "by_city_env" in data
    if data["by_city"]:
        row = data["by_city"][0]
        assert "city" in row
        assert "total" in row
    if data["by_city_env"]:
        row = data["by_city_env"][0]
        assert "city" in row
        assert "env" in row
        assert row["env"] in ("Production", "Non-Production", "Unknown")


@pytest.mark.asyncio
async def test_deployment_servers_have_env(api):
    """Each server row has an env field."""
    r = await api.get(f"/api/masters/applications/{TEST_APP}/deployment")
    data = r.json()["data"]
    servers = data["servers"]
    if servers:
        s = servers[0]
        assert "env" in s
        assert s["env"] in ("Production", "Non-Production", "Unknown")
        assert "city" in s
        assert "name" in s


@pytest.mark.asyncio
async def test_deployment_production_first(api):
    """Production entries should come before Non-Production."""
    r = await api.get(f"/api/masters/applications/{TEST_APP}/deployment")
    data = r.json()["data"]
    envs = [s["env"] for s in data["servers"] if s.get("env")]
    if len(envs) >= 2:
        # Find first Non-Production — everything before it should be Production
        for i, e in enumerate(envs):
            if e == "Non-Production":
                before = envs[:i]
                assert all(x in ("Production", "Unknown") for x in before), (
                    f"Non-Production appeared at index {i} but earlier entries "
                    f"contain non-Production: {before}"
                )
                break


@pytest.mark.asyncio
async def test_deployment_empty_app(api):
    """Non-existent app returns empty deployment data."""
    r = await api.get("/api/masters/applications/A999999/deployment")
    assert r.status_code == 200
    data = r.json()["data"]
    s = data["summary"]
    assert s["servers"] == 0
    assert s["containers"] == 0
    assert s["databases"] == 0


@pytest.mark.asyncio
async def test_deployment_object_storage(api):
    """App with OSS shows object_storage rows."""
    r = await api.get(f"/api/masters/applications/{TEST_APP_OSS}/deployment")
    data = r.json()["data"]
    oss = data.get("object_storage", [])
    # A000005 has OSS in our sync data
    if data["summary"].get("object_storage", 0) > 0:
        assert len(oss) > 0
        o = oss[0]
        assert "name" in o
        assert "env" in o
        assert "city" in o


@pytest.mark.asyncio
async def test_deployment_databases_have_db_type(api):
    """Database rows include db_type field."""
    r = await api.get(f"/api/masters/applications/{TEST_APP}/deployment")
    data = r.json()["data"]
    dbs = data["databases"]
    if dbs:
        d = dbs[0]
        assert "db_type" in d
        assert "env" in d
