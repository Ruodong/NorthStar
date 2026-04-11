#!/usr/bin/env python3
"""One-off cleanup: delete drawio-backup* / ~*.tmp rows from confluence_attachment.

These rows are Confluence draw.io editor noise — auto-saved revision
snapshots that we never want to surface in NorthStar. They currently make
up ~96% of all rows with file_kind='drawio' and clutter every admin KPI.

Going forward, scripts/scan_confluence.py skips them at scan time
(since this commit's scan_confluence.py change). This script one-shot
removes the existing rows inserted by older scan runs.

Usage (local machine, via VPN to 71):
    python3 scripts/cleanup_backup_attachments.py [--dry-run] [--yes]

Or on 71 directly:
    .venv-ingest/bin/python scripts/cleanup_backup_attachments.py --yes

By default the script prints a count and waits for interactive confirm.
Use --yes to skip the prompt (for cron/automation). Use --dry-run to only
print what would be deleted without running DELETE.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("cleanup-backups")


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


# Match both drawio-backup-* and ~*.tmp files. The percent literal matters:
# we pass it through psycopg format strings, so one '%' here is fine.
BACKUP_WHERE = (
    "title LIKE 'drawio-backup%%' "
    "OR title LIKE '~%%'"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be deleted, don't actually DELETE.",
    )
    ap.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirm prompt (for automation).",
    )
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row, connect_timeout=10)
    try:
        with conn.cursor() as cur:
            # Count what we'd delete
            cur.execute(
                f"""
                SELECT
                    file_kind,
                    COUNT(*) AS n,
                    SUM(CASE WHEN local_path IS NOT NULL THEN 1 ELSE 0 END) AS with_local
                FROM northstar.confluence_attachment
                WHERE {BACKUP_WHERE}
                GROUP BY file_kind
                ORDER BY n DESC
                """
            )
            rows = cur.fetchall()
            if not rows:
                logger.info("No backup/tmp attachments to clean. Nothing to do.")
                return 0

            print()
            print("Candidates to delete:")
            print(f"  {'file_kind':<12} {'count':>10} {'with_local_file':>18}")
            total = 0
            total_local = 0
            for r in rows:
                n = int(r["n"] or 0)
                wl = int(r["with_local"] or 0)
                total += n
                total_local += wl
                print(f"  {r['file_kind']:<12} {n:>10,} {wl:>18,}")
            print(f"  {'TOTAL':<12} {total:>10,} {total_local:>18,}")
            print()
            print(
                "  NOTE: 'with_local_file' counts rows that have a local_path. The\n"
                "  actual files on disk are NOT deleted by this script (too risky).\n"
                "  Only the PG rows are deleted. If you want to also reclaim disk,\n"
                "  look up local_path values before running and rm them manually."
            )
            print()

            if args.dry_run:
                logger.info("--dry-run: no deletion performed.")
                return 0

            if not args.yes:
                resp = input(f"Delete {total:,} rows? [y/N] ").strip().lower()
                if resp not in ("y", "yes"):
                    logger.info("Aborted by user.")
                    return 1

            # Actually delete
            cur.execute(
                f"""
                DELETE FROM northstar.confluence_attachment
                WHERE {BACKUP_WHERE}
                """
            )
            deleted = cur.rowcount
            conn.commit()
            logger.info("deleted %d rows from confluence_attachment", deleted)

            # Report remaining counts so the user can verify the admin KPI will look right
            cur.execute(
                """
                SELECT file_kind, COUNT(*) AS n
                FROM northstar.confluence_attachment
                GROUP BY file_kind
                ORDER BY n DESC
                """
            )
            print()
            print("Remaining attachments after cleanup:")
            print(f"  {'file_kind':<12} {'count':>10}")
            for r in cur.fetchall():
                print(f"  {r['file_kind']:<12} {int(r['n']):>10,}")
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        logger.error("cleanup failed: %s", exc)
        return 1
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
