# Business Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Capabilities tab on `/apps/[app_id]` backed by EAM's Business Capability taxonomy + app-BC mapping, synced daily into NorthStar Postgres.

**Architecture:** Two new `ref_*` tables via Alembic migration `002_*` (first forward migration on top of the flat-SQL baseline). `sync_from_egm.py` populates them from `eam.bcpf_master_data` and `eam.biz_cap_map`. A new FastAPI router exposes `GET /api/apps/{app_id}/business-capabilities` returning an L1→L2→L3 grouped structure. Frontend adds one inline-fetch tab component imported into `/apps/[app_id]/page.tsx`.

**Tech Stack:** Alembic + SQLAlchemy 2.x (migration layer), FastAPI + asyncpg (backend), psycopg 3 + psycopg.sql composition (sync), Next.js 15 + React 19 + inline styles (frontend), pytest + httpx.AsyncClient (api-tests).

**Reference:** `.specify/features/business-capabilities/spec.md` + `api.md` — re-read before starting each task if anything is unclear.

---

## File Structure Map

### Create
| Path | Responsibility |
|------|----------------|
| `backend/alembic/versions/002_business_capabilities.py` | DDL for `ref_business_capability` + `ref_app_business_capability` + 4 indexes. |
| `backend/app/routers/business_capabilities.py` | One endpoint: `GET /api/apps/{app_id}/business-capabilities`. |
| `backend/app/services/business_capabilities.py` | Pure SQL data access + L1/L2 grouping aggregation. |
| `frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx` | Tab content component (fetch, grouping render, empty state, footer meta). |
| `api-tests/test_business_capabilities.py` | API integration tests covering AC-1 through AC-7. |

### Modify
| Path | What changes |
|------|--------------|
| `backend/app/models/schemas.py` | Append Pydantic models: `BusinessCapabilityLeaf`, `CapabilityL2Group`, `CapabilityL1Group`, `AppBusinessCapabilitiesResponse`. |
| `backend/app/main.py` | Register the new router. |
| `scripts/sync_from_egm.py` | Update existing `ref_business_capability` entry (PK `id`, widen column list to include hierarchy path + source_created_at); ADD new `ref_app_business_capability` entry. |
| `scripts/test-map.json` | Add mapping from the new router + service + sync script → new test file. |
| `frontend/src/app/apps/[app_id]/page.tsx` | Extend `Tab` type; add TabButton; add render line; import CapabilitiesTab. |

### No changes
- `backend/sql/*.sql` — the flat-SQL baseline is frozen (CLAUDE.md §Schema Evolution).
- AGE graph / `load_age_from_pg.py` — BC nodes are out-of-scope (spec §12).

---

## Task 1: Alembic migration — create both tables

**Files:**
- Create: `backend/alembic/versions/002_business_capabilities.py`

Creates `ref_business_capability` + `ref_app_business_capability` + 4 indexes. Additive only. Both `upgrade()` and `downgrade()` implemented (downgrade drops both tables).

- [ ] **Step 1.1: Write the migration**

Create `backend/alembic/versions/002_business_capabilities.py`:

```python
"""business capabilities tables

Revision ID: 002_business_capabilities
Revises: 001_baseline
Create Date: 2026-04-18
"""
from alembic import op

revision = "002_business_capabilities"
down_revision = "001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("""
        CREATE TABLE IF NOT EXISTS northstar.ref_business_capability (
            id                    BIGINT      PRIMARY KEY,
            data_version          VARCHAR(32) NOT NULL DEFAULT '',
            bc_id                 VARCHAR(64) NOT NULL,
            parent_bc_id          VARCHAR(64) NOT NULL DEFAULT 'root',
            bc_name               TEXT        NOT NULL,
            bc_name_cn            TEXT,
            level                 SMALLINT    NOT NULL,
            alias                 TEXT,
            bc_description        TEXT,
            biz_group             TEXT,
            geo                   TEXT,
            biz_owner             TEXT,
            biz_team              TEXT,
            dt_owner              TEXT,
            dt_team               TEXT,
            lv1_domain            TEXT        NOT NULL DEFAULT '',
            lv2_sub_domain        TEXT,
            lv3_capability_group  TEXT,
            remark                TEXT,
            source_created_at     TIMESTAMPTZ,
            synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS northstar.ref_app_business_capability (
            id                 UUID        PRIMARY KEY,
            app_id             VARCHAR(64) NOT NULL,
            bcpf_master_id     BIGINT      NOT NULL,
            bc_id              VARCHAR(64),
            data_version       VARCHAR(32),
            source_create_by   TEXT,
            source_update_by   TEXT,
            source_created_at  TIMESTAMPTZ,
            source_updated_at  TIMESTAMPTZ,
            synced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_bc_bc_id
            ON northstar.ref_business_capability (bc_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_bc_level_domain
            ON northstar.ref_business_capability (level, lv1_domain);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_app_bc_app_id
            ON northstar.ref_app_business_capability (app_id);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_app_bc_bcpf_id
            ON northstar.ref_app_business_capability (bcpf_master_id);
    """)


def downgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("DROP TABLE IF EXISTS northstar.ref_app_business_capability;")
    op.execute("DROP TABLE IF EXISTS northstar.ref_business_capability;")
```

