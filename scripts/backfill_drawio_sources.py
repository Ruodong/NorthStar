#!/usr/bin/env python3
"""One-off backfill: extract inc-drawio / templateUrl source pages from
every existing confluence_page body_html, fetch those source pages (which
live outside the ARD FY scan tree) individually via Confluence REST API,
persist them to confluence_page + confluence_attachment, and populate the
drawio_reference link table so the admin UI can count "owned drawio +
included drawio" correctly.

Runs anywhere that can reach km.xpaas.lenovo.com with CONFLUENCE_TOKEN —
locally from the dev laptop on VPN, or on 71 where env is already set.

    set -a && source .env && set +a
    python3 scripts/backfill_drawio_sources.py [--dry-run] [--limit N] [--rate-ms 200]

Idempotent: re-running upserts the same rows, no duplicates.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
import psycopg
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("backfill-drawio-sources")


# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def make_client() -> httpx.Client:
    base = os.environ.get("CONFLUENCE_BASE_URL", "").rstrip("/")
    token = os.environ.get("CONFLUENCE_TOKEN", "")
    if not base:
        logger.error("CONFLUENCE_BASE_URL not set")
        sys.exit(1)
    if not token:
        logger.error("CONFLUENCE_TOKEN not set")
        sys.exit(1)
    return httpx.Client(
        base_url=base,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
        follow_redirects=True,
        verify=True,
    )


# -----------------------------------------------------------------------------
# Macro parsing
# -----------------------------------------------------------------------------
_MACRO_RE = re.compile(
    r'<ac:structured-macro[^>]*ac:name="([^"]*drawio[^"]*)"[^>]*>(.*?)</ac:structured-macro>',
    re.DOTALL,
)
_PARAM_RE = re.compile(
    r'<ac:parameter[^>]*ac:name="([^"]+)"[^>]*>(.*?)</ac:parameter>',
    re.DOTALL,
)
_TEMPLATE_URL_RE = re.compile(r'/download/attachments/(\d+)/([^?"]+)')


@dataclass
class DrawioRef:
    inclusion_page_id: str
    source_page_id: str
    macro_kind: str  # 'template_url' | 'inc_drawio' | 'drawio_sketch'
    diagram_name: Optional[str]
    template_filename: Optional[str]


def parse_drawio_refs(inclusion_page_id: str, body_html: str) -> list[DrawioRef]:
    """Extract every drawio macro ref in body_html that points somewhere else."""
    refs: list[DrawioRef] = []
    for macro_name, block in _MACRO_RE.findall(body_html or ""):
        params: dict[str, str] = {}
        for k, v in _PARAM_RE.findall(block):
            # psycopg/Confluence can leave an empty-name param that gobbles
            # the following param's opening tag; only record sane key/values
            if "<" in v:
                v = ""
            params[k] = v.strip()

        name_lower = macro_name.lower()
        if name_lower == "inc-drawio":
            src = params.get("pageId") or params.get("sourcePageId")
            if src and src.isdigit():
                refs.append(
                    DrawioRef(
                        inclusion_page_id=inclusion_page_id,
                        source_page_id=src,
                        macro_kind="inc_drawio",
                        diagram_name=params.get("diagramName"),
                        template_filename=None,
                    )
                )
        elif name_lower == "drawio":
            tmpl = params.get("templateUrl")
            if tmpl:
                m = _TEMPLATE_URL_RE.search(tmpl)
                if m:
                    refs.append(
                        DrawioRef(
                            inclusion_page_id=inclusion_page_id,
                            source_page_id=m.group(1),
                            macro_kind="template_url",
                            diagram_name=params.get("diagramName"),
                            template_filename=m.group(2),
                        )
                    )
        # drawio-sketch is a different format, skip for now
    return refs


# -----------------------------------------------------------------------------
# Confluence REST helpers
# -----------------------------------------------------------------------------
def fetch_page(client: httpx.Client, page_id: str) -> Optional[dict]:
    """GET /rest/api/content/{id} — returns None if 404 / forbidden."""
    try:
        r = client.get(
            f"/rest/api/content/{page_id}",
            params={"expand": "body.storage,version,space"},
        )
        if r.status_code == 404:
            return None
        if r.status_code == 403:
            logger.warning("  403 forbidden on %s", page_id)
            return None
        r.raise_for_status()
        return r.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("  page fetch %s failed: %s", page_id, exc)
        return None


def list_attachments(client: httpx.Client, page_id: str) -> list[dict]:
    """GET /rest/api/content/{id}/child/attachment — paginated."""
    out: list[dict] = []
    start = 0
    while True:
        try:
            r = client.get(
                f"/rest/api/content/{page_id}/child/attachment",
                params={"limit": 200, "start": start},
            )
            r.raise_for_status()
            body = r.json()
            out.extend(body.get("results", []))
            if len(body.get("results", [])) < 200:
                break
            start += 200
        except Exception as exc:  # noqa: BLE001
            logger.warning("  attachments fetch %s failed: %s", page_id, exc)
            break
    return out


_MEDIA_KIND = {
    "application/vnd.jgraph.mxfile": "drawio",
    "application/x-drawio": "drawio",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/svg+xml": "image",
    "application/pdf": "pdf",
    "text/xml": "xml",
    "application/xml": "xml",
}


def classify(media_type: str, title: str) -> str:
    mt = (media_type or "").lower()
    if mt in _MEDIA_KIND:
        return _MEDIA_KIND[mt]
    lower = (title or "").lower()
    if lower.endswith(".drawio") or ".drawio." in lower:
        return "drawio"
    if lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg")):
        return "image"
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith((".ppt", ".pptx", ".doc", ".docx", ".xls", ".xlsx")):
        return "office"
    if lower.endswith(".xml"):
        return "xml"
    return "other"


def extension(media_type: str, title: str) -> str:
    lower = (title or "").lower()
    if lower.endswith(".drawio"):
        return ".drawio"
    if lower.endswith(".png"):
        return ".png"
    if lower.endswith(".pdf"):
        return ".pdf"
    return Path(title).suffix or ".bin"


# -----------------------------------------------------------------------------
# Persistence
# -----------------------------------------------------------------------------
def upsert_source_page(pg: psycopg.Connection, page: dict) -> None:
    """Insert a synthetic source-page row so FKs + joins work. Marked
    page_type='drawio_source' to distinguish from normal scan output."""
    space = (page.get("space") or {}).get("key", "")
    title = page.get("title", "")[:400]
    page_url = page.get("_links", {}).get("webui", "")
    if page_url and not page_url.startswith("http"):
        base = os.environ.get("CONFLUENCE_BASE_URL", "").rstrip("/")
        page_url = f"{base}{page_url}"
    body_html = ((page.get("body") or {}).get("storage") or {}).get("value", "")
    with pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO northstar.confluence_page
                (page_id, fiscal_year, title, project_id, page_url,
                 body_html, body_text, body_questionnaire, body_size_chars,
                 q_project_id, q_project_name, q_pm, q_it_lead, q_dt_lead,
                 q_app_id, page_type, parent_id, depth,
                 effective_app_id, app_hint, effective_app_hint,
                 last_seen, synced_at)
            VALUES (%s, %s, %s, NULL, %s,
                    %s, NULL, NULL, %s,
                    NULL, NULL, NULL, NULL, NULL,
                    NULL, 'drawio_source', NULL, NULL,
                    NULL, NULL, NULL,
                    NOW(), NOW())
            ON CONFLICT (page_id) DO UPDATE SET
                title      = EXCLUDED.title,
                body_html  = COALESCE(EXCLUDED.body_html, northstar.confluence_page.body_html),
                body_size_chars = EXCLUDED.body_size_chars,
                last_seen  = NOW(),
                -- don't overwrite page_type if it's already been set by the
                -- normal scanner, but fill it in when currently NULL
                page_type  = COALESCE(northstar.confluence_page.page_type, 'drawio_source')
            """,
            (
                page["id"],
                space or "SOURCE",  # fiscal_year slot; using space key as a stand-in
                title,
                page_url,
                body_html,
                len(body_html) if body_html else 0,
            ),
        )


