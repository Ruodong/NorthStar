# Business Capabilities — API & Data Reference

Companion to `spec.md`. Read on demand when touching the schema, migration,
or the `/api/apps/{app_id}/business-capabilities` endpoint.

---

## 1. API Endpoint

### `GET /api/apps/{app_id}/business-capabilities`

Returns the Business Capability mappings for an application, grouped by
L1 Domain → L2 Subdomain → L3 leaf, plus metadata for the tab footer.

#### Path parameters

| Name | Type | Description |
|------|------|-------------|
| `app_id` | string | Application identifier. CMDB-style (e.g. `A000005`) or diagram-hash (`X<sha256…>`). Non-CMDB apps return an empty `l1_groups`. |

#### Response (`200 OK`)

```json
{
  "success": true,
  "data": {
    "app_id": "A000005",
    "total_count": 7,
    "l1_groups": [
      {
        "l1_domain": "Product Development",
        "count": 3,
        "l2_groups": [
          {
            "l2_subdomain": "Portfolio & Planning Management",
            "leaves": [
              {
                "bc_id": "C1.1.1",
                "bc_name": "Strategy Definition",
                "bc_name_cn": "战略定义",
                "bc_description": "Define and govern the product strategy…",
                "level": 3,
                "lv3_capability_group": "Strategy Definition",
                "biz_owner": "zhangs",
                "biz_team": "Strategy Team",
                "dt_owner": "wangdz",
                "dt_team": "EA Team",
                "data_version": "1.6",
                "source_updated_at": "2026-04-09T17:53:31Z"
              }
            ]
          }
        ]
      }
    ],
    "taxonomy_versions": ["1.4", "1.7", "1.8"],
    "last_synced_at": "2026-04-18T08:00:00Z"
  },
  "meta": {
    "orphan_mappings": 0
  },
  "error": null
}
```

#### Response fields

| Field | Type | Notes |
|-------|------|-------|
| `app_id` | string | Echoed from path param. |
| `total_count` | int | Number of L3 leaves (post-orphan filtering). `0` when no mappings or unknown app. |
| `l1_groups[]` | array | Empty array when no mappings. Sorted by `count` desc, then `l1_domain` asc. |
| `l1_groups[].l1_domain` | string | From `bcpf_master_data.lv1_domain`. |
| `l1_groups[].count` | int | Number of leaves under this L1. |
| `l1_groups[].l2_groups[]` | array | Sorted by `l2_subdomain` asc. |
| `l1_groups[].l2_groups[].l2_subdomain` | string | From `bcpf_master_data.lv2_sub_domain`. |
| `l1_groups[].l2_groups[].leaves[]` | array | Sorted by `bc_id` asc (dictionary order → C1.1.1 before C1.1.2). |
| `leaves[].bc_id` | string | Human code (e.g. `C1.1.1`). Resolved via master join; never null in response even if `ref_app_business_capability.bc_id` was NULL. |
| `leaves[].bc_name` | string | English name. |
| `leaves[].bc_name_cn` | string \| null | Chinese name. `null` (not empty string) when absent. |
| `leaves[].bc_description` | string \| null | For tooltip. `null` when absent. |
| `leaves[].level` | int | Always `3` in this feature (L3 leaves only). |
| `leaves[].lv3_capability_group` | string | Leaf-level label, often equal to `bc_name`. |
| `leaves[].biz_owner` / `biz_team` / `dt_owner` / `dt_team` | string \| null | `null` for each missing. Frontend hides the owner line only if all four are null. |
| `leaves[].data_version` | string \| null | Copy of `biz_cap_map.data_version` (the mapping row's version, not the master's). |
| `leaves[].source_updated_at` | ISO8601 \| null | From `biz_cap_map.update_at`. |
| `taxonomy_versions` | string[] | Distinct non-null `data_version` across all mappings for this app, sorted. Empty array allowed. |
| `last_synced_at` | ISO8601 \| null | Most recent `synced_at` across the mapping rows. `null` if never synced for this app. |
| `meta.orphan_mappings` | int | Mapping rows whose `bcpf_master_id` didn't resolve — filtered from `l1_groups` but counted here for debugging. |

#### Errors

