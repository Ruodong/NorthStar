#!/usr/bin/env python3
"""Download confluence_attachment rows that have no local_path yet.

Used after a kinds-filtered scan (e.g. `scan_confluence.py --kinds drawio`)
to fetch the rest of the attachments without re-walking the whole Confluence
tree. Idempotent: re-running skips rows where the local file now exists.

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/download_missing_attachments.py \\
        [--kinds image pdf office other] \\
        [--limit 500] [--max-mb 2000]

Backup/tmp titles are always skipped — they never get downloaded.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional

import httpx
import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("download-missing")


# Extension guesses — same table as scan_confluence.py
EXT_BY_MEDIA: dict[str, str] = {
    "application/vnd.jgraph.mxfile":                            ".drawio",
    "application/vnd.jgraph.mxfile.backup":                     ".drawio.bak",
    "image/png":                                                ".png",
    "image/jpeg":                                               ".jpg",
    "image/gif":                                                ".gif",
    "image/svg+xml":                                            ".svg",
    "application/pdf":                                          ".pdf",
    "application/xml":                                          ".xml",
    "text/xml":                                                 ".xml",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint":                            ".ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":   ".docx",
    "application/msword":                                       ".doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         ".xlsx",
    "application/vnd.ms-excel":                                 ".xls",
}


def extension(media_type: str, title: str) -> str:
    m = re.search(r"\.[A-Za-z0-9]{2,5}$", title)
    if m:
        return m.group(0).lower()
    return EXT_BY_MEDIA.get(media_type, "")


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def make_client() -> httpx.Client:
    base = os.environ["CONFLUENCE_BASE_URL"].rstrip("/")
    token = os.environ["CONFLUENCE_TOKEN"]
    return httpx.Client(
        base_url=base,
        timeout=120.0,
        follow_redirects=True,
        headers={"Authorization": f"Bearer {token}"},
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--kinds",
        nargs="*",
        default=["image", "pdf", "office", "other"],
        help="File kinds to download (default: image pdf office other).",
    )
    ap.add_argument("--limit", type=int, default=None,
                    help="Max attachments to process this run.")
    ap.add_argument("--max-mb", type=float, default=None,
                    help="Stop after downloading this many MB in this run.")
    ap.add_argument("--dry-run", action="store_true",
                    help="List what would be downloaded; do not fetch.")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    attach_root = root / "data" / "attachments"
    attach_root.mkdir(parents=True, exist_ok=True)
    logger.info("attachments dir: %s", attach_root)

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    with conn.cursor() as cur:
        placeholders = ",".join(["%s"] * len(args.kinds))
        cur.execute(
            f"""
            SELECT attachment_id, title, media_type, file_kind,
                   file_size, download_path
            FROM northstar.confluence_attachment
            WHERE local_path IS NULL
              AND title NOT LIKE 'drawio-backup%%'
              AND title NOT LIKE '~%%'
              AND file_kind IN ({placeholders})
            ORDER BY file_kind, file_size NULLS LAST
            """,
            tuple(args.kinds),
        )
        rows = cur.fetchall()
    logger.info("found %d candidates", len(rows))

    stats = {
        "considered": 0,
        "downloaded": 0,
        "skipped_existing": 0,
        "skipped_limit": 0,
        "errors": 0,
        "bytes": 0,
    }
    max_bytes = int(args.max_mb * 1024 * 1024) if args.max_mb else None

    if args.dry_run:
        by_kind: dict[str, int] = {}
        for r in rows:
            by_kind[r["file_kind"]] = by_kind.get(r["file_kind"], 0) + 1
        for k, n in by_kind.items():
            logger.info("  dry %s: %d files", k, n)
        return 0

    client = make_client()
    try:
        with conn.cursor() as wcur:
            for row in rows:
                stats["considered"] += 1
                if args.limit and stats["downloaded"] >= args.limit:
                    stats["skipped_limit"] += 1
                    continue
                if max_bytes and stats["bytes"] >= max_bytes:
                    stats["skipped_limit"] += 1
                    continue

                att_id = row["attachment_id"]
                mt = row["media_type"] or ""
                title = row["title"] or ""
                download = row["download_path"] or ""
                if not download:
                    stats["errors"] += 1
                    continue

                ext = extension(mt, title)
                local_file = attach_root / f"{att_id}{ext}"

                if local_file.exists():
                    # Picked up by a previous run — just link it in PG
                    stats["skipped_existing"] += 1
                else:
                    try:
                        with client.stream("GET", download) as resp:
                            resp.raise_for_status()
                            with open(local_file, "wb") as f:
                                for chunk in resp.iter_bytes(chunk_size=65536):
                                    f.write(chunk)
                        size = local_file.stat().st_size
                        stats["bytes"] += size
                        stats["downloaded"] += 1
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("    failed %s (%s): %s", att_id, title[:40], exc)
                        stats["errors"] += 1
                        if local_file.exists():
                            try:
                                local_file.unlink()
                            except OSError:
                                pass
                        continue

                local_path = str(local_file.relative_to(root))
                wcur.execute(
                    """
                    UPDATE northstar.confluence_attachment
                    SET local_path = %s, last_seen = NOW()
                    WHERE attachment_id = %s
                    """,
                    (local_path, att_id),
                )

                if stats["downloaded"] % 100 == 0 and stats["downloaded"] > 0:
                    conn.commit()
                    mb = stats["bytes"] / (1024 * 1024)
                    logger.info(
                        "  progress: downloaded=%d bytes=%.1fMB errors=%d",
                        stats["downloaded"], mb, stats["errors"],
                    )

        conn.commit()
    finally:
        client.close()
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        if k == "bytes":
            logger.info("  %-20s %.1f MB", k, v / (1024 * 1024))
        else:
            logger.info("  %-20s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
