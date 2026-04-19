"""Integration tests for PUT /api/design/{id}/selections.

Covers FR-11..15 and AC-2, AC-3, AC-5 in
.specify/features/design-edit-wizard/spec.md: bulk-replacing apps +
interfaces + template_attachment_id on an existing design without
disturbing drawio_xml.

Designs are created via direct DB INSERT (not POST /api/design) so these
tests don't depend on having a registered Confluence template — the
generator/storage pipeline is out of scope for this spec.
"""
from __future__ import annotations

import pytest


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────

def _insert_design(pg, name: str = "test-selections-put") -> int:
    """Create a bare design_session row and return its design_id."""
    with pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO northstar.design_session (
                name, fiscal_year, status, drawio_xml, as_is_snapshot_xml
            )
            VALUES (%s, 'FY2627', 'draft', '<sentinel-drawio/>', '<sentinel-snap/>')
            RETURNING design_id
            """,
            (name,),
        )
        design_id = cur.fetchone()["design_id"]
    pg.commit()
    return design_id


def _seed_apps_and_ifaces(pg, design_id: int) -> None:
    """Seed the design with 2 apps and 2 interfaces to give us a baseline
    for replace-assertions."""
    with pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO northstar.design_app (
                design_id, app_id, role, planned_status
            ) VALUES
                (%s, 'TEST-APP-SEED-A', 'primary', 'keep'),
                (%s, 'TEST-APP-SEED-B', 'related', 'keep')
            """,
            (design_id, design_id),
        )
        cur.execute(
            """
            INSERT INTO northstar.design_interface (
                design_id, interface_id, from_app, to_app, platform,
                interface_name, planned_status
            ) VALUES
                (%s, NULL, 'TEST-APP-SEED-A', 'TEST-APP-SEED-B',
                 'APIH', 'seed-iface-1', 'keep'),
                (%s, NULL, 'TEST-APP-SEED-B', 'TEST-APP-SEED-A',
                 'WSO2', 'seed-iface-2', 'keep')
            """,
            (design_id, design_id),
        )
    pg.commit()


def _cleanup_design(pg, design_id: int) -> None:
    with pg.cursor() as cur:
        # ON DELETE CASCADE wipes design_app + design_interface
        cur.execute(
            "DELETE FROM northstar.design_session WHERE design_id = %s",
            (design_id,),
        )
    pg.commit()