| Status | When |
|--------|------|
| `200` | Always for a well-formed `app_id`, including unmapped / non-existent apps (returns empty structure). |
| `422` | `app_id` is empty or malformed beyond FastAPI path validation. |
| `500` | Database unreachable or query error. Frontend renders inline error banner inside the tab. |

---

## 2. Database Schema

### 2.1 `northstar.ref_business_capability`

Mirrors `eam.bcpf_master_data`.

```sql
CREATE TABLE IF NOT EXISTS northstar.ref_business_capability (
    id                    BIGINT      PRIMARY KEY,           -- preserved from EAM
    data_version          VARCHAR(32) NOT NULL DEFAULT '',
    bc_id                 VARCHAR(64) NOT NULL,              -- e.g. "C1.1.1"
    parent_bc_id          VARCHAR(64) NOT NULL DEFAULT 'root',
    bc_name               TEXT        NOT NULL,
    bc_name_cn            TEXT,
    level                 SMALLINT    NOT NULL,              -- 1|2|3
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
    source_created_at     TIMESTAMPTZ,                       -- from create_time
    synced_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ref_bc_bc_id          ON northstar.ref_business_capability (bc_id);
CREATE INDEX IF NOT EXISTS ix_ref_bc_level_domain   ON northstar.ref_business_capability (level, lv1_domain);
```

### 2.2 `northstar.ref_app_business_capability`

Mirrors `eam.biz_cap_map`.

```sql
CREATE TABLE IF NOT EXISTS northstar.ref_app_business_capability (
    id                 UUID        PRIMARY KEY,              -- preserved from EAM
    app_id             VARCHAR(64) NOT NULL,                 -- joins ref_application.app_id
    bcpf_master_id     BIGINT      NOT NULL,                 -- FK to ref_business_capability.id, NOT enforced
    bc_id              VARCHAR(64),                          -- raw from source, may be NULL
    data_version       VARCHAR(32),
    source_create_by   TEXT,
    source_update_by   TEXT,
    source_created_at  TIMESTAMPTZ,
    source_updated_at  TIMESTAMPTZ,
    synced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ref_app_bc_app_id   ON northstar.ref_app_business_capability (app_id);
CREATE INDEX IF NOT EXISTS ix_ref_app_bc_bcpf_id  ON northstar.ref_app_business_capability (bcpf_master_id);
```

### 2.3 Alembic Migration Skeleton