def upsert_attachment(pg: psycopg.Connection, page_id: str, att: dict, attach_root: Path, client: httpx.Client, download: bool) -> str:
    """Insert attachment row. Return its file_kind."""
    att_id = att["id"]
    a_title = att.get("title", "")
    mt = att.get("metadata", {}).get("mediaType", "")
    kind = classify(mt, a_title)
    size = (att.get("extensions") or {}).get("fileSize") or 0
    try:
        size_int = int(size) if size is not None else 0
    except (TypeError, ValueError):
        size_int = 0
    version = (att.get("version") or {}).get("number", 0)
    dl_path = ((att.get("_links") or {}).get("download")) or ""

    local_path: Optional[str] = None
    if download and dl_path and kind in ("drawio", "image", "pdf"):
        ext = extension(mt, a_title)
        local_file = attach_root / f"{att_id}{ext}"
        if not local_file.exists():
            try:
                with client.stream("GET", dl_path) as resp:
                    resp.raise_for_status()
                    with open(local_file, "wb") as f:
                        for chunk in resp.iter_bytes(chunk_size=65536):
                            f.write(chunk)
            except Exception as exc:  # noqa: BLE001
                logger.warning("    download failed %s: %s", a_title, exc)
                local_file = None
        local_path = str(local_file) if local_file and local_file.exists() else None

    with pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO northstar.confluence_attachment
                (attachment_id, page_id, title, media_type, file_kind,
                 file_size, version, download_path, local_path, last_seen, synced_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (attachment_id) DO UPDATE SET
                title         = EXCLUDED.title,
                media_type    = EXCLUDED.media_type,
                file_kind     = EXCLUDED.file_kind,
                file_size     = EXCLUDED.file_size,
                version       = EXCLUDED.version,
                download_path = EXCLUDED.download_path,
                local_path    = COALESCE(EXCLUDED.local_path, northstar.confluence_attachment.local_path),
                last_seen     = NOW()
            """,
            (
                att_id, page_id, a_title, mt, kind,
                size_int, version, dl_path, local_path,
            ),
        )
    return kind


def upsert_ref(pg: psycopg.Connection, ref: DrawioRef) -> None:
    # diagram_name is NOT NULL with default '' in the schema (it's part of
    # the composite primary key) — normalize None to '' here.
    name = ref.diagram_name or ""
    with pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO northstar.drawio_reference
                (inclusion_page_id, source_page_id, macro_kind,
                 diagram_name, template_filename,
                 first_seen_at, last_seen_at)
            VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (inclusion_page_id, source_page_id, macro_kind, diagram_name)
            DO UPDATE SET
                template_filename = EXCLUDED.template_filename,
                last_seen_at = NOW()
            """,
            (
                ref.inclusion_page_id,
                ref.source_page_id,
                ref.macro_kind,
                name,
                ref.template_filename,
            ),
        )


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Parse + print, no writes")
    ap.add_argument("--limit", type=int, default=None, help="Limit source pages fetched")
    ap.add_argument("--rate-ms", type=int, default=200, help="Delay between Confluence API calls in milliseconds")
    ap.add_argument("--no-download", action="store_true", help="Record metadata but skip attachment downloads")
    ap.add_argument("--inclusion-limit", type=int, default=None, help="Debug: only scan N inclusion pages")
    args = ap.parse_args()

    pg = psycopg.connect(pg_dsn(), row_factory=dict_row)
    pg.autocommit = False

    client = make_client()
    root = Path(__file__).resolve().parent.parent
    attach_root = root / "data" / "attachments"
    attach_root.mkdir(parents=True, exist_ok=True)

    # --- Stage 1: scan every existing page's body_html for drawio refs -------
    logger.info("stage 1: scanning body_html for drawio references")
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT page_id, body_html
            FROM northstar.confluence_page
            WHERE body_html LIKE '%ac:name="drawio"%'
               OR body_html LIKE '%ac:name="inc-drawio"%'
            """
        )
        sources = cur.fetchall()

    if args.inclusion_limit:
        sources = sources[: args.inclusion_limit]
    logger.info("  %d pages to scan", len(sources))

    all_refs: list[DrawioRef] = []
    for row in sources:
        refs = parse_drawio_refs(row["page_id"], row["body_html"] or "")
        all_refs.extend(refs)
    logger.info("  parsed %d drawio refs", len(all_refs))

    unique_sources = sorted({r.source_page_id for r in all_refs})
    logger.info("  unique source page_ids: %d", len(unique_sources))

    # Stage 1b: also include source pages from page_link refs already in
    # drawio_reference (inserted by scan_confluence.py or SQL backfill).
    # These were NOT discovered by parse_drawio_refs() but still need their
    # source pages fetched if they're missing from confluence_page.
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT source_page_id
            FROM northstar.drawio_reference
            WHERE macro_kind = 'page_link'
            """
        )
        page_link_sources = sorted({r["source_page_id"] for r in cur.fetchall()})
    extra = set(page_link_sources) - set(unique_sources)
    if extra:
        logger.info("  stage 1b: %d additional source pages from page_link refs", len(extra))
        unique_sources = sorted(set(unique_sources) | extra)
        logger.info("  total unique source page_ids: %d", len(unique_sources))

    # --- Stage 2: for each source page, check if we already have it ---------
    with pg.cursor() as cur:
        cur.execute(
            """
            SELECT p.page_id, COALESCE(att.n, 0) AS n_att
            FROM northstar.confluence_page p
            LEFT JOIN (
                SELECT page_id, count(*) AS n
                FROM northstar.confluence_attachment
                WHERE file_kind = 'drawio'
                  AND title NOT LIKE 'drawio-backup%%'
                  AND title NOT LIKE '~%%'
                GROUP BY page_id
            ) att ON att.page_id = p.page_id
            WHERE p.page_id = ANY(%s)
            """,
            (unique_sources,),
        )
        existing = {r["page_id"]: r["n_att"] for r in cur.fetchall()}

    to_fetch = [s for s in unique_sources if s not in existing]
    to_refresh = [s for s in unique_sources if s in existing and existing[s] == 0]
    logger.info(
        "  %d source pages need full fetch, %d need attachment refresh",
        len(to_fetch),
        len(to_refresh),
    )

    if args.limit:
        to_fetch = to_fetch[: args.limit]
        logger.info("  --limit %d applied", args.limit)

    # --- Stage 3: write refs table -------------------------------------------
    if args.dry_run:
        logger.info("DRY RUN: would write %d drawio_reference rows", len(all_refs))
        logger.info("DRY RUN: would fetch %d source pages", len(to_fetch))
        for s in to_fetch[:20]:
            logger.info("  -> would fetch %s", s)
        pg.close()
        return 0

    logger.info("stage 3a: upserting drawio_reference (%d rows)", len(all_refs))
    with pg.cursor() as cur:
        for ref in all_refs:
            try:
                cur.execute("SAVEPOINT ref_upsert")
                upsert_ref(pg, ref)
                cur.execute("RELEASE SAVEPOINT ref_upsert")
            except Exception as exc:  # noqa: BLE001
                logger.warning("  ref upsert failed for %s: %s", ref.inclusion_page_id, exc)
                cur.execute("ROLLBACK TO SAVEPOINT ref_upsert")
    pg.commit()
    logger.info("  done")

    # --- Stage 4: fetch source pages from Confluence -------------------------
    # Include to_refresh pages (exist in DB but have 0 drawio attachments)
    # so their attachments get re-downloaded.
    to_fetch = to_fetch + [s for s in to_refresh if s not in to_fetch]
    logger.info("stage 4: fetching %d source pages", len(to_fetch))
    fetched = 0
    errors = 0
    consecutive_errors = 0
    total_att = 0
    total_drawio = 0
    rate_s = args.rate_ms / 1000.0

    for idx, pid in enumerate(to_fetch, start=1):
        time.sleep(rate_s)
        logger.info("  [%d/%d] fetching page %s", idx, len(to_fetch), pid)
        page = fetch_page(client, pid)
        if not page:
            errors += 1
            consecutive_errors += 1
            if consecutive_errors >= 5:
                logger.error("5 consecutive fetch errors, bailing out")
                break
            continue
        consecutive_errors = 0
        try:
            upsert_source_page(pg, page)
            pg.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("  page upsert failed %s: %s", pid, exc)
            pg.rollback()
            errors += 1
            continue

        # Fetch and persist attachments
        atts = list_attachments(client, pid)
        logger.info("    %d attachments", len(atts))
        with pg.cursor() as acur:
            for att in atts:
                try:
                    acur.execute("SAVEPOINT att_upsert")
                    kind = upsert_attachment(pg, pid, att, attach_root, client, download=not args.no_download)
                    acur.execute("RELEASE SAVEPOINT att_upsert")
                    total_att += 1
                    if kind == "drawio":
                        total_drawio += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("    attachment upsert failed: %s", exc)
                    acur.execute("ROLLBACK TO SAVEPOINT att_upsert")
        pg.commit()
        fetched += 1

    logger.info("=" * 60)
    logger.info("backfill complete")
    logger.info("  pages fetched:       %d / %d", fetched, len(to_fetch))
    logger.info("  attachment rows:     %d", total_att)
    logger.info("  drawio rows:         %d", total_drawio)
    logger.info("  errors:              %d", errors)
    logger.info("  drawio_reference:    %d", len(all_refs))

    pg.close()
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
