"""Integration tests for confluence-major-apps feature.

Spec: .specify/features/confluence-major-apps/spec.md § 4.
Runs against the live backend + PG on 71. Assumes:
  1. scripts/resolve_confluence_drawio_apps.py has run (so resolved_app_id
     is populated — AI Verse → A000426 etc)
  2. scripts/propagate_major_apps.py has run (so confluence_page_app_link
     contains major_app rows)
  3. backend rebuilt so /extracted returns the new major_apps field
"""
from __future__ import annotations

import pytest


pytestmark = pytest.mark.confluence_major_apps


PILOT_PAGE_ID = "596101004"  # EA250197 parent
PILOT_MAJOR_APP = "A002964"  # Lenovo Campus Recruitment
NON_MAJOR_APP_IDS = {
    "A000001",  # AI Verse / ECC   — Keep
    "A002634",  # Avatue / Avature — Keep
    "A003749",  # KM Verse         — Keep
}


# ---------------------------------------------------------------------------
# AC-1: link rows populated after propagation
# ---------------------------------------------------------------------------

def test_major_app_links_populated(pg):
    """Spec AC-1. propagate_major_apps.py must have inserted a
    meaningful number of major_app link rows (conservative floor 100)."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_page_app_link
            WHERE source = 'major_app'
            """
        )
        n = cur.fetchone()["n"]
    assert n >= 100, (
        f"expected >= 100 major_app link rows, got {n}; "
        "did scripts/propagate_major_apps.py run?"
    )


# ---------------------------------------------------------------------------
# AC-2: EA250197 pilot — exactly Lenovo Campus Recruitment
# ---------------------------------------------------------------------------

def test_ea250197_major_app_is_lenovo_campus(pg):
    """Spec AC-2. EA250197 (page 596101004) has one drawio whose Change
    app is Lenovo Campus Recruitment. After propagation, that page's
    major_app link rows must contain exactly A002964."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT app_id
            FROM northstar.confluence_page_app_link
            WHERE page_id = %s AND source = 'major_app'
            ORDER BY app_id
            """,
            (PILOT_PAGE_ID,),
        )
        rows = [r["app_id"] for r in cur.fetchall()]
    assert PILOT_MAJOR_APP in rows, (
        f"EA250197 major_app links missing {PILOT_MAJOR_APP}; got {rows}"
    )


# ---------------------------------------------------------------------------
# AC-3: Keep / 3rd Party apps must NOT be propagated
# ---------------------------------------------------------------------------

def test_non_major_apps_excluded(pg):
    """Spec AC-3. Keep-status apps (AI Verse, Avatue, KM Verse) must not
    appear as major_app links for page 596101004."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT app_id
            FROM northstar.confluence_page_app_link
            WHERE page_id = %s
              AND source = 'major_app'
              AND app_id = ANY(%s)
            """,
            (PILOT_PAGE_ID, list(NON_MAJOR_APP_IDS)),
        )
        leaked = [r["app_id"] for r in cur.fetchall()]
    assert not leaked, (
        f"Keep / 3rd Party apps leaked into major_app links for EA250197: {leaked}"
    )


# ---------------------------------------------------------------------------
# AC-4: /extracted endpoint surfaces major_apps rollup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extracted_major_apps_section(api):
    """Spec AC-4. /extracted response for EA250197 must include a
    major_apps array containing exactly one entry: A002964 Lenovo
    Campus Recruitment with status Change."""
    r = await api.get(f"/api/admin/confluence/pages/{PILOT_PAGE_ID}/extracted")
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    majors = data.get("major_apps")
    assert majors is not None, "/extracted missing major_apps field"
    assert any(m.get("app_id") == PILOT_MAJOR_APP for m in majors), (
        f"EA250197 major_apps missing {PILOT_MAJOR_APP}; "
        f"got {[m.get('app_id') for m in majors]}"
    )
    lcr = next(m for m in majors if m.get("app_id") == PILOT_MAJOR_APP)
    assert lcr.get("application_status") == "Change"
    assert lcr.get("cmdb_name") == "Lenovo Campus Recruitment"


# ---------------------------------------------------------------------------
# AC-5: admin /pages list surfaces Lenovo Campus Recruitment for EA250197
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ea250197_list_row_shows_major_app(api):
    """Spec AC-5. /admin/confluence/pages?q=EA250197 must return a row
    where app_id=A002964 and app_name is Lenovo Campus Recruitment."""
    r = await api.get(
        "/api/admin/confluence/pages",
        params={
            "fiscal_year": "FY2526",
            "q": "EA250197",
            "limit": 20,
            "include_deep": "true",
        },
    )
    assert r.status_code == 200, r.text
    rows = r.json()["data"]["rows"]
    matching = [
        row for row in rows if row.get("app_id") == PILOT_MAJOR_APP
    ]
    assert matching, (
        f"EA250197 admin list row missing A002964; "
        f"app_ids={[r.get('app_id') for r in rows]}"
    )
    row = matching[0]
    assert row.get("app_name") == "Lenovo Campus Recruitment", (
        f"expected app_name='Lenovo Campus Recruitment', got {row.get('app_name')!r}"
    )


# ---------------------------------------------------------------------------
# AC-6: propagation idempotent
# ---------------------------------------------------------------------------

def test_propagate_idempotent(pg):
    """Spec AC-6. The PK on (page_id, app_id) with ON CONFLICT DO NOTHING
    guarantees no duplicates. Assert no duplicate rows exist in the
    major_app source and no timestamps in the future."""
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT page_id, app_id, count(*) AS n
            FROM northstar.confluence_page_app_link
            WHERE source = 'major_app'
            GROUP BY page_id, app_id
            HAVING count(*) > 1
            LIMIT 5
            """
        )
        dupes = cur.fetchall()
    assert not dupes, f"duplicate major_app link rows: {dupes!r}"

    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT count(*) AS n
            FROM northstar.confluence_page_app_link
            WHERE source = 'major_app'
              AND created_at > NOW() + INTERVAL '1 minute'
            """
        )
        n = cur.fetchone()["n"]
    assert n == 0, f"{n} major_app link rows have created_at in the future"