- [ ] **Step 1.2: Syntax-check the migration file**

Run: `cd /Users/ruodongyang/Workplace/NorthStar/backend && python -c "import importlib.util, sys; spec=importlib.util.spec_from_file_location('m','alembic/versions/002_business_capabilities.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print('OK revision=', m.revision)"`
Expected: `OK revision= 002_business_capabilities`

- [ ] **Step 1.3: Commit**

```bash
cd /Users/ruodongyang/Workplace/NorthStar
git add backend/alembic/versions/002_business_capabilities.py
git commit -m "$(cat <<'EOF'
feat(bc): alembic 002 - ref_business_capability + ref_app_business_capability

First real forward migration on top of the 001_baseline bridge. Creates
the two tables that back the new App Detail → Capabilities tab. Additive
only, downgrade drops both.

Ref: .specify/features/business-capabilities/spec.md §7
EOF
)"
```

---

## Task 2: Pydantic schemas

**Files:**
- Modify: `backend/app/models/schemas.py` (append at end)

- [ ] **Step 2.1: Append schemas**

Append to `backend/app/models/schemas.py`:

```python
# ── Business Capabilities (App Detail → Capabilities tab) ──────────
# See .specify/features/business-capabilities/spec.md + api.md.

class BusinessCapabilityLeaf(BaseModel):
    """One L3 Business Capability mapped to the application."""
    bc_id: str
    bc_name: str
    bc_name_cn: Optional[str] = None
    bc_description: Optional[str] = None
    level: int = 3
    lv3_capability_group: str = ""
    biz_owner: Optional[str] = None
    biz_team: Optional[str] = None
    dt_owner: Optional[str] = None
    dt_team: Optional[str] = None
    data_version: Optional[str] = None
    source_updated_at: Optional[datetime] = None


class CapabilityL2Group(BaseModel):
    l2_subdomain: str
    leaves: list[BusinessCapabilityLeaf] = Field(default_factory=list)


class CapabilityL1Group(BaseModel):
    l1_domain: str
    count: int
    l2_groups: list[CapabilityL2Group] = Field(default_factory=list)


class AppBusinessCapabilitiesResponse(BaseModel):
    app_id: str
    total_count: int = 0
    l1_groups: list[CapabilityL1Group] = Field(default_factory=list)
    taxonomy_versions: list[str] = Field(default_factory=list)
    last_synced_at: Optional[datetime] = None
    orphan_mappings: int = 0
```

- [ ] **Step 2.2: Commit**

```bash
git add backend/app/models/schemas.py
git commit -m "feat(bc): pydantic schemas for app business capabilities response"
```

---

## Task 3: Service layer — SQL + aggregation

**Files:**
- Create: `backend/app/services/business_capabilities.py`

Pure data access. No HTTP, no pydantic. Returns dicts. One public function: `async def get_app_business_capabilities(app_id: str) -> dict`.

- [ ] **Step 3.1: Write the service**

Create `backend/app/services/business_capabilities.py`:

```python
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
```

- [ ] **Step 3.2: Syntax-check the service**

Run: `cd /Users/ruodongyang/Workplace/NorthStar/backend && python -c "from app.services import business_capabilities; print('imports ok')"`
Expected: `imports ok`

