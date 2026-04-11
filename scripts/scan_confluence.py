#!/usr/bin/env python3
"""Confluence raw-data scanner.

Walks every FY parent page under the ARD space, lists every child project
page, lists every attachment, downloads each file to local disk, and
records metadata in NorthStar postgres (confluence_page + confluence_attachment).

Runs on the HOST under the user's account (inherits the VPN route).

Usage (from ~/NorthStar on 71):
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/scan_confluence.py [--fy FY2526 --fy FY2425] [--limit 20]
                                                       [--no-download]

Default FYs: FY2122 FY2223 FY2324 FY2425 FY2526 FY2627.

Files go to: data/attachments/<attachment_id><ext>
(PG records the full path so the backend can serve them.)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from pathlib import Path
from typing import Optional

import httpx
import psycopg
from psycopg.rows import dict_row

# Local module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from confluence_body import parse_body

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("scan-confluence")

DEFAULT_FYS = ["FY2122", "FY2223", "FY2324", "FY2425", "FY2526", "FY2627"]

PROJECT_ID_RE = re.compile(r"(LI\d{6,7}|RD\d{6,11}|TECHLED-\d+|FY\d{4}-\d+|EA\d{6})")
# Application review pages use "A<5-7 digits>" + separator + name
APP_TITLE_RE = re.compile(r"^(A\d{3,7})[\s_\-:]+(.+)$")

# Map typed fields we want to extract from the questionnaire Metadata section.
# Keys are field names on confluence_page; values are aliases to match against
# the 'key' column in any parsed row (lowercase, stripped).
TYPED_FIELD_ALIASES: dict[str, list[str]] = {
    "q_project_id": ["project id", "projectid"],
    "q_project_name": ["project name", "projectname"],
    "q_pm": ["pm", "project manager"],
    "q_it_lead": ["it lead", "it leader", "it pm"],
    "q_dt_lead": ["dt lead", "dt leader"],
}

# Patterns we accept as a canonical project/application id inside the
# questionnaire Project ID field. Anything else is treated as free text.
_PROJECT_ID_PATTERN = re.compile(
    r"(LI\d{6,7}|RD\d{6,11}|TECHLED-\d+|FY\d{4}-\d+|EA\d{6})"
)
_APP_ID_PATTERN = re.compile(r"^A\d{3,7}$")


def extract_typed_fields(questionnaire: dict) -> dict[str, str]:
    """Walk the parsed questionnaire sections and extract well-known fields."""
    out: dict[str, str] = {}
    if not questionnaire:
        return out
    for section in questionnaire.get("sections", []):
        for row in section.get("rows", []):
            key = (row.get("key") or "").strip().lower()
            value = (row.get("value") or "").strip()
            if not key or not value:
                continue
            for field, aliases in TYPED_FIELD_ALIASES.items():
                if field in out:
                    continue
                if key in aliases:
                    out[field] = value[:500]
    return out

# Extension guesses — used only as a fallback filename hint.
EXT_BY_MEDIA: dict[str, str] = {
    "application/vnd.jgraph.mxfile": ".drawio",
    "application/vnd.jgraph.mxfile.backup": ".drawio.bak",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "application/pdf": ".pdf",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
}


def classify(media_type: str, title: str) -> str:
    """Map a mediaType / title to a coarse file_kind for preview routing."""
    mt = (media_type or "").lower()
    tl = title.lower()
    if "mxfile" in mt or tl.endswith(".drawio") or ".drawio" in tl:
        return "drawio"
    if mt.startswith("image/"):
        return "image"
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


def extension(media_type: str, title: str) -> str:
    # Prefer the extension that's already in the title.
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
        timeout=60.0,
        follow_redirects=True,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )


def get_json(client: httpx.Client, path: str, params: Optional[dict] = None) -> dict:
    for attempt in range(3):
        try:
            r = client.get(path, params=params)
            if r.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPError("retriable")
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001
            if attempt == 2:
                raise
            import time
            time.sleep(1 << attempt)
    return {}


def find_fy_parent(client: httpx.Client, fy: str, space: str) -> Optional[str]:
    data = get_json(
        client,
        "/rest/api/content",
        params={"spaceKey": space, "title": f"{fy} Projects", "limit": 5},
    )
    results = data.get("results", [])
    return results[0]["id"] if results else None


def list_children(client: httpx.Client, parent_id: str) -> list[dict]:
    out: list[dict] = []
    start = 0
    page_size = 50
    while True:
        data = get_json(
            client,
            f"/rest/api/content/{parent_id}/child/page",
            params={"limit": page_size, "start": start, "expand": "_links"},
        )
        results = data.get("results", [])
        out.extend(results)
        if len(results) < page_size:
            break
        start += page_size
    return out


def fetch_page_body(client: httpx.Client, page_id: str) -> Optional[str]:
    """Return the raw body.storage.value HTML, or None on failure."""
    try:
        data = get_json(
            client,
            f"/rest/api/content/{page_id}",
            params={"expand": "body.storage"},
        )
        return data.get("body", {}).get("storage", {}).get("value", "")
    except Exception as exc:  # noqa: BLE001
        logger.warning("body fetch failed %s: %s", page_id, exc)
        return None


def list_attachments(client: httpx.Client, page_id: str) -> list[dict]:
    data = get_json(
        client,
        f"/rest/api/content/{page_id}/child/attachment",
        params={"limit": 200, "expand": "metadata,version"},
    )
    return data.get("results", [])


# Recursion cap. FY parent (depth=0) → project page (depth=1) →
# "* Application Architecture" / "* Technical Architecture" child (depth=2)
# → (rare) deeper sub-pages (depth=3). Anything below 3 is cut off to prevent
# runaway walks on pathological trees.
MAX_DEPTH = 3


def process_page(
    client: httpx.Client,
    pg: "psycopg.Connection",
    page: dict,
    fy: str,
    parent_id: Optional[str],
    depth: int,
    ancestor_project_id: Optional[str],
    args: argparse.Namespace,
    base: str,
    attach_root: Path,
    root: Path,
    totals: dict,
) -> None:
    """Upsert one Confluence page + its attachments, then recursively descend
    into children up to MAX_DEPTH. Spec: confluence-child-pages FR-1..FR-8.
    """
    page_id = page["id"]
    title = page["title"]
    project_id_match = PROJECT_ID_RE.search(title)
    project_id = project_id_match.group(1) if project_id_match else None

    # Detect application review pages: "A000394 - LBP", "A002025 Survey Center", etc.
    app_title_match = APP_TITLE_RE.match(title)
    title_app_id = app_title_match.group(1) if app_title_match else None

    # Classify page type
    if title_app_id:
        page_type = "application"
    elif project_id:
        page_type = "project"
    else:
        page_type = "other"

    page_url = f"{base}/pages/viewpage.action?pageId={page_id}"

    # Fetch + parse the page body (questionnaire lives here)
    body_html = fetch_page_body(client, page_id) if not args.no_body else None
    body_text = ""
    body_q_json: Optional[str] = None
    body_q_obj: Optional[dict] = None
    body_size = 0
    if body_html:
        try:
            parsed_body = parse_body(body_html)
            body_q_obj = {
                "sections": parsed_body.get("sections", []),
                "expand_panels": parsed_body.get("expand_panels", []),
                "stats": parsed_body.get("stats", {}),
            }
            body_text = parsed_body.get("text", "")
            body_q_json = json.dumps(body_q_obj, ensure_ascii=False)
            body_size = len(body_html)
            totals["bodies_parsed"] = totals.get("bodies_parsed", 0) + 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("    body parse failed for %s: %s", page_id, exc)
            totals["errors"] += 1

    # Extract typed fields from the questionnaire for fast SQL join
    typed = extract_typed_fields(body_q_obj) if body_q_obj else {}

    # If title didn't yield a project_id but the questionnaire did
    # and it matches a known pattern, use the questionnaire value.
    final_project_id = project_id
    if final_project_id is None and typed.get("q_project_id"):
        m = _PROJECT_ID_PATTERN.search(typed["q_project_id"])
        if m:
            final_project_id = m.group(1)

    # FR-8: inherit project_id from ancestor when title/questionnaire have none.
    # Child "Application Architecture" / "Technical Architecture" pages
    # typically have no project id in their own title, so we fall back to the
    # project id of the nearest project ancestor.
    if final_project_id is None:
        final_project_id = ancestor_project_id

    # Sometimes the questionnaire 'Project ID' field actually holds
    # a CMDB application id (e.g. 'Tosca' page → A004164). Promote
    # those to q_app_id so the page classifies as 'application'.
    promoted_app_id = title_app_id
    if promoted_app_id is None and typed.get("q_project_id"):
        if _APP_ID_PATTERN.match(typed["q_project_id"].strip()):
            promoted_app_id = typed["q_project_id"].strip()

    # Re-classify after promotion
    if promoted_app_id:
        page_type = "application"
    elif final_project_id and page_type != "application":
        page_type = "project"
    else:
        page_type = page_type  # keep "other"

    with pg.cursor() as cur:
        cur.execute(
            """
            INSERT INTO northstar.confluence_page
                (page_id, fiscal_year, title, project_id, page_url,
                 body_html, body_text, body_questionnaire, body_size_chars,
                 q_project_id, q_project_name, q_pm, q_it_lead, q_dt_lead,
                 q_app_id, page_type, parent_id, depth,
                 last_seen, synced_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    NOW(), NOW())
            ON CONFLICT (page_id) DO UPDATE SET
                fiscal_year = EXCLUDED.fiscal_year,
                title = EXCLUDED.title,
                project_id = COALESCE(EXCLUDED.project_id, northstar.confluence_page.project_id),
                page_url = EXCLUDED.page_url,
                body_html = COALESCE(EXCLUDED.body_html, northstar.confluence_page.body_html),
                body_text = COALESCE(EXCLUDED.body_text, northstar.confluence_page.body_text),
                body_questionnaire = COALESCE(EXCLUDED.body_questionnaire, northstar.confluence_page.body_questionnaire),
                body_size_chars = COALESCE(EXCLUDED.body_size_chars, northstar.confluence_page.body_size_chars),
                q_project_id = COALESCE(EXCLUDED.q_project_id, northstar.confluence_page.q_project_id),
                q_project_name = COALESCE(EXCLUDED.q_project_name, northstar.confluence_page.q_project_name),
                q_pm = COALESCE(EXCLUDED.q_pm, northstar.confluence_page.q_pm),
                q_it_lead = COALESCE(EXCLUDED.q_it_lead, northstar.confluence_page.q_it_lead),
                q_dt_lead = COALESCE(EXCLUDED.q_dt_lead, northstar.confluence_page.q_dt_lead),
                q_app_id = COALESCE(EXCLUDED.q_app_id, northstar.confluence_page.q_app_id),
                page_type = EXCLUDED.page_type,
                parent_id = EXCLUDED.parent_id,
                depth = EXCLUDED.depth,
                last_seen = NOW()
            """,
            (
                page_id, fy, title, final_project_id, page_url,
                body_html, body_text, body_q_json, body_size,
                typed.get("q_project_id"),
                typed.get("q_project_name"),
                typed.get("q_pm"),
                typed.get("q_it_lead"),
                typed.get("q_dt_lead"),
                promoted_app_id,
                page_type,
                parent_id,
                depth,
            ),
        )
    totals["pages"] += 1

    # Attachments
    try:
        attachments = list_attachments(client, page_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("    attachments list failed for %s: %s", page_id, exc)
        totals["errors"] += 1
        attachments = []

    for att in attachments:
        att_id = att["id"]
        a_title = att.get("title", "")
        mt = att.get("metadata", {}).get("mediaType", "")
        kind = classify(mt, a_title)
        size = att.get("extensions", {}).get("fileSize") or att.get("metadata", {}).get(
            "properties", {}
        ).get("fileSize", {}).get("value", 0)
        try:
            size_int = int(size) if size is not None else 0
        except (TypeError, ValueError):
            size_int = 0
        version = att.get("version", {}).get("number", 0)
        download = att.get("_links", {}).get("download", "")
        if not download:
            continue

        local_path: Optional[str] = None
        should_download = (
            not args.no_download
            and not a_title.startswith("drawio-backup")
            and not a_title.startswith("~")
        )
        if should_download and args.kinds and kind not in args.kinds:
            should_download = False
            totals["skipped_kind"] += 1

        if should_download:
            ext = extension(mt, a_title)
            local_file = attach_root / f"{att_id}{ext}"
            if not local_file.exists():
                try:
                    with client.stream("GET", download) as resp:
                        resp.raise_for_status()
                        with open(local_file, "wb") as f:
                            for chunk in resp.iter_bytes(chunk_size=65536):
                                f.write(chunk)
                    totals["downloaded"] += 1
                except Exception as exc:  # noqa: BLE001
                    logger.warning("    download failed %s: %s", a_title, exc)
                    totals["errors"] += 1
                    local_file = None
            local_path = str(local_file.relative_to(root)) if local_file else None

        with pg.cursor() as cur:
            cur.execute(
                """
                INSERT INTO northstar.confluence_attachment
                    (attachment_id, page_id, title, media_type, file_kind,
                     file_size, version, download_path, local_path, last_seen, synced_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                ON CONFLICT (attachment_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    media_type = EXCLUDED.media_type,
                    file_kind = EXCLUDED.file_kind,
                    file_size = EXCLUDED.file_size,
                    version = EXCLUDED.version,
                    download_path = EXCLUDED.download_path,
                    local_path = coalesce(EXCLUDED.local_path, northstar.confluence_attachment.local_path),
                    last_seen = NOW()
                """,
                (
                    att_id, page_id, a_title, mt, kind,
                    size_int, version, download, local_path,
                ),
            )
        totals["attachments"] += 1

    pg.commit()

    # Recurse into children — FR-1 depth-first walk up to MAX_DEPTH
    if depth >= MAX_DEPTH:
        return
    try:
        children = list_children(client, page_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("    child list failed for %s: %s", page_id, exc)
        totals["errors"] += 1
        return

    if not children:
        return

    # Pass our own project_id down as the ancestor for children
    child_ancestor_pid = final_project_id or ancestor_project_id
    totals["descents"] = totals.get("descents", 0) + 1
    for child in children:
        process_page(
            client, pg, child, fy, page_id, depth + 1,
            child_ancestor_pid, args, base, attach_root, root, totals,
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fy", action="append", help="Fiscal year (repeat). Defaults to all 6.")
    ap.add_argument("--limit", type=int, default=None, help="Per-FY project cap")
    ap.add_argument("--no-download", action="store_true", help="Only record metadata, skip downloads")
    ap.add_argument("--no-body", action="store_true", help="Skip body.storage.value fetch + parse")
    ap.add_argument("--kinds", nargs="*", default=None,
                    help="Only download these file kinds (e.g. drawio image pdf)")
    args = ap.parse_args()

    fys = args.fy or DEFAULT_FYS
    space = os.environ.get("CONFLUENCE_SPACE_KEY", "ARD")
    base = os.environ["CONFLUENCE_BASE_URL"].rstrip("/")

    root = Path(__file__).resolve().parent.parent
    attach_root = root / "data" / "attachments"
    attach_root.mkdir(parents=True, exist_ok=True)
    logger.info("attachments dir: %s", attach_root)

    client = make_client()
    pg = psycopg.connect(pg_dsn())
    pg.autocommit = False

    totals = {"pages": 0, "attachments": 0, "downloaded": 0, "skipped_kind": 0, "errors": 0}
    try:
        for fy in fys:
            parent_id = find_fy_parent(client, fy, space)
            if not parent_id:
                logger.warning("FY parent not found for %s", fy)
                continue
            logger.info("FY %s → parent %s", fy, parent_id)
            pages = list_children(client, parent_id)
            if args.limit:
                pages = pages[: args.limit]
            logger.info("  %d project pages", len(pages))

            for i, page in enumerate(pages, 1):
                # Depth 1 = direct children of the FY parent; those are the
                # "project pages" in the old model. process_page recurses from
                # there up to MAX_DEPTH.
                process_page(
                    client, pg, page, fy,
                    parent_id=parent_id, depth=1,
                    ancestor_project_id=None,
                    args=args, base=base,
                    attach_root=attach_root, root=root, totals=totals,
                )
                if i % 20 == 0:
                    logger.info(
                        "  [%s] %d/%d project pages processed (pages_total=%d)",
                        fy, i, len(pages), totals["pages"],
                    )
    finally:
        client.close()
        pg.close()

    logger.info("DONE:")
    for k, v in totals.items():
        logger.info("  %-15s %d", k, v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
