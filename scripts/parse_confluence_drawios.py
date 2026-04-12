#!/usr/bin/env python3
"""Parse downloaded Confluence drawio attachments and persist the result.

Spec: .specify/features/confluence-drawio-extract/spec.md

Walks every `confluence_attachment` row where:
  - file_kind = 'drawio'
  - local_path IS NOT NULL
  - title is not a drawio-backup or tmp (already filtered by scanner)

For each file, calls `parse_drawio_xml(xml, "App_Arch")` and upserts:
  - Extracted applications  → confluence_diagram_app (PK: attachment_id, cell_id)
  - Extracted interactions  → confluence_diagram_interaction (PK: attachment_id, edge_cell_id)

Idempotent: ON CONFLICT DO UPDATE with a refreshed `last_seen_at`.

After parsing, automatically invokes `scripts/resolve_confluence_drawio_apps.py`
to repopulate `match_type` / `resolved_app_id` / `name_similarity`. This is
necessary because process_one() does a DELETE+INSERT per attachment (atomic
rebuild, see EC-8), which wipes the resolver's output columns. Without the
auto-resolver step the admin UI falls back to "NO CMDB" for every row that
was just parsed. Pass --no-resolve to skip this step (e.g. when chaining
parse+resolve manually).

Runs on 71 against the host PG + local attachments dir:

    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/parse_confluence_drawios.py            # full run
    .venv-ingest/bin/python scripts/parse_confluence_drawios.py --limit 20 # smoke
    .venv-ingest/bin/python scripts/parse_confluence_drawios.py --attachment-id 517769868
    .venv-ingest/bin/python scripts/parse_confluence_drawios.py --no-resolve
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import psycopg
from psycopg.rows import dict_row

# Reuse the drawio parser verbatim from backend/app/services/drawio_parser.py.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))
from app.services.drawio_parser import parse_drawio_xml  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("parse-confluence-drawios")


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def upsert_app(cur, attachment_id: str, app: dict) -> None:
    # Turn the parser's comma-joined functions field into plain text so we can
    # surface it in the admin UI without extra formatting.
    functions = app.get("functions") or ""
    cur.execute(
        """
        INSERT INTO northstar.confluence_diagram_app
            (attachment_id, cell_id, app_name,
             id_is_standard, standard_id, application_status,
             functions, fill_color, last_seen_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (attachment_id, cell_id) DO UPDATE SET
            app_name           = EXCLUDED.app_name,
            id_is_standard     = EXCLUDED.id_is_standard,
            standard_id        = EXCLUDED.standard_id,
            application_status = EXCLUDED.application_status,
            functions          = EXCLUDED.functions,
            fill_color         = EXCLUDED.fill_color,
            last_seen_at       = NOW()
        """,
        (
            attachment_id,
            app.get("cell_id") or "",
            app.get("app_name") or "",
            bool(app.get("id_is_standard")),
            app.get("standard_id"),
            app.get("application_status"),
            functions,
            app.get("fill_color"),
        ),
    )


def upsert_interaction(cur, attachment_id: str, inter: dict) -> None:
    cur.execute(
        """
        INSERT INTO northstar.confluence_diagram_interaction
            (attachment_id, edge_cell_id, source_cell_id, target_cell_id,
             interaction_type, direction, interaction_status,
             business_object, last_seen_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (attachment_id, edge_cell_id) DO UPDATE SET
            source_cell_id     = EXCLUDED.source_cell_id,
            target_cell_id     = EXCLUDED.target_cell_id,
            interaction_type   = EXCLUDED.interaction_type,
            direction          = EXCLUDED.direction,
            interaction_status = EXCLUDED.interaction_status,
            business_object    = EXCLUDED.business_object,
            last_seen_at       = NOW()
        """,
        (
            attachment_id,
            inter.get("edge_cell_id") or "",
            inter.get("source_id"),
            inter.get("target_id"),
            inter.get("interaction_type"),
            inter.get("direction"),
            inter.get("interaction_status"),
            inter.get("business_object"),
        ),
    )


def process_one(
    cur,
    row: dict,
    repo_root: Path,
    stats: dict,
) -> None:
    att_id    = row["attachment_id"]
    local_rel = row["local_path"]
    local_abs = repo_root / local_rel
    if not local_abs.exists():
        stats["missing_files"] += 1
        logger.debug("  %s: local file missing %s", att_id, local_abs)
        return

    # Some pages store the same drawio content in a .png preview (drawio
    # writer's companion export). Those are image mimetype and will fail the
    # parser — skip based on extension + mimetype.
    if not local_abs.name.endswith((".drawio", ".xml", ".bak")):
        # Not a drawio XML file; skip silently.
        stats["skipped_not_drawio_xml"] += 1
        return

    try:
        with open(local_abs, "r", encoding="utf-8", errors="replace") as f:
            xml = f.read()
    except OSError as exc:
        stats["read_errors"] += 1
        logger.warning("  %s: read error %s", att_id, exc)
        return

    try:
        parsed = parse_drawio_xml(xml, "App_Arch")
    except Exception as exc:  # noqa: BLE001
        stats["parse_errors"] += 1
        logger.warning("  %s: parse error %s", att_id, exc)
        return

    apps = parsed.get("applications", []) or []
    inters = parsed.get("interactions", []) or []

    if not apps and not inters:
        stats["empty_results"] += 1
        return

    # Atomic rebuild per attachment: delete any existing rows for this
    # attachment_id before inserting the new parser output. Without this
    # step, cells that were dropped from the new parse (e.g. sub-modules
    # merged into a container by the frame-promotion pre-pass) remain in
    # confluence_diagram_app as stale orphans, double-counting apps in
    # the admin list.
    cur.execute(
        "DELETE FROM northstar.confluence_diagram_app WHERE attachment_id = %s",
        (att_id,),
    )
    stats["apps_deleted_before_reinsert"] = (
        stats.get("apps_deleted_before_reinsert", 0) + cur.rowcount
    )
    cur.execute(
        "DELETE FROM northstar.confluence_diagram_interaction WHERE attachment_id = %s",
        (att_id,),
    )
    stats["interactions_deleted_before_reinsert"] = (
        stats.get("interactions_deleted_before_reinsert", 0) + cur.rowcount
    )

    for app in apps:
        upsert_app(cur, att_id, app)
        stats["apps_upserted"] += 1
        if app.get("standard_id"):
            stats["apps_with_std_id"] += 1

    for inter in inters:
        upsert_interaction(cur, att_id, inter)
        stats["interactions_upserted"] += 1

    stats["files_parsed"] += 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--attachment-id", help="Process only this attachment (debug)")
    ap.add_argument("--limit", type=int, default=None, help="Process at most N files")
    ap.add_argument(
        "--no-resolve",
        action="store_true",
        help="Skip the post-parse resolve_confluence_drawio_apps.py run. "
             "Only use this when you plan to run the resolver manually.",
    )
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn(), row_factory=dict_row)
    conn.autocommit = False

    stats = {
        "considered": 0,
        "files_parsed": 0,
        "apps_upserted": 0,
        "apps_with_std_id": 0,
        "interactions_upserted": 0,
        "missing_files": 0,
        "read_errors": 0,
        "parse_errors": 0,
        "empty_results": 0,
        "skipped_not_drawio_xml": 0,
    }

    try:
        where_extra = ""
        params: list = []
        if args.attachment_id:
            where_extra = " AND a.attachment_id = %s"
            params.append(args.attachment_id)
        limit_clause = ""
        if args.limit:
            limit_clause = " LIMIT %s"
            params.append(args.limit)

        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT a.attachment_id, a.title, a.local_path
                FROM northstar.confluence_attachment a
                WHERE a.file_kind = 'drawio'
                  AND a.local_path IS NOT NULL
                  AND a.title NOT LIKE 'drawio-backup%%'
                  AND a.title NOT LIKE '~%%'
                  {where_extra}
                ORDER BY a.attachment_id
                {limit_clause}
                """,
                params,
            )
            candidates = cur.fetchall()
        logger.info("loaded %d drawio candidates", len(candidates))

        with conn.cursor() as wcur:
            for i, row in enumerate(candidates, 1):
                stats["considered"] += 1
                process_one(wcur, row, REPO_ROOT, stats)
                if i % 200 == 0:
                    conn.commit()
                    logger.info(
                        "  [%d/%d] parsed=%d apps=%d (std=%d) inters=%d errs=%d",
                        i, len(candidates),
                        stats["files_parsed"], stats["apps_upserted"],
                        stats["apps_with_std_id"], stats["interactions_upserted"],
                        stats["parse_errors"],
                    )

        conn.commit()
    finally:
        conn.close()

    logger.info("DONE:")
    for k, v in stats.items():
        logger.info("  %-24s %d", k, v)

    # EC-8: process_one() wipes resolved_app_id / match_type / name_similarity
    # on every parsed attachment (DELETE+INSERT). Re-run the resolver so the
    # admin UI doesn't show "NO CMDB" for rows we just touched. The resolver
    # has a no-change fast path, so re-running it on the whole table is still
    # O(rows) and finishes in < 30s per NFR-1 of drawio-name-id-reconciliation.
    if args.no_resolve:
        logger.info("--no-resolve: skipping post-parse resolver run")
    elif stats["files_parsed"] == 0:
        logger.info("no files parsed; skipping resolver run")
    else:
        resolver = REPO_ROOT / "scripts" / "resolve_confluence_drawio_apps.py"
        logger.info("invoking %s to repopulate match_type …", resolver.name)
        rc = subprocess.run(
            [sys.executable, str(resolver)],
            env=os.environ.copy(),
        ).returncode
        if rc != 0:
            logger.warning(
                "resolver exited with code %d — match_type will be NULL "
                "for rows just parsed; re-run the resolver manually",
                rc,
            )
            return rc
    return 0


if __name__ == "__main__":
    sys.exit(main())
