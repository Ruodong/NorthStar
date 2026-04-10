#!/usr/bin/env python3
"""Sync master data from EGM postgres to NorthStar postgres.

Copies these tables (EGM → NorthStar):
    egm.cmdb_application                → northstar.ref_application
    egm.employee_info                   → northstar.ref_employee
    egm.project                         → northstar.ref_project
    egm.architecture_diagram            → northstar.ref_diagram
    egm.architecture_diagram_application → northstar.ref_diagram_app
    egm.architecture_diagram_interaction → northstar.ref_diagram_interaction

Idempotent. Uses UPSERT on PK. Batches rows for throughput.

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/sync_from_egm.py

Env vars expected:
    EGM_PG_HOST, EGM_PG_PORT, EGM_PG_DB, EGM_PG_USER, EGM_PG_PASSWORD
    POSTGRES_PASSWORD  (NorthStar postgres; connects to localhost:5434)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("sync")


def egm_dsn() -> str:
    return (
        f"host={os.environ.get('EGM_PG_HOST', 'localhost')} "
        f"port={os.environ.get('EGM_PG_PORT', '5433')} "
        f"dbname={os.environ.get('EGM_PG_DB', 'egm_local')} "
        f"user={os.environ.get('EGM_PG_USER', 'postgres')} "
        f"password={os.environ.get('EGM_PG_PASSWORD', 'postgres')}"
    )


def northstar_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


# -----------------------------------------------------------------------------
# Sync definitions
# -----------------------------------------------------------------------------
# Each entry: (dest_table, pk_columns, (source_select_sql, dest_columns))

SYNCS = [
    (
        "ref_application",
        ["app_id"],
        (
            "SELECT app_id, name, short_description, status FROM egm.cmdb_application",
            ["app_id", "name", "short_description", "status"],
        ),
    ),
    (
        "ref_employee",
        ["itcode"],
        (
            """SELECT itcode, name, email, job_role, worker_type, country,
                      tier_1_org, tier_2_org, manager_itcode, manager_name
               FROM egm.employee_info""",
            [
                "itcode", "name", "email", "job_role", "worker_type", "country",
                "tier_1_org", "tier_2_org", "manager_itcode", "manager_name",
            ],
        ),
    ),
    (
        "ref_project",
        ["project_id"],
        (
            """SELECT project_id, project_name, type, status,
                      pm, pm_itcode, dt_lead, dt_lead_itcode, it_lead, it_lead_itcode,
                      start_date, go_live_date, end_date, ai_related, source
               FROM egm.project""",
            [
                "project_id", "project_name", "type", "status",
                "pm", "pm_itcode", "dt_lead", "dt_lead_itcode", "it_lead", "it_lead_itcode",
                "start_date", "go_live_date", "end_date", "ai_related", "source",
            ],
        ),
    ),
    (
        "ref_diagram",
        ["id"],
        (
            "SELECT id, request_id, diagram_type, file_name, create_at, drawio_xml FROM egm.architecture_diagram",
            ["id", "request_id", "diagram_type", "file_name", "create_at", "drawio_xml"],
        ),
    ),
    (
        "ref_request",
        ["id"],
        (
            """SELECT id, title, project_id, project_code, project_name, project_status,
                      project_pm, project_pm_itcode, project_dt_lead, project_dt_lead_itcode,
                      project_it_lead, project_it_lead_itcode, project_start_date,
                      status, organization, create_at
               FROM egm.governance_request""",
            [
                "id", "title", "project_id", "project_code", "project_name", "project_status",
                "project_pm", "project_pm_itcode", "project_dt_lead", "project_dt_lead_itcode",
                "project_it_lead", "project_it_lead_itcode", "project_start_date",
                "status", "organization", "create_at",
            ],
        ),
    ),
    (
        "ref_diagram_app",
        ["id"],
        (
            """SELECT id, diagram_id, app_id, app_name, id_is_standard,
                      standard_id, functions, application_status
               FROM egm.architecture_diagram_application""",
            [
                "id", "diagram_id", "app_id", "app_name", "id_is_standard",
                "standard_id", "functions", "application_status",
            ],
        ),
    ),
    (
        "ref_diagram_interaction",
        ["id"],
        (
            """SELECT id, diagram_id, source_app_id, target_app_id, interaction_type,
                      direction, source_function, target_function, interface_status, business_object
               FROM egm.architecture_diagram_interaction""",
            [
                "id", "diagram_id", "source_app_id", "target_app_id", "interaction_type",
                "direction", "source_function", "target_function", "interface_status", "business_object",
            ],
        ),
    ),
]


def sync_table(src_conn, dst_conn, dest_table: str, pk_cols: list[str], src_select: str, dst_cols: list[str]) -> int:
    """Read from source, UPSERT into dest. Returns rows copied."""
    logger.info("Syncing %s ...", dest_table)

    run_id = None
    with dst_conn.cursor() as cur:
        cur.execute(
            "INSERT INTO northstar.sync_run (source, table_name) VALUES (%s, %s) RETURNING id",
            ("egm-postgres", dest_table),
        )
        run_id = cur.fetchone()[0]
        dst_conn.commit()

    try:
        with src_conn.cursor(name="sync_cursor") as sc:
            sc.itersize = 5000
            sc.execute(src_select)

            batch: list[tuple] = []
            total = 0
            batch_size = 1000

            col_list = sql.SQL(", ").join(map(sql.Identifier, dst_cols))
            placeholders = sql.SQL(", ").join(sql.Placeholder() * len(dst_cols))
            pk_list = sql.SQL(", ").join(map(sql.Identifier, pk_cols))
            update_cols = [c for c in dst_cols if c not in pk_cols]
            set_clause = sql.SQL(", ").join(
                sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(c)) for c in update_cols
            )
            set_clause = sql.SQL("{}, synced_at = NOW()").format(set_clause)

            upsert_sql = sql.SQL(
                "INSERT INTO northstar.{table} ({cols}) VALUES ({vals}) "
                "ON CONFLICT ({pks}) DO UPDATE SET {set}"
            ).format(
                table=sql.Identifier(dest_table),
                cols=col_list,
                vals=placeholders,
                pks=pk_list,
                set=set_clause,
            )

            for row in sc:
                batch.append(tuple(row[c] for c in dst_cols))
                if len(batch) >= batch_size:
                    with dst_conn.cursor() as dc:
                        dc.executemany(upsert_sql, batch)
                    dst_conn.commit()
                    total += len(batch)
                    if total % 5000 == 0:
                        logger.info("  %s: %d rows", dest_table, total)
                    batch = []

            if batch:
                with dst_conn.cursor() as dc:
                    dc.executemany(upsert_sql, batch)
                dst_conn.commit()
                total += len(batch)

        with dst_conn.cursor() as cur:
            cur.execute(
                "UPDATE northstar.sync_run SET rows_copied = %s, finished_at = NOW(), status = 'ok' WHERE id = %s",
                (total, run_id),
            )
            dst_conn.commit()
        logger.info("%s → %d rows", dest_table, total)
        return total

    except Exception as exc:  # noqa: BLE001
        dst_conn.rollback()
        with dst_conn.cursor() as cur:
            cur.execute(
                "UPDATE northstar.sync_run SET finished_at = NOW(), status = 'error', error = %s WHERE id = %s",
                (str(exc)[:500], run_id),
            )
            dst_conn.commit()
        raise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="Sync only these tables (by dest name)")
    args = ap.parse_args()

    selected = SYNCS
    if args.only:
        wanted = set(args.only)
        selected = [s for s in SYNCS if s[0] in wanted]

    logger.info("EGM  DSN: host=%s port=%s db=%s",
                os.environ.get("EGM_PG_HOST", "localhost"),
                os.environ.get("EGM_PG_PORT", "5433"),
                os.environ.get("EGM_PG_DB", "egm_local"))
    logger.info("NorthStar DSN: host=%s port=%s db=%s",
                os.environ.get("NORTHSTAR_PG_HOST", "localhost"),
                os.environ.get("NORTHSTAR_PG_PORT", "5434"),
                os.environ.get("NORTHSTAR_PG_DB", "northstar"))

    started = datetime.utcnow()
    totals: dict[str, int] = {}

    src = psycopg.connect(egm_dsn(), row_factory=dict_row)
    dst = psycopg.connect(northstar_dsn())
    try:
        for dest_table, pk_cols, (src_select, dst_cols) in selected:
            try:
                totals[dest_table] = sync_table(src, dst, dest_table, pk_cols, src_select, dst_cols)
            except Exception as exc:  # noqa: BLE001
                logger.exception("FAILED %s: %s", dest_table, exc)
                totals[dest_table] = -1
    finally:
        src.close()
        dst.close()

    elapsed = (datetime.utcnow() - started).total_seconds()
    logger.info("DONE in %.1fs", elapsed)
    for t, n in totals.items():
        logger.info("  %-30s %10d", t, n)
    return 0 if all(v >= 0 for v in totals.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