# ──────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_put_selections_replaces_apps(api, pg):
    """FR-12: DELETE + INSERT replace of design_app rows."""
    design_id = _insert_design(pg, "sel-put-replace-apps")
    _seed_apps_and_ifaces(pg, design_id)
    try:
        payload = {
            "template_attachment_id": None,
            "apps": [
                {"app_id": "TEST-APP-NEW-1", "role": "primary", "planned_status": "keep"},
                {"app_id": "TEST-APP-NEW-2", "role": "related", "planned_status": "change"},
                {"app_id": "TEST-APP-NEW-3", "role": "related", "planned_status": "new"},
            ],
            "interfaces": [],
        }
        r = await api.put(f"/api/design/{design_id}/selections", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["data"]["saved"] is True
        assert r.json()["data"]["apps_count"] == 3

        with pg.cursor() as cur:
            cur.execute(
                "SELECT app_id, role, planned_status FROM northstar.design_app "
                "WHERE design_id = %s ORDER BY app_id",
                (design_id,),
            )
            rows = cur.fetchall()
        assert len(rows) == 3
        assert {r["app_id"] for r in rows} == {
            "TEST-APP-NEW-1", "TEST-APP-NEW-2", "TEST-APP-NEW-3",
        }
        # Seed apps gone
        assert "TEST-APP-SEED-A" not in {r["app_id"] for r in rows}
    finally:
        _cleanup_design(pg, design_id)


@pytest.mark.asyncio
async def test_put_selections_replaces_interfaces(api, pg):
    """FR-12: DELETE + INSERT replace of design_interface rows."""
    design_id = _insert_design(pg, "sel-put-replace-ifaces")
    _seed_apps_and_ifaces(pg, design_id)
    try:
        payload = {
            "template_attachment_id": None,
            "apps": [
                {"app_id": "TEST-APP-KEEP", "role": "primary", "planned_status": "keep"},
            ],
            "interfaces": [
                {
                    "interface_id": 99901,
                    "from_app": "TEST-APP-KEEP",
                    "to_app": "TEST-APP-OTHER",
                    "platform": "KPaaS",
                    "interface_name": "new-iface-1",
                    "planned_status": "new",
                },
            ],
        }
        r = await api.put(f"/api/design/{design_id}/selections", json=payload)
        assert r.status_code == 200

        with pg.cursor() as cur:
            cur.execute(
                "SELECT interface_id, platform, interface_name "
                "FROM northstar.design_interface WHERE design_id = %s",
                (design_id,),
            )
            rows = cur.fetchall()
        assert len(rows) == 1
        assert rows[0]["interface_id"] == 99901
        assert rows[0]["platform"] == "KPaaS"
    finally:
        _cleanup_design(pg, design_id)


@pytest.mark.asyncio
async def test_put_selections_updates_template(api, pg):
    """FR-11: template_attachment_id on design_session is updated."""
    design_id = _insert_design(pg, "sel-put-updates-template")
    try:
        payload = {
            "template_attachment_id": 42,
            "apps": [{"app_id": "TEST-APP", "role": "primary", "planned_status": "keep"}],
            "interfaces": [],
        }
        r = await api.put(f"/api/design/{design_id}/selections", json=payload)
        assert r.status_code == 200

        with pg.cursor() as cur:
            cur.execute(
                "SELECT template_attachment_id FROM northstar.design_session "
                "WHERE design_id = %s",
                (design_id,),
            )
            assert cur.fetchone()["template_attachment_id"] == 42
    finally:
        _cleanup_design(pg, design_id)


@pytest.mark.asyncio
async def test_put_selections_does_not_modify_drawio(api, pg):
    """FR-13 / AC-3: drawio_xml and as_is_snapshot_xml are untouched."""
    design_id = _insert_design(pg, "sel-put-preserves-drawio")
    try:
        payload = {
            "template_attachment_id": None,
            "apps": [{"app_id": "TEST-APP", "role": "primary", "planned_status": "keep"}],
            "interfaces": [],
        }
        r = await api.put(f"/api/design/{design_id}/selections", json=payload)
        assert r.status_code == 200

        with pg.cursor() as cur:
            cur.execute(
                "SELECT drawio_xml, as_is_snapshot_xml FROM northstar.design_session "
                "WHERE design_id = %s",
                (design_id,),
            )
            row = cur.fetchone()
        assert row["drawio_xml"] == "<sentinel-drawio/>"
        assert row["as_is_snapshot_xml"] == "<sentinel-snap/>"
    finally:
        _cleanup_design(pg, design_id)


@pytest.mark.asyncio
async def test_put_selections_404_for_missing_design(api):
    """FR-14: non-existent design_id returns 404."""
    r = await api.put(
        "/api/design/999999999/selections",
        json={"template_attachment_id": None, "apps": [], "interfaces": []},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_put_selections_400_on_duplicate_app_ids(api, pg):
    """FR-15 / AC-5: duplicate app_id in payload → 400, no writes."""
    design_id = _insert_design(pg, "sel-put-dup-apps")
    _seed_apps_and_ifaces(pg, design_id)
    try:
        payload = {
            "template_attachment_id": None,
            "apps": [
                {"app_id": "DUP", "role": "primary", "planned_status": "keep"},
                {"app_id": "DUP", "role": "related", "planned_status": "change"},
            ],
            "interfaces": [],
        }
        r = await api.put(f"/api/design/{design_id}/selections", json=payload)
        assert r.status_code == 400

        # Seed apps still in place — the transaction never started
        with pg.cursor() as cur:
            cur.execute(
                "SELECT count(*) AS n FROM northstar.design_app WHERE design_id = %s",
                (design_id,),
            )
            assert cur.fetchone()["n"] == 2
    finally:
        _cleanup_design(pg, design_id)


@pytest.mark.asyncio
async def test_put_selections_empty_payload_clears_rows(api, pg):
    """EC-1 adjacent: sending empty apps[] + interfaces[] wipes the
    design to an empty scope. (Frontend disables Save when scopeApps is
    empty per EC-1, but the backend itself accepts it — validation is a
    UI concern.)"""
    design_id = _insert_design(pg, "sel-put-empty-clears")
    _seed_apps_and_ifaces(pg, design_id)
    try:
        payload = {
            "template_attachment_id": None,
            "apps": [],
            "interfaces": [],
        }
        r = await api.put(f"/api/design/{design_id}/selections", json=payload)
        assert r.status_code == 200

        with pg.cursor() as cur:
            cur.execute(
                "SELECT count(*) AS n FROM northstar.design_app WHERE design_id = %s",
                (design_id,),
            )
            assert cur.fetchone()["n"] == 0
            cur.execute(
                "SELECT count(*) AS n FROM northstar.design_interface WHERE design_id = %s",
                (design_id,),
            )
            assert cur.fetchone()["n"] == 0
    finally:
        _cleanup_design(pg, design_id)
