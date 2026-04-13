#!/usr/bin/env python3
"""Sync deployment data from infraops_dev (10.196.155.195) into NorthStar PG.

Full table mirror: wipe + reload. Takes ~30s for all 3 tables (~55K rows).

Usage:
    cd ~/NorthStar && set -a && source .env && set +a
    .venv-ingest/bin/python scripts/sync_from_infraops.py
"""
from __future__ import annotations

import logging
import os
import time

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("sync-infraops")

# Source DB (infraops_dev)
SRC_HOST = "10.196.155.195"
SRC_PORT = 5432
SRC_USER = "a_appconnect"
SRC_PASS = "c8bE9S%#"
SRC_DB = "dxp_data_analysis"
SRC_SCHEMA = "infraops_dev"

# Destination DB (NorthStar PG on 71)
DST_HOST = os.environ.get("POSTGRES_HOST", "localhost")
DST_PORT = int(os.environ.get("POSTGRES_PORT", "5434"))
DST_USER = os.environ.get("POSTGRES_USER", "northstar")
DST_PASS = os.environ.get("POSTGRES_PASSWORD", "northstar")
DST_DB = os.environ.get("POSTGRES_DB", "northstar")

# Table mapping: (source_table, dest_table, columns)
# columns = None means "all columns from source"
TABLES = [
    {
        "src": '"Application_AllServer_MetaData"',
        "dst": "ref_deployment_server",
        "label": "Servers (VM/PM)",
    },
    {
        "src": '"Application_Container_MetaData"',
        "dst": "ref_deployment_container",
        "label": "Containers",
    },
    {
        "src": '"Application_Server_DB_MetaData"',
        "dst": "ref_deployment_database",
        "label": "Databases",
    },
]


def get_src_columns(src_cur, table_name: str) -> list[str]:
    """Get column names from the source table."""
    # Strip quotes for information_schema lookup
    clean = table_name.strip('"')
    src_cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        (SRC_SCHEMA, clean),
    )
    return [r[0] for r in src_cur.fetchall()]


def get_dst_columns(dst_cur, table_name: str) -> list[str]:
    """Get column names from the destination table (excluding synced_at)."""
    dst_cur.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'northstar' AND table_name = %s
          AND column_name != 'synced_at'
        ORDER BY ordinal_position
        """,
        (table_name,),
    )
    return [r[0] for r in dst_cur.fetchall()]


def sync_table(src_conn, dst_conn, spec: dict):
    """Full wipe + reload for one table."""
    label = spec["label"]
    src_table = f'{SRC_SCHEMA}.{spec["src"]}'
    dst_table = f'northstar.{spec["dst"]}'

    logger.info("syncing %s: %s → %s", label, src_table, dst_table)

    # Get columns that exist in BOTH source and destination
    with src_conn.cursor() as src_cur:
        src_cols = set(get_src_columns(src_cur, spec["src"]))
    with dst_conn.cursor() as dst_cur:
        dst_cols = get_dst_columns(dst_cur, spec["dst"])

    # Only sync columns that exist in both
    common_cols = [c for c in dst_cols if c in src_cols]
    if not common_cols:
        logger.error("  no common columns between source and dest!")
        return 0

    # Quote column names for SQL (some have spaces, caps, etc.)
    quoted = [f'"{c}"' for c in common_cols]
    select_sql = f'SELECT {", ".join(quoted)} FROM {src_table}'
    placeholders = ", ".join(["%s"] * len(common_cols))
    insert_sql = f'INSERT INTO {dst_table} ({", ".join(quoted)}) VALUES ({placeholders})'

    # Read all from source
    with src_conn.cursor() as src_cur:
        src_cur.execute(select_sql)
        rows = src_cur.fetchall()

    logger.info("  read %d rows from source", len(rows))

    # Wipe + insert into destination
    with dst_conn.cursor() as dst_cur:
        dst_cur.execute(f"DELETE FROM {dst_table}")
        deleted = dst_cur.rowcount
        if deleted:
            logger.info("  deleted %d existing rows", deleted)

        # Batch insert
        batch_size = 1000
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            dst_cur.executemany(insert_sql, batch)

    dst_conn.commit()
    logger.info("  inserted %d rows", len(rows))
    return len(rows)


def main():
    started = time.time()

    src_conn = psycopg.connect(
        host=SRC_HOST, port=SRC_PORT,
        user=SRC_USER, password=SRC_PASS,
        dbname=SRC_DB,
    )
    dst_conn = psycopg.connect(
        host=DST_HOST, port=DST_PORT,
        user=DST_USER, password=DST_PASS,
        dbname=DST_DB,
    )

    total = 0
    for spec in TABLES:
        total += sync_table(src_conn, dst_conn, spec)

    src_conn.close()
    dst_conn.close()

    elapsed = time.time() - started
    logger.info("DONE in %.1fs — %d total rows synced", elapsed, total)


if __name__ == "__main__":
    main()