(If the import fails because `pg_client` is not yet importable in the host Python env — that's fine, the container will import it. Skip this step and move on.)

- [ ] **Step 3.3: Commit**

```bash
git add backend/app/services/business_capabilities.py
git commit -m "feat(bc): service layer - SQL + L1/L2 grouping"
```

---

## Task 4: Router + main.py registration

**Files:**
- Create: `backend/app/routers/business_capabilities.py`
- Modify: `backend/app/main.py`

- [ ] **Step 4.1: Write the router**

Create `backend/app/routers/business_capabilities.py`:

```python
"""Business Capability mappings API — /api/apps/{app_id}/business-capabilities

Reads NorthStar PG (ref_business_capability + ref_app_business_capability),
both synced from EAM via scripts/sync_from_egm.py. No graph access, no
mutations — EAM is the source of truth for mappings.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import ApiResponse, AppBusinessCapabilitiesResponse
from app.services import business_capabilities as bc_service

router = APIRouter(prefix="/api/apps", tags=["business-capabilities"])


@router.get(
    "/{app_id}/business-capabilities",
    response_model=ApiResponse[AppBusinessCapabilitiesResponse],
)
async def get_app_business_capabilities(app_id: str) -> ApiResponse:
    data = await bc_service.get_app_business_capabilities(app_id)
    return ApiResponse(data=data)
```

- [ ] **Step 4.2: Register the router in main.py**

In `backend/app/main.py`, add `business_capabilities` to the import block and `app.include_router(...)` section.

Edit the import block (around line 13):

```python
from app.routers import (
    admin,
    aliases,
    analytics,
    business_capabilities,
    ea_documents,
    graph,
    ingestion,
    masters,
    search,
    whats_new,
)
```

And add one line after `app.include_router(ea_documents.router)` (around line 140):

```python
app.include_router(business_capabilities.router)
```

- [ ] **Step 4.3: Commit**

```bash
git add backend/app/routers/business_capabilities.py backend/app/main.py
git commit -m "feat(bc): router + register - GET /api/apps/{id}/business-capabilities"
```

---

## Task 5: API tests — covers AC-1 through AC-7

**Files:**
- Create: `api-tests/test_business_capabilities.py`
- Modify: `scripts/test-map.json`

**Test strategy:** Tests run AFTER the first sync has populated real EAM data on 71. We don't seed fixtures — we assert against known EAM rows (see spec.md §5 and api.md §5). Tests are skipped gracefully if the sync hasn't run yet (the table exists but is empty).

- [ ] **Step 5.1: Write the test file**

Create `api-tests/test_business_capabilities.py`:

```python
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
```

- [ ] **Step 5.2: Register in test-map.json**

Add these entries inside the `"backend"` object of `scripts/test-map.json`. Insert after the existing `"backend/app/routers/settings.py"` entry:

```json
    "backend/app/routers/business_capabilities.py": {
      "api": ["api-tests/test_business_capabilities.py"]
    },
    "backend/app/services/business_capabilities.py": {
      "api": ["api-tests/test_business_capabilities.py"]
    },
    "scripts/sync_from_egm.py": {
      "api": ["api-tests/test_business_capabilities.py", "api-tests/test_masters.py"]
    },
```

(If `scripts/sync_from_egm.py` already has an entry, merge the test list instead of duplicating.)

- [ ] **Step 5.3: Commit**

```bash
git add api-tests/test_business_capabilities.py scripts/test-map.json
git commit -m "test(bc): api tests - AC-1 through AC-7 coverage"
```

---

## Task 6: Sync script — update master, add mapping

**Files:**
- Modify: `scripts/sync_from_egm.py`

Two changes in the `SYNCS` array (around lines 139–154):
1. **Widen the existing `ref_business_capability` entry**: switch PK from `bc_id` to `id`, add `id` + `lv1_domain` / `lv2_sub_domain` / `lv3_capability_group` / `remark` / `create_time` to the SELECT and destination columns. This preserves multi-version rows (bc_id isn't unique across data_versions).
2. **Add a new `ref_app_business_capability` entry** for the mapping table.

- [ ] **Step 6.1: Replace the existing `ref_business_capability` entry**

Find this block in `scripts/sync_from_egm.py` (around lines 139–154):

```python
    # Business Capability master
    (
        "ref_business_capability",
        ["bc_id"],
        "eam",
        (
            """SELECT bc_id, parent_bc_id, bc_name, bc_name_cn, level, alias,
                      bc_description, biz_group, geo, biz_owner, biz_team,
                      dt_owner, dt_team, data_version
               FROM eam.bcpf_master_data""",
            [
                "bc_id", "parent_bc_id", "bc_name", "bc_name_cn", "level", "alias",
                "bc_description", "biz_group", "geo", "biz_owner", "biz_team",
                "dt_owner", "dt_team", "data_version",
            ],
        ),
    ),
```

Replace with:

```python
    # Business Capability master — PK=id (bigint) preserves multi-version
    # rows; bc_id is NOT unique across data_versions in bcpf_master_data.
    (
        "ref_business_capability",
        ["id"],
        "eam",
        (
            """SELECT id, bc_id, parent_bc_id, bc_name, bc_name_cn, level, alias,
                      bc_description, biz_group, geo, biz_owner, biz_team,
                      dt_owner, dt_team, data_version,
                      lv1_domain, lv2_sub_domain, lv3_capability_group, remark,
                      create_time AS source_created_at
               FROM eam.bcpf_master_data""",
            [
                "id", "bc_id", "parent_bc_id", "bc_name", "bc_name_cn", "level", "alias",
                "bc_description", "biz_group", "geo", "biz_owner", "biz_team",
                "dt_owner", "dt_team", "data_version",
                "lv1_domain", "lv2_sub_domain", "lv3_capability_group", "remark",
                "source_created_at",
            ],
        ),
    ),
```

- [ ] **Step 6.2: Add the mapping sync entry**

Insert the following block immediately AFTER the `ref_business_capability` entry (the one you just edited) in `SYNCS`:

```python
    # Business Capability → Application mapping (many-to-many, L3 leaves only)
    (
        "ref_app_business_capability",
        ["id"],
        "eam",
        (
            """SELECT id, app_id, bcpf_master_id, bc_id, data_version,
                      create_by  AS source_create_by,
                      update_by  AS source_update_by,
                      create_at  AS source_created_at,
                      update_at  AS source_updated_at
               FROM eam.biz_cap_map""",
            [
                "id", "app_id", "bcpf_master_id", "bc_id", "data_version",
                "source_create_by", "source_update_by",
                "source_created_at", "source_updated_at",
            ],
        ),
    ),
```

- [ ] **Step 6.3: Syntax-check the script**

Run: `cd /Users/ruodongyang/Workplace/NorthStar && python3 -c "import ast; ast.parse(open('scripts/sync_from_egm.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 6.4: Commit**

```bash
git add scripts/sync_from_egm.py
git commit -m "feat(bc): sync - widen ref_business_capability (PK id), add ref_app_business_capability"
```

---

## Task 7: Frontend — CapabilitiesTab component

**Files:**
- Create: `frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx`

Self-contained fetch + render. Inline styles, DESIGN.md tokens.

- [ ] **Step 7.1: Write the component**

Create `frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

// -----------------------------------------------------------------------------
// Types — mirror backend AppBusinessCapabilitiesResponse (api.md §6)
// -----------------------------------------------------------------------------
interface BusinessCapabilityLeaf {
  bc_id: string;
  bc_name: string;
  bc_name_cn: string | null;
  bc_description: string | null;
  level: number;
  lv3_capability_group: string;
  biz_owner: string | null;
  biz_team: string | null;
  dt_owner: string | null;
  dt_team: string | null;
  data_version: string | null;
  source_updated_at: string | null;
}

interface CapabilityL2Group {
  l2_subdomain: string;
  leaves: BusinessCapabilityLeaf[];
}

interface CapabilityL1Group {
  l1_domain: string;
  count: number;
  l2_groups: CapabilityL2Group[];
}

interface AppBusinessCapabilitiesResponse {
  app_id: string;
  total_count: number;
  l1_groups: CapabilityL1Group[];
  taxonomy_versions: string[];
  last_synced_at: string | null;
  orphan_mappings: number;
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function ownerLine(leaf: BusinessCapabilityLeaf): string | null {
  const hasAny =
    leaf.biz_owner || leaf.biz_team || leaf.dt_owner || leaf.dt_team;
  if (!hasAny) return null;
  const biz = leaf.biz_owner
    ? `${leaf.biz_owner}${leaf.biz_team ? ` (${leaf.biz_team})` : ""}`
    : "—";
  const dt = leaf.dt_owner
    ? `${leaf.dt_owner}${leaf.dt_team ? ` (${leaf.dt_team})` : ""}`
    : "—";
  return `Biz: ${biz} · DT: ${dt}`;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------
export function CapabilitiesTab({ appId }: { appId: string }) {
  const [data, setData] = useState<AppBusinessCapabilitiesResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/apps/${encodeURIComponent(appId)}/business-capabilities`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        if (!j.success) {
          setErr(j.error || "Failed to load capabilities");
          return;
        }
        setData(j.data as AppBusinessCapabilitiesResponse);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (loading) {
    return (
      <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 12 }}>
        Loading capabilities…
      </div>
    );
  }

  if (err) {
    return (
      <div
        style={{
          color: "#ff6b6b",
          fontSize: 13,
          padding: 12,
          border: "1px solid rgba(255,107,107,0.3)",
          borderRadius: 4,
        }}
      >
        Failed to load capabilities: {err}
      </div>
    );
  }

  if (!data) return null;

  const isEmpty = data.total_count === 0;
  const mixedVersions = data.taxonomy_versions.length > 1;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {isEmpty ? (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "var(--text-muted)",
            fontSize: 13,
            lineHeight: 1.6,
            border: "1px dashed var(--border-strong)",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 15, color: "var(--text)", marginBottom: 8 }}>
            No business capabilities mapped
          </div>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            This application hasn&apos;t been mapped to any business
            capability in EAM yet. Mapping is maintained in EAM by the
            Enterprise Architecture team.
          </div>
        </div>
      ) : (
        data.l1_groups.map((l1) => {
          const isCollapsed = collapsed.has(l1.l1_domain);
          return (
            <div
              key={l1.l1_domain}
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(l1.l1_domain);
                  else next.add(l1.l1_domain);
                  setCollapsed(next);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "var(--panel-raised, rgba(255,255,255,0.02))",
                  border: "none",
                  borderBottom: isCollapsed
                    ? "none"
                    : "1px solid var(--border-strong)",
                  color: "var(--text)",
                  padding: "10px 14px",
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                }}
              >
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      color: "var(--text-dim)",
                      marginRight: 6,
                    }}
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  {l1.l1_domain || "(no domain)"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {l1.count}
                </span>
              </button>
              {!isCollapsed &&
                l1.l2_groups.map((l2) => (
                  <div key={l2.l2_subdomain}>
                    <div
                      style={{
                        padding: "8px 14px 4px 14px",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        color: "var(--text-dim)",
                      }}
                    >
                      {l2.l2_subdomain || "(no subdomain)"}
                    </div>
                    {l2.leaves.map((leaf, idx) => {
                      const oline = ownerLine(leaf);
                      return (
                        <div
                          key={leaf.bc_id + idx}
                          title={leaf.bc_description || undefined}
                          style={{
                            padding: "8px 14px 10px 14px",
                            borderTop:
                              idx === 0
                                ? "none"
                                : "1px solid rgba(255,255,255,0.04)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "baseline",
                            }}
                          >
                            <code
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 11,
                                color: "var(--text-dim)",
                                minWidth: 68,
                              }}
                            >
                              {leaf.bc_id}
                            </code>
                            <span
                              style={{
                                fontFamily: "var(--font-display)",
                                fontSize: 13,
                                color: "var(--text)",
                              }}
                            >
                              {leaf.bc_name}
                            </span>
                          </div>
                          {leaf.bc_name_cn && (
                            <div
                              style={{
                                marginLeft: 78,
                                fontStyle: "italic",
                                fontSize: 11,
                                color: "var(--text-muted)",
                                marginTop: 2,
                              }}
                            >
                              {leaf.bc_name_cn}
                            </div>
                          )}
                          {oline && (
                            <div
                              style={{
                                marginLeft: 78,
                                fontSize: 11,
                                color: "var(--text-dim)",
                                marginTop: 4,
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              {oline}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          );
        })
      )}

      {/* Footer meta */}
      <div
        style={{
          borderTop: "1px solid var(--border-strong)",
          paddingTop: 8,
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>Source: EAM</span>
        <span>Last sync: {relativeTime(data.last_synced_at)}</span>
        {data.taxonomy_versions.length > 0 && (
          <span>
            Taxonomy {data.taxonomy_versions.map((v) => `v${v}`).join("/")}
            {mixedVersions && (
              <span style={{ color: "#f6a623", marginLeft: 6 }}>
                ⚠ mixed versions
              </span>
            )}
          </span>
        )}
        {data.orphan_mappings > 0 && (
          <span style={{ color: "var(--text-muted)" }}>
            ({data.orphan_mappings} orphan mapping
            {data.orphan_mappings === 1 ? "" : "s"} filtered)
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Commit**

```bash
git add "frontend/src/app/apps/[app_id]/CapabilitiesTab.tsx"
git commit -m "feat(bc): frontend CapabilitiesTab component"
```

---

## Task 8: Wire CapabilitiesTab into /apps/[app_id]/page.tsx

**Files:**
- Modify: `frontend/src/app/apps/[app_id]/page.tsx`

Five edits: import, extend Tab type, add count state + prefetch, add TabButton with count badge, add render case. The count prefetch mirrors the existing `deployCount` pattern so the tab badge shows BC count on initial page load (FR-11).

- [ ] **Step 8.1: Add the import**

Near the top of `frontend/src/app/apps/[app_id]/page.tsx` (after the `DeploymentMap` import on line 6), add:

```tsx
import { CapabilitiesTab } from "./CapabilitiesTab";
```

- [ ] **Step 8.2: Extend the Tab type**

Find (line 165):

```tsx
type Tab = "overview" | "integrations" | "investments" | "diagrams" | "impact" | "confluence" | "knowledge" | "deployment";
```

Replace with:

```tsx
type Tab = "overview" | "capabilities" | "integrations" | "investments" | "diagrams" | "impact" | "confluence" | "knowledge" | "deployment";
```

- [ ] **Step 8.3: Add the capCount state + prefetch**

Find (around line 183):

```tsx
  const [deployCount, setDeployCount] = useState<number | undefined>(undefined);
```

Insert a new line immediately after it:

```tsx
  const [capCount, setCapCount] = useState<number | undefined>(undefined);
```

Then find the existing `useEffect` that sets `deployCount` (search for `setDeployCount`). Immediately AFTER the closing `}, [...])` of that useEffect, add a new useEffect:

```tsx
  useEffect(() => {
    if (!app?.app_id) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/apps/${encodeURIComponent(app.app_id)}/business-capabilities`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        if (j.success) setCapCount(j.data.total_count);
      } catch {
        // silently ignore; badge just stays hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [app?.app_id]);
```

(If the surrounding useEffect that fetches `deployCount` uses a different variable than `app?.app_id` — for example, `appId` from `useParams()` — use that same variable in the new useEffect's dependency array. The goal is to fetch once per app change.)

- [ ] **Step 8.4: Add the TabButton with count prop**

Find the tab-nav block (around line 364–388). Insert a new TabButton AFTER the Overview button and BEFORE Integrations:

Find:

```tsx
        <TabButton current={tab} value="overview" onClick={setTab}>
          Overview
        </TabButton>
        <TabButton current={tab} value="integrations" onClick={setTab}>
          Integrations
        </TabButton>
```

Replace with:

```tsx
        <TabButton current={tab} value="overview" onClick={setTab}>
          Overview
        </TabButton>
        <TabButton
          current={tab}
          value="capabilities"
          onClick={setTab}
          count={capCount}
        >
          Capabilities
        </TabButton>
        <TabButton current={tab} value="integrations" onClick={setTab}>
          Integrations
        </TabButton>
```

Note: `TabButton` must already hide the badge when `count === 0` or `count === undefined`. Verify by checking the existing `TabButton` component definition in the same file — if it currently renders a `0` badge instead of hiding it, adjust the TabButton to hide for `count === 0 || count === undefined`. Existing `deployCount` handling should give you the right precedent.

- [ ] **Step 8.5: Add the render line**

Find the tab-content block (around line 400–406). Insert a line after the overview render and before `{tab === "integrations" && ...}`:

Find:

```tsx
      {tab === "integrations" && <IntegrationsTab appId={app.app_id} />}
```

Replace with:

```tsx
      {tab === "capabilities" && <CapabilitiesTab appId={app.app_id} />}
      {tab === "integrations" && <IntegrationsTab appId={app.app_id} />}
```

- [ ] **Step 8.6: Commit**

```bash
git add "frontend/src/app/apps/[app_id]/page.tsx"
git commit -m "feat(bc): wire CapabilitiesTab into App Detail page (after Overview, with count badge)"
```

---

## Task 9: Deploy to server 71 + apply migration

After Task 1–8 are committed, push to gitlab dev and roll out on 71. Per NorthStar's deploy workflow (CLAUDE.md §Development Servers).

- [ ] **Step 9.1: Push to gitlab**

```bash
cd /Users/ruodongyang/Workplace/NorthStar
git push origin dev
```
Expected: push succeeds, no merge conflicts.

- [ ] **Step 9.2: Pull + rebuild backend on 71**

```bash
ssh northstar-server 'cd ~/NorthStar && git pull && docker compose up -d --build backend'
```
Expected: backend container rebuilds and restarts. Watch for "Postgres pool ready" and "alembic_version stamped" in logs.

- [ ] **Step 9.3: Apply the Alembic migration inside the container**

```bash
ssh northstar-server 'docker exec northstar-backend alembic upgrade head'
```
Expected output includes: `Running upgrade 001_baseline -> 002_business_capabilities, business capabilities tables`

- [ ] **Step 9.4: Verify the tables exist**

```bash
ssh northstar-server "PGPASSWORD=\$(grep POSTGRES_PASSWORD ~/NorthStar/.env | cut -d= -f2) psql -h localhost -p 5434 -U northstar -d northstar -c \"SELECT to_regclass('northstar.ref_business_capability'), to_regclass('northstar.ref_app_business_capability');\""
```
Expected: both columns return the table names (not NULL).

- [ ] **Step 9.5: Verify alembic_version updated**

```bash
ssh northstar-server "PGPASSWORD=\$(grep POSTGRES_PASSWORD ~/NorthStar/.env | cut -d= -f2) psql -h localhost -p 5434 -U northstar -d northstar -c 'SELECT version_num FROM northstar.alembic_version;'"
```
Expected: `002_business_capabilities`

---

## Task 10: Run sync, rebuild frontend, smoke test

- [ ] **Step 10.1: Run the sync on 71**

```bash
ssh northstar-server 'cd ~/NorthStar && set -a && source .env && set +a && .venv-ingest/bin/python scripts/sync_from_egm.py --only ref_business_capability ref_app_business_capability'
```
Expected: both tables load. `ref_business_capability` should end with ≈5,080 rows; `ref_app_business_capability` with ≈44 rows (per EAM snapshot 2026-04-18).

- [ ] **Step 10.2: Verify row counts**

```bash
ssh northstar-server "PGPASSWORD=\$(grep POSTGRES_PASSWORD ~/NorthStar/.env | cut -d= -f2) psql -h localhost -p 5434 -U northstar -d northstar -c 'SELECT (SELECT count(*) FROM northstar.ref_business_capability) AS bc_master, (SELECT count(*) FROM northstar.ref_app_business_capability) AS bc_map;'"
```
Expected: `bc_master >= 5000` and `bc_map >= 30`.

- [ ] **Step 10.2b: Verify sync idempotency (AC-5)**

Run the sync a second time, then check that row counts are unchanged and no duplicate rows were created. Capture the pre-state, re-run, compare.

```bash
ssh northstar-server "
  PGPASS=\$(grep POSTGRES_PASSWORD ~/NorthStar/.env | cut -d= -f2)
  BEFORE_MASTER=\$(PGPASSWORD=\$PGPASS psql -h localhost -p 5434 -U northstar -d northstar -t -c 'SELECT count(*) FROM northstar.ref_business_capability;' | tr -d ' ')
  BEFORE_MAP=\$(PGPASSWORD=\$PGPASS psql -h localhost -p 5434 -U northstar -d northstar -t -c 'SELECT count(*) FROM northstar.ref_app_business_capability;' | tr -d ' ')
  cd ~/NorthStar && set -a && source .env && set +a
  .venv-ingest/bin/python scripts/sync_from_egm.py --only ref_business_capability ref_app_business_capability
  AFTER_MASTER=\$(PGPASSWORD=\$PGPASS psql -h localhost -p 5434 -U northstar -d northstar -t -c 'SELECT count(*) FROM northstar.ref_business_capability;' | tr -d ' ')
  AFTER_MAP=\$(PGPASSWORD=\$PGPASS psql -h localhost -p 5434 -U northstar -d northstar -t -c 'SELECT count(*) FROM northstar.ref_app_business_capability;' | tr -d ' ')
  echo \"master before=\$BEFORE_MASTER after=\$AFTER_MASTER\"
  echo \"map    before=\$BEFORE_MAP    after=\$AFTER_MAP\"
  [ \"\$BEFORE_MASTER\" = \"\$AFTER_MASTER\" ] && [ \"\$BEFORE_MAP\" = \"\$AFTER_MAP\" ] && echo IDEMPOTENT_OK || echo IDEMPOTENT_FAIL
"
```

Expected: final line reads `IDEMPOTENT_OK`. If `IDEMPOTENT_FAIL`, inspect the sync output for errors before moving on (common cause: PK column mismatch between DDL and sync entry).

- [ ] **Step 10.3: Hit the API**

```bash
ssh northstar-server 'curl -s http://localhost:8001/api/apps/A000005/business-capabilities | python3 -m json.tool | head -40'
```
Expected: `success: true`, `total_count >= 2`, at least one `l1_groups[]` entry.

- [ ] **Step 10.4: Rebuild frontend**

```bash
ssh northstar-server 'cd ~/NorthStar && docker compose up -d --build frontend'
```
Expected: frontend rebuild completes; `next build` passes.

- [ ] **Step 10.5: Manual UI smoke test**

Open each URL in a browser and visually verify:
- `http://192.168.68.71:3003/apps/A000005` → click Capabilities tab → see L1 groups with leaves, EN + CN names, owner lines, footer shows sync time
- `http://192.168.68.71:3003/apps/A999999` → Capabilities tab shows empty state
- `http://192.168.68.71:3003/apps/A002507` → footer shows `⚠ mixed versions`

- [ ] **Step 10.6: Run api-tests from 71**

```bash
ssh northstar-server 'cd ~/NorthStar && set -a && source .env && set +a && .venv-tests/bin/python -m pytest api-tests/test_business_capabilities.py -v --tb=short'
```
Expected: 7 tests pass (or 2 pass + 5 skipped if sync produced <1 row — the skipped tests are gated on real data).

- [ ] **Step 10.7: If any fix required, iterate**

If a test fails or the UI shows wrong data, inspect logs:
```bash
ssh northstar-server 'docker logs --tail 100 northstar-backend'
```
Fix locally, commit, push, and redeploy the affected service (`docker compose up -d --build backend` or `frontend`). Re-run Step 10.6 until all tests pass.

- [ ] **Step 10.8: Final commit (if any fixes were needed)**

If Step 10.7 produced fixes, commit each fix with a clear message. Otherwise skip.

---

## Summary of Commits Expected

| Task | Commit message |
|------|----------------|
| 1 | `feat(bc): alembic 002 - ref_business_capability + ref_app_business_capability` |
| 2 | `feat(bc): pydantic schemas for app business capabilities response` |
| 3 | `feat(bc): service layer - SQL + L1/L2 grouping` |
| 4 | `feat(bc): router + register - GET /api/apps/{id}/business-capabilities` |
| 5 | `test(bc): api tests - AC-1 through AC-7 coverage` |
| 6 | `feat(bc): sync - widen ref_business_capability (PK id), add ref_app_business_capability` |
| 7 | `feat(bc): frontend CapabilitiesTab component` |
| 8 | `feat(bc): wire CapabilitiesTab into App Detail page (after Overview)` |
| 10.8 | (only if fixes needed) e.g., `fix(bc): <specific issue>` |

9 commits total on the happy path. Task 9 does no local commits (pure deploy steps).

---

## Rollback

If a deploy goes wrong:

```bash
# Revert the 002 migration
ssh northstar-server 'docker exec northstar-backend alembic downgrade 001_baseline'

# Revert the code on 71
ssh northstar-server 'cd ~/NorthStar && git revert <commit-sha> && docker compose up -d --build backend frontend'
```

The two tables get dropped, alembic stamps back to baseline, and the Capabilities tab disappears from the UI (the tab button + render line are removed by the revert). No data is lost because this feature only reads.
