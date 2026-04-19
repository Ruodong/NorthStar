#!/usr/bin/env python3
"""Sync the EA architecture-template subtree into NorthStar.

Reads one (or all) rows from northstar.ref_architecture_template_source,
resolves each `confluence_url` to a root page_id, walks its subtree,
upserts every page into confluence_page (with template_source_layer tag)
and every drawio/image attachment into confluence_attachment (same tag).
Downloads drawio/image bytes to data/attachments/<attachment_id><ext>.

Writes final last_sync_status + last_sync_error back into
ref_architecture_template_source.

Runs on the HOST (needs VPN route to Confluence).

Usage:
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/sync_architecture_templates.py \
        [--layer <business|application|technical>] [--dry-run]

Exit codes:
    0 — all requested layers succeeded (or no-op when URL empty)
    1 — at least one layer failed (details in ref_architecture_template_source.last_sync_error)
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Optional

import httpx
import psycopg
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("sync-arch-templates")

VALID_LAYERS = ("business", "application", "technical")

# Coarse classifier — same rules as scan_confluence.py classify() for the
# three kinds we care about here. We re-implement rather than import so
# this script has no cross-script dependency.
def classify(media_type: str, title: str) -> str:
    mt = (media_type or "").lower()
    tl = (title or "").lower()
    if mt.startswith("image/"):
        return "image"
    if "mxfile" in mt or tl.endswith(".drawio"):
        return "drawio"
    if mt == "application/pdf" or tl.endswith(".pdf"):
        return "pdf"
    if "presentation" in mt or tl.endswith((".ppt", ".pptx")):
        return "office"
    if "wordprocessingml" in mt or tl.endswith((".doc", ".docx")):
        return "office"
    if "spreadsheetml" in mt or tl.endswith((".xls", ".xlsx")):
        return "office"
    if "xml" in mt:
        return "xml"
    return "other"


EXT_BY_MEDIA: dict[str, str] = {
    "application/vnd.jgraph.mxfile": ".drawio",
    "application/vnd.jgraph.mxfile.realtime": ".drawio",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/svg+xml": ".svg",
}


def extension(media_type: str, title: str) -> str:
    m = re.search(r"\.[A-Za-z0-9]{2,5}$", title or "")
    if m:
        return m.group(0).lower()
    return EXT_BY_MEDIA.get((media_type or "").lower(), "")


# ── Postgres + HTTP helpers ─────────────────────────────────────


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
        timeout=60.0,
        follow_redirects=True,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )


def get_json(client: httpx.Client, path: str, params: Optional[dict] = None) -> dict:
    for attempt in range(3):
        try:
            r = client.get(path, params=params)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPError(f"retriable {r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1 << attempt)
    return {}


def list_children(client: httpx.Client, parent_id: str) -> list[dict]:
    out: list[dict] = []
    start = 0
    while True:
        data = get_json(
            client,
            f"/rest/api/content/{parent_id}/child/page",
            params={"limit": 50, "start": start, "expand": "_links"},
        )
        results = data.get("results", [])
        out.extend(results)
        if len(results) < 50:
            break
        start += 50
    return out


def list_attachments(client: httpx.Client, page_id: str) -> list[dict]:
    data = get_json(
        client,
        f"/rest/api/content/{page_id}/child/attachment",
        params={"limit": 200, "expand": "metadata,version"},
    )
    return data.get("results", [])


def fetch_page_detail(client: httpx.Client, page_id: str) -> Optional[dict]:
    try:
        return get_json(
            client,
            f"/rest/api/content/{page_id}",
            params={"expand": "version,_links"},
        )
    except Exception as exc:
        logger.warning("page fetch failed %s: %s", page_id, exc)
        return None


# ── URL → page_id resolution ────────────────────────────────────


_PAGEID_QS_RE = re.compile(r"[?&]pageId=(\d+)")
_DISPLAY_RE = re.compile(r"/display/([^/?#]+)/([^/?#]+)")


def resolve_page_id(client: httpx.Client, url: str) -> Optional[str]:
    """Resolve a Confluence page URL to its numeric content id.

    Supports:
      https://.../pages/viewpage.action?pageId=123
      https://.../display/SPACE/Title+With+Spaces
    """
    if not url:
        return None

    m = _PAGEID_QS_RE.search(url)
    if m:
        return m.group(1)

    m = _DISPLAY_RE.search(url)
    if not m:
        return None

    space = m.group(1)
    raw_title = m.group(2)
    # /display/ URLs encode the title with '+' as space and %XX for punctuation.
    title = urllib.parse.unquote(raw_title.replace("+", " "))

    data = get_json(
        client,
        "/rest/api/content",
        params={"spaceKey": space, "title": title, "limit": 5, "expand": "_links"},
    )
    results = data.get("results", [])
    if not results:
        logger.warning("no page found for space=%s title=%r", space, title)
        return None
    return results[0]["id"]


def build_page_url(base_url: str, page_data: dict) -> str:
    web_link = page_data.get("_links", {}).get("webui", "")
    if web_link:
        return f"{base_url}{web_link}"
    return f"{base_url}/pages/viewpage.action?pageId={page_data['id']}"


# ── Upsert SQL ──────────────────────────────────────────────────


UPSERT_PAGE_SQL = """\
INSERT INTO northstar.confluence_page
    (page_id, fiscal_year, title, page_url, page_type, parent_id,
     template_source_layer, last_seen, synced_at)
