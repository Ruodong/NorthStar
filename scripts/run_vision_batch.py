#!/usr/bin/env python3
"""Batch vision extraction for all vision_candidate PNG/JPEG files.

Calls the backend /api/admin/confluence/attachments/{id}/vision-extract
endpoint for each candidate, then persists the structured result into
confluence_image_extract_app / _interaction tables.

Concurrency: asyncio + semaphore (default 10 concurrent LLM calls).
Atomic rebuild: DELETE before INSERT per attachment.
Progress: logs every 10 images.

Usage:
    cd ~/NorthStar
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/run_vision_batch.py [--concurrency 10] [--backend-url http://localhost:8001]

Requires: httpx, psycopg2 (from .venv-ingest)
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from pathlib import Path

import httpx
import psycopg
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("vision-batch")


def get_pg_conn():
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=int(os.environ.get("POSTGRES_PORT", "5434")),
        dbname=os.environ.get("POSTGRES_DB", "northstar"),
        user=os.environ.get("POSTGRES_USER", "northstar"),
        password=os.environ.get("POSTGRES_PASSWORD", "northstar"),
        row_factory=dict_row,
    )


def load_candidates(conn) -> list[dict]:
    """Load all vision candidates >= 50KB that haven't been extracted yet
    (no rows in confluence_image_extract_app)."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT a.attachment_id, a.title, a.file_size, a.local_path
            FROM northstar.confluence_attachment a
            WHERE a.vision_candidate = true
              AND a.file_size >= 50000
            ORDER BY a.file_size ASC
        """)
        return cur.fetchall()


def load_already_extracted(conn) -> set[str]:
    """Set of attachment_ids that already have vision extract rows."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT attachment_id
            FROM northstar.confluence_image_extract_app
        """)
        return {r["attachment_id"] for r in cur.fetchall()}


async def extract_one(
    client: httpx.AsyncClient,
    attachment_id: str,
    backend_url: str,
    semaphore: asyncio.Semaphore,
) -> dict | None:
    """Call the backend vision-extract endpoint for one image."""
    async with semaphore:
        try:
            r = await client.get(
                f"{backend_url}/api/admin/confluence/attachments/{attachment_id}/vision-extract",
                timeout=180.0,
            )
            if r.status_code == 200:
                body = r.json()
                if body.get("success"):
                    return body["data"]
                else:
                    logger.warning("att=%s: API error: %s", attachment_id, body.get("error"))
                    return None
            else:
                logger.warning("att=%s: HTTP %d: %s", attachment_id, r.status_code, r.text[:200])
                return None
        except Exception as exc:
            logger.warning("att=%s: exception: %s", attachment_id, exc)
            return None


def persist_result(conn, attachment_id: str, data: dict):
    """Atomic rebuild: delete existing rows, insert new ones."""
    apps = data.get("applications") or []
    interactions = data.get("interactions") or []
    diagram_type = data.get("diagram_type", "unknown")

    with conn.cursor() as cur:
        # Atomic delete
        cur.execute(
            "DELETE FROM northstar.confluence_image_extract_app WHERE attachment_id = %s",
            (attachment_id,),
        )
        cur.execute(
            "DELETE FROM northstar.confluence_image_extract_interaction WHERE attachment_id = %s",
            (attachment_id,),
        )

        # Insert apps
        for i, app in enumerate(apps):
            cell_id = f"v_{i}"
            cur.execute("""
                INSERT INTO northstar.confluence_image_extract_app
                    (attachment_id, cell_id, app_name, standard_id,
                     application_status, functions, diagram_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (attachment_id, cell_id) DO UPDATE SET
                    app_name = EXCLUDED.app_name,
                    standard_id = EXCLUDED.standard_id,
                    application_status = EXCLUDED.application_status,
                    functions = EXCLUDED.functions,
                    diagram_type = EXCLUDED.diagram_type,
                    last_seen_at = now()
            """, (
                attachment_id,
                cell_id,
                app.get("name") or app.get("app_id") or "unknown",
                app.get("standard_id") or None,
                app.get("application_status") or None,
                ", ".join(app.get("functions") or []) or None,
                diagram_type,
            ))

        # Build cell_id lookup for interactions: app_id → cell_id
        app_cell_map: dict[str, str] = {}
        for i, app in enumerate(apps):
            app_id = app.get("app_id") or app.get("name") or ""
            app_cell_map[app_id] = f"v_{i}"

        # Insert interactions
        for i, inter in enumerate(interactions):
            edge_id = f"ve_{i}"
            src_app = inter.get("source_app_id", "")
            tgt_app = inter.get("target_app_id", "")
            cur.execute("""
                INSERT INTO northstar.confluence_image_extract_interaction
                    (attachment_id, edge_cell_id, source_cell_id, target_cell_id,
                     source_app_name, target_app_name,
                     interaction_type, direction, business_object, interface_status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (attachment_id, edge_cell_id) DO UPDATE SET
                    source_cell_id = EXCLUDED.source_cell_id,
                    target_cell_id = EXCLUDED.target_cell_id,
                    source_app_name = EXCLUDED.source_app_name,
                    target_app_name = EXCLUDED.target_app_name,
                    interaction_type = EXCLUDED.interaction_type,
                    direction = EXCLUDED.direction,
                    business_object = EXCLUDED.business_object,
                    interface_status = EXCLUDED.interface_status,
                    last_seen_at = now()
            """, (
                attachment_id,
                edge_id,
                app_cell_map.get(src_app),
                app_cell_map.get(tgt_app),
                src_app,
                tgt_app,
                inter.get("interaction_type"),
                inter.get("direction"),
                inter.get("business_object"),
                inter.get("interface_status"),
            ))


async def main():
    parser = argparse.ArgumentParser(description="Batch vision extraction")
    parser.add_argument("--concurrency", type=int, default=10)
    parser.add_argument("--backend-url", default="http://localhost:8001")
    parser.add_argument("--force", action="store_true",
                        help="Re-extract even if already has results")
    args = parser.parse_args()

    conn = get_pg_conn()
    candidates = load_candidates(conn)
    logger.info("loaded %d vision candidates (>= 50KB)", len(candidates))

    if not args.force:
        already = load_already_extracted(conn)
        before = len(candidates)
        candidates = [c for c in candidates if c["attachment_id"] not in already]
        logger.info("skipping %d already extracted, %d remaining", before - len(candidates), len(candidates))

    if not candidates:
        logger.info("nothing to do")
        return

    semaphore = asyncio.Semaphore(args.concurrency)
    stats = {
        "total": len(candidates),
        "extracted": 0,
        "apps": 0,
        "interactions": 0,
        "errors": 0,
        "empty": 0,
        "total_tokens": 0,
    }

    started = time.time()

    async with httpx.AsyncClient() as client:
        # Process in chunks to commit periodically
        chunk_size = 50
        for chunk_start in range(0, len(candidates), chunk_size):
            chunk = candidates[chunk_start:chunk_start + chunk_size]

            # Fire concurrent requests for this chunk
            tasks = [
                extract_one(client, c["attachment_id"], args.backend_url, semaphore)
                for c in chunk
            ]
            results = await asyncio.gather(*tasks)

            # Persist results
            for c, data in zip(chunk, results):
                att_id = c["attachment_id"]
                if data is None:
                    stats["errors"] += 1
                    continue

                n_apps = len(data.get("applications") or [])
                n_inters = len(data.get("interactions") or [])

                if n_apps == 0:
                    stats["empty"] += 1
                    continue

                persist_result(conn, att_id, data)
                stats["extracted"] += 1
                stats["apps"] += n_apps
                stats["interactions"] += n_inters
                stats["total_tokens"] += (data.get("meta") or {}).get("total_tokens", 0)

            conn.commit()

            done = min(chunk_start + chunk_size, len(candidates))
            elapsed = time.time() - started
            rate = done / elapsed if elapsed > 0 else 0
            eta = (len(candidates) - done) / rate if rate > 0 else 0
            logger.info(
                "  progress: %d/%d  extracted=%d  apps=%d  inters=%d  "
                "errors=%d  empty=%d  tokens=%d  %.1f img/s  ETA %.0fs",
                done, len(candidates),
                stats["extracted"], stats["apps"], stats["interactions"],
                stats["errors"], stats["empty"], stats["total_tokens"],
                rate, eta,
            )

    conn.commit()
    conn.close()
    elapsed = time.time() - started

    logger.info("DONE in %.1fs:", elapsed)
    for k, v in stats.items():
        logger.info("  %-20s %s", k, f"{v:,}" if isinstance(v, int) else v)


if __name__ == "__main__":
    asyncio.run(main())