`backend/alembic/versions/002_business_capabilities.py`:

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
            -- see api.md §2.1 for full DDL
        );
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS northstar.ref_app_business_capability (
            -- see api.md §2.2 for full DDL
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_ref_bc_bc_id
            ON northstar.ref_business_capability (bc_id);
        CREATE INDEX IF NOT EXISTS ix_ref_bc_level_domain
            ON northstar.ref_business_capability (level, lv1_domain);
        CREATE INDEX IF NOT EXISTS ix_ref_app_bc_app_id
            ON northstar.ref_app_business_capability (app_id);
        CREATE INDEX IF NOT EXISTS ix_ref_app_bc_bcpf_id
            ON northstar.ref_app_business_capability (bcpf_master_id);
    """)


def downgrade() -> None:
    op.execute("SET search_path TO northstar, public;")
    op.execute("DROP TABLE IF EXISTS northstar.ref_app_business_capability;")
    op.execute("DROP TABLE IF EXISTS northstar.ref_business_capability;")
```

---

## 3. Primary Query

Single statement drives the endpoint. Ordering handled in SQL to simplify
the Python aggregation step.

```sql
SELECT
    m.id                  AS mapping_id,
    m.app_id,
    m.data_version        AS mapping_data_version,
    m.source_updated_at,
    m.synced_at,
    bc.id                 AS bcpf_master_id,
    bc.bc_id,
    bc.bc_name,
    NULLIF(bc.bc_name_cn, '')        AS bc_name_cn,
    NULLIF(bc.bc_description, '')    AS bc_description,
    bc.level,
    bc.lv1_domain,
    NULLIF(bc.lv2_sub_domain, '')    AS lv2_sub_domain,
    NULLIF(bc.lv3_capability_group,'') AS lv3_capability_group,
    NULLIF(bc.biz_owner, '')         AS biz_owner,
    NULLIF(bc.biz_team, '')          AS biz_team,
    NULLIF(bc.dt_owner, '')          AS dt_owner,
    NULLIF(bc.dt_team, '')           AS dt_team
FROM northstar.ref_app_business_capability m
JOIN northstar.ref_business_capability bc
  ON bc.id = m.bcpf_master_id
WHERE m.app_id = $1
ORDER BY
    bc.lv1_domain ASC,
    bc.lv2_sub_domain ASC NULLS LAST,
    bc.bc_id ASC;
```

### Orphan count (separate query; cheap)

```sql
SELECT COUNT(*) AS orphans
FROM northstar.ref_app_business_capability m
LEFT JOIN northstar.ref_business_capability bc
  ON bc.id = m.bcpf_master_id
WHERE m.app_id = $1 AND bc.id IS NULL;
```

### L1 sort by count (applied in Python)

The SQL orders lexicographically within a domain. The backend then
re-orders L1 groups by `count DESC, l1_domain ASC` before serializing,
so high-density domains surface first.

---

## 4. Sync Script Additions

`scripts/sync_from_egm.py` already has the master-data entry for
`bcpf_master_data` in the `SYNCS` array. This feature adds the mapping
entry.

### New mapping sync entry

```python
{
    "source_table": "eam.biz_cap_map",
    "target_table": "northstar.ref_app_business_capability",
    "primary_key": "id",
    "columns": {
        "id":               "id",
        "app_id":           "app_id",
        "bcpf_master_id":   "bcpf_master_id",
        "bc_id":            "bc_id",
        "data_version":     "data_version",
        "create_by":        "source_create_by",
        "update_by":        "source_update_by",
        "create_at":        "source_created_at",
        "update_at":        "source_updated_at",
    },
    "post_sync": "UPDATE northstar.ref_app_business_capability SET synced_at = now()",
}
```

### Idempotency

- Stage-table pattern: `ref_app_business_capability_stage` is TRUNCATE'd and
  populated each run, then merged into the live table via UPSERT on `id`.
- Rows deleted upstream are removed by a DELETE WHERE NOT IN (...) guarded
  by "stage-table has ≥1 row" sanity check (prevents full wipe on fetch
  failure).
- Running the script twice produces byte-identical table state (AC-5).

---

## 5. Sample EAM Data

Captured 2026-04-18 from `10.195.6.89/it_portal.eam`. Use these for API
tests.

| app_id | bcpf_master_id | bc_id | bc_name | data_version |
|--------|----------------|-------|---------|--------------|
| A000005 | 527873 | C1.1.2 | Product Portfolio Planning | 1.6 |
| A000005 | 527878 | C1.2.2 | Project Quality | 1.6 |
| A000006 | 527878 | C1.2.1 | Project Quality | 1.6 |
| A000006 | 527355 | C12.2.1 | Email Phishing | 1.5 |
| A002507 | 527532 | C3.9.4 | … | 1.4 |
| A002507 | 530484 | C6.12.4 | … | 1.7 |
| A002507 | 530922 | C4.5.3 | … | 1.8 |
| A004604 | 528473 | NULL | (resolve via master) | NULL |

- **A000005** exercises multi-domain grouping (7 BCs across 4 L1 domains) — AC-1.
- **A002507** exercises mixed taxonomy versions (1.4 / 1.7 / 1.8) — AC-3.
- **A004604** exercises EC-1 (NULL `bc_id` on mapping, resolve via master).

---

## 6. Frontend Data Model

### TypeScript response type

```ts
export type AppBusinessCapabilitiesResponse = {
  app_id: string;
  total_count: number;
  l1_groups: CapabilityL1Group[];
  taxonomy_versions: string[];
  last_synced_at: string | null;
};

export type CapabilityL1Group = {
  l1_domain: string;
  count: number;
  l2_groups: CapabilityL2Group[];
};

export type CapabilityL2Group = {
  l2_subdomain: string;
  leaves: BusinessCapabilityLeaf[];
};

export type BusinessCapabilityLeaf = {
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
};
```

### Fetch pattern

Follows `ImpactTab` lazy-load convention: `useEffect` triggered by
`tab === "capabilities"`, caches response in local state, does not
refetch on tab switch.