VALUES (%s, NULL, %s, %s, 'ea_template', %s, %s, NOW(), NOW())
ON CONFLICT (page_id) DO UPDATE SET
    title                  = EXCLUDED.title,
    page_url               = EXCLUDED.page_url,
    page_type              = EXCLUDED.page_type,
    parent_id              = EXCLUDED.parent_id,
    template_source_layer  = EXCLUDED.template_source_layer,
    last_seen              = NOW()
"""

UPSERT_ATTACH_SQL = """\
INSERT INTO northstar.confluence_attachment
    (attachment_id, page_id, title, media_type, file_kind,
     file_size, version, download_path, local_path,
     template_source_layer, last_seen, synced_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
ON CONFLICT (attachment_id) DO UPDATE SET
    title                  = EXCLUDED.title,
    media_type             = EXCLUDED.media_type,
    file_kind              = EXCLUDED.file_kind,
    file_size              = EXCLUDED.file_size,
    version                = EXCLUDED.version,
    download_path          = EXCLUDED.download_path,
    local_path             = coalesce(EXCLUDED.local_path,
                                      northstar.confluence_attachment.local_path),
    template_source_layer  = EXCLUDED.template_source_layer,
    last_seen              = NOW()
"""


# ── Per-layer sync ──────────────────────────────────────────────


def sync_layer(
    client: httpx.Client,
    pg: psycopg.Connection,
    layer: str,
    *,
    attach_root: Path,
    repo_root: Path,
    dry_run: bool = False,
) -> dict[str, int]:
    stats = {"pages": 0, "attachments": 0, "drawios": 0, "downloaded": 0, "errors": 0}

    with pg.cursor() as cur:
        cur.execute(
            "SELECT layer, confluence_url FROM northstar.ref_architecture_template_source "
            "WHERE layer = %s",
            (layer,),
        )
        row = cur.fetchone()

    if not row:
        raise RuntimeError(f"no ref_architecture_template_source row for layer={layer}")

    url = (row["confluence_url"] or "").strip()
    if not url:
        logger.info("[%s] confluence_url empty — nothing to sync", layer)
        with pg.cursor() as cur:
            cur.execute(
                "UPDATE northstar.ref_architecture_template_source "
                "SET last_synced_at = NOW(), last_sync_status = 'ok', "
                "    last_sync_error = NULL, updated_at = NOW() "
                "WHERE layer = %s",
                (layer,),
            )
        pg.commit()
        return stats

    # Resolve root page_id
    root_page_id = resolve_page_id(client, url)
    if not root_page_id:
        raise RuntimeError(f"could not resolve URL to page_id: {url}")

    logger.info("[%s] root page_id=%s", layer, root_page_id)
    if not dry_run:
        with pg.cursor() as cur:
            cur.execute(
                "UPDATE northstar.ref_architecture_template_source "
                "SET confluence_page_id = %s, updated_at = NOW() "
                "WHERE layer = %s",
                (root_page_id, layer),
            )
        pg.commit()

    base_url = os.environ["CONFLUENCE_BASE_URL"].rstrip("/")

    # BFS walk — queue holds (page_id, parent_id) so we can persist the
    # parent relationship. /api/design/standard-templates discovers
    # templates via a recursive CTE on confluence_page.parent_id; without
    # this the design wizard only sees drawios attached directly to the
    # root page and misses everything on child pages.
    queue: list[tuple[str, Optional[str]]] = [(root_page_id, None)]
    visited: set[str] = set()

    while queue:
        pid, parent_id = queue.pop(0)
        if pid in visited:
            continue
        visited.add(pid)

        detail = fetch_page_detail(client, pid)
        if not detail:
            stats["errors"] += 1
            continue

        page_title = detail.get("title") or ""
        page_url = build_page_url(base_url, detail)

        if not dry_run:
            with pg.cursor() as cur:
                cur.execute(
                    UPSERT_PAGE_SQL,
                    (pid, page_title, page_url, parent_id, layer),
                )
            pg.commit()
        stats["pages"] += 1
        logger.info("  page %s — %s", pid, page_title[:80])

        # Attachments
        try:
            attachments = list_attachments(client, pid)
        except Exception as exc:
            logger.warning("  attachment list failed %s: %s", pid, exc)
            stats["errors"] += 1
            attachments = []

        for att in attachments:
            att_id = att["id"]
            a_title = att.get("title", "")
            # Skip editor-noise drawio backups, matches scan_confluence.py.
            if a_title.startswith("drawio-backup") or a_title.startswith("~"):
                continue

            mt = att.get("metadata", {}).get("mediaType", "")
            kind = classify(mt, a_title)
            # Only interested in drawio + paired PNGs (images) for thumbnails.
            if kind not in ("drawio", "image"):
                continue

            size = att.get("extensions", {}).get("fileSize") or att.get(
                "metadata", {}
            ).get("properties", {}).get("fileSize", {}).get("value", 0)
            try:
                size_int = int(size) if size is not None else 0
            except (TypeError, ValueError):
                size_int = 0
            version = att.get("version", {}).get("number", 0)
            download = att.get("_links", {}).get("download", "")
            if not download:
                continue

            local_path: Optional[str] = None
            if not dry_run:
                ext = extension(mt, a_title)
                local_file = attach_root / f"{att_id}{ext}"
                if not local_file.exists():
                    try:
                        with client.stream("GET", download) as resp:
                            resp.raise_for_status()
                            with open(local_file, "wb") as f:
                                for chunk in resp.iter_bytes(chunk_size=65536):
                                    f.write(chunk)
                        stats["downloaded"] += 1
                    except Exception as exc:
                        logger.warning("  download failed %s: %s", a_title, exc)
                        stats["errors"] += 1
                        local_file = None
                if local_file:
                    try:
                        local_path = str(local_file.relative_to(repo_root))
                    except ValueError:
                        local_path = str(local_file)

                with pg.cursor() as cur:
                    cur.execute(
                        UPSERT_ATTACH_SQL,
                        (
                            att_id, pid, a_title, mt, kind,
                            size_int, version, download, local_path,
                            layer,
                        ),
                    )
                pg.commit()
            stats["attachments"] += 1
            if kind == "drawio":
                stats["drawios"] += 1

        # Enqueue children with this page as their parent_id.
        try:
            for child in list_children(client, pid):
                if child["id"] not in visited:
                    queue.append((child["id"], pid))
        except Exception as exc:
            logger.warning("  children list failed %s: %s", pid, exc)
            stats["errors"] += 1

        # Gentle rate limit
        time.sleep(0.1)

    # Mark done
    if not dry_run:
        with pg.cursor() as cur:
            cur.execute(
                "UPDATE northstar.ref_architecture_template_source "
                "SET last_synced_at = NOW(), last_sync_status = 'ok', "
                "    last_sync_error = NULL, updated_at = NOW() "
                "WHERE layer = %s",
                (layer,),
            )
        pg.commit()

    return stats


# ── Main ────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync architecture template subtrees")
    parser.add_argument(
        "--layer",
        choices=VALID_LAYERS,
        help="Sync only this layer (default: all three)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Fetch but don't write")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    # Inside the backend container the repo layout isn't reachable — the
    # script is bind-mounted at /app/scripts and attachments at /app_data.
    # Respect NORTHSTAR_ATTACH_ROOT (set by docker-compose) when present so
    # the same script runs correctly from both .venv-ingest (host) and
    # in-process via BackgroundTask (container).
    attach_root = Path(
        os.environ.get("NORTHSTAR_ATTACH_ROOT") or (repo_root / "data" / "attachments")
    )
    if not args.dry_run:
        attach_root.mkdir(parents=True, exist_ok=True)
    logger.info("attachments dir: %s", attach_root)

    client = make_client()
    pg = psycopg.connect(pg_dsn(), row_factory=dict_row, autocommit=False)

    layers = [args.layer] if args.layer else list(VALID_LAYERS)
    any_failure = False
    per_layer_stats: dict[str, dict[str, int]] = {}

    try:
        for layer in layers:
            logger.info("── layer: %s", layer)
            try:
                stats = sync_layer(
                    client, pg, layer,
                    attach_root=attach_root,
                    repo_root=repo_root,
                    dry_run=args.dry_run,
                )
                per_layer_stats[layer] = stats
            except Exception as exc:
                any_failure = True
                logger.exception("[%s] sync failed: %s", layer, exc)
                safe = str(exc).replace("'", "''")[:500]
                try:
                    pg.rollback()
                except Exception:
                    pass
                with pg.cursor() as cur:
                    cur.execute(
                        "UPDATE northstar.ref_architecture_template_source "
                        "SET last_sync_status = 'error', last_sync_error = %s, "
                        "    updated_at = NOW() "
                        "WHERE layer = %s",
                        (safe, layer),
                    )
                pg.commit()
    finally:
        pg.close()
        client.close()

    logger.info("── Done ──")
    for layer, stats in per_layer_stats.items():
        logger.info("  %s: %s", layer, stats)

    return 1 if any_failure else 0


if __name__ == "__main__":
    sys.exit(main())
