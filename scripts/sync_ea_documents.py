#!/usr/bin/env python3
"""Sync EA Knowledge Layer from Confluence EA space.

Walks the Enterprise Architecture space (key=EA) on Confluence, extracts
metadata (title, domain, doc_type, excerpt, labels) for Standards, Guidelines,
Reference Architectures, and Templates, and upserts into northstar.ref_ea_document.

Runs on the HOST (needs VPN route to Confluence).

Usage:
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/sync_ea_documents.py [--domain ta] [--limit 10] [--dry-run] [--discover]
"""
from __future__ import annotations

import argparse
import html
import logging
import os
import re
import sys
import time
from typing import Optional

import httpx
import psycopg
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("sync-ea-docs")

# ── EA Space Structure ──────────────────────────────────────────
# Domain parent page IDs → domain codes
DOMAIN_MAP: dict[str, str] = {
    "380103190": "ai",        # GenAI Architecture
    "76459495":  "aa",        # Application Architecture
    "55162586":  "ta",        # Technical Architecture
    "179816618": "da",        # Data Architecture
    "224168548": "dpp",       # Data and Privacy Protection
    "142990211": "governance", # Governance
}

DOMAIN_LABELS: dict[str, str] = {
    "ai":         "GenAI Architecture",
    "aa":         "Application Architecture",
    "ta":         "Technical Architecture",
    "da":         "Data Architecture",
    "dpp":        "Data & Privacy Protection",
    "governance": "Governance",
}

# Category page IDs → doc_type codes
DOC_TYPE_MAP: dict[str, str] = {
    # GenAI Architecture
    "388291332": "standard",       # AI: Standard
    "388291338": "guideline",      # AI: Guidelines
    "388291325": "reference_arch", # AI: Roadmaps & Catalogs
    "388291348": "template",       # AI: Document Templates
    # Application Architecture
    "152160692": "standard",       # AA: Standard
    "253594128": "guideline",      # AA: Guidelines
    "172461582": "reference_arch", # AA: Roadmaps & Catalogs
    "177404369": "template",       # AA: Document Templates
    # Technical Architecture
    "152169841": "standard",       # TA: Standard
    "248458577": "guideline",      # TA: Guidelines
    "172461845": "reference_arch", # TA: Roadmaps & Catalogs
    "177404384": "template",       # TA: Document Templates
    # Data Architecture
    "322696117": "standard",       # DA: Standard
    "268085061": "guideline",      # DA: Guidelines
    "179816625": "reference_arch", # DA: Roadmaps & Catalogs
    "313012510": "template",       # DA: Document Templates
    # Data & Privacy Protection
    "243546167": "standard",       # DPP: Standards
    "243551599": "guideline",      # DPP: Guidelines
    "248461057": "template",       # DPP: Document Templates
    # Governance
    "152160689": "guideline",      # Process
    "500050562": "template",       # EA Template
}


# ── Confluence helpers (same pattern as scan_confluence.py) ─────

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


def fetch_page_detail(client: httpx.Client, page_id: str) -> Optional[dict]:
    """Fetch page with body, version, and labels."""
    try:
        return get_json(
            client,
            f"/rest/api/content/{page_id}",
            params={"expand": "body.storage,version,metadata.labels"},
        )
    except Exception as exc:
        logger.warning("fetch failed page %s: %s", page_id, exc)
        return None


# ── Text extraction ─────────────────────────────────────────────

TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


def strip_html(raw_html: str, max_chars: int = 500) -> str:
    """Strip HTML tags and return first max_chars of plain text."""
    text = TAG_RE.sub(" ", raw_html)
    text = html.unescape(text)
    text = WHITESPACE_RE.sub(" ", text).strip()
    return text[:max_chars]


# ── Sync logic ──────────────────────────────────────────────────

UPSERT_SQL = """\
INSERT INTO northstar.ref_ea_document
    (page_id, title, domain, doc_type, parent_section, page_url,
     excerpt, labels, last_modified, last_modifier, synced_at)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
ON CONFLICT (page_id) DO UPDATE SET
    title          = EXCLUDED.title,
    domain         = EXCLUDED.domain,
    doc_type       = EXCLUDED.doc_type,
    parent_section = EXCLUDED.parent_section,
    page_url       = EXCLUDED.page_url,
    excerpt        = EXCLUDED.excerpt,
    labels         = EXCLUDED.labels,
    last_modified  = EXCLUDED.last_modified,
    last_modifier  = EXCLUDED.last_modifier,
    synced_at      = NOW()
"""


def build_page_url(base_url: str, page_data: dict) -> str:
    web_link = page_data.get("_links", {}).get("webui", "")
    if web_link:
        return f"{base_url}{web_link}"
    return f"{base_url}/pages/viewpage.action?pageId={page_data['id']}"


def sync(
    client: httpx.Client,
    pg: psycopg.Connection,
    base_url: str,
    *,
    domain_filter: Optional[str] = None,
    limit_per_category: Optional[int] = None,
    dry_run: bool = False,
) -> dict[str, int]:
    stats = {"domains": 0, "categories": 0, "documents": 0, "upserted": 0, "skipped": 0, "errors": 0}

    for domain_page_id, domain_code in DOMAIN_MAP.items():
        if domain_filter and domain_code != domain_filter:
            continue

        logger.info("── domain: %s (%s)", DOMAIN_LABELS.get(domain_code, domain_code), domain_code)
        stats["domains"] += 1

        # List category children of this domain parent
        categories = list_children(client, domain_page_id)

        for cat in categories:
            cat_id = cat["id"]
            cat_title = cat["title"]
            doc_type = DOC_TYPE_MAP.get(cat_id)

            if doc_type is None:
                logger.warning("  unknown category %s (%s) — skipping", cat_title, cat_id)
                continue

            logger.info("  category: %s → doc_type=%s", cat_title, doc_type)
            stats["categories"] += 1

            # List document pages under this category
            docs = list_children(client, cat_id)
            if limit_per_category:
                docs = docs[:limit_per_category]

            for doc in docs:
                doc_id = doc["id"]
                doc_title = doc["title"]
                stats["documents"] += 1

                # Fetch full detail (body + labels + version)
                detail = fetch_page_detail(client, doc_id)
                if not detail:
                    stats["errors"] += 1
                    continue

                # Extract fields
                body_html = detail.get("body", {}).get("storage", {}).get("value", "")
                excerpt = strip_html(body_html) if body_html else None

                version = detail.get("version", {})
                last_modified = version.get("when")
                last_modifier = version.get("by", {}).get("displayName")

                labels_raw = detail.get("metadata", {}).get("labels", {}).get("results", [])
                labels = [lb["name"] for lb in labels_raw] if labels_raw else []

                page_url = build_page_url(base_url, detail)

                if dry_run:
                    logger.info("    [dry-run] %s — %s (%s/%s)", doc_id, doc_title, domain_code, doc_type)
                    continue

                try:
                    with pg.cursor() as cur:
                        cur.execute(UPSERT_SQL, (
                            doc_id, doc_title, domain_code, doc_type,
                            cat_title, page_url, excerpt,
                            labels if labels else None,
                            last_modified, last_modifier,
                        ))
                    pg.commit()
                    stats["upserted"] += 1
                    logger.info("    ✓ %s — %s", doc_id, doc_title)
                except Exception as exc:
                    pg.rollback()
                    stats["errors"] += 1
                    logger.error("    ✗ %s — %s: %s", doc_id, doc_title, exc)

                # Gentle rate limit
                time.sleep(0.15)

    return stats


def discover(client: httpx.Client) -> None:
    """Print the EA space tree structure without writing anything."""
    print("EA Space Tree Discovery\n")
    for domain_page_id, domain_code in DOMAIN_MAP.items():
        print(f"── {DOMAIN_LABELS.get(domain_code, domain_code)} ({domain_code}) [page {domain_page_id}]")
        categories = list_children(client, domain_page_id)
        for cat in categories:
            cat_id = cat["id"]
            cat_title = cat["title"]
            known = DOC_TYPE_MAP.get(cat_id)
            marker = f"→ {known}" if known else "⚠ UNKNOWN"
            docs = list_children(client, cat_id)
            print(f"   {cat_title} [{cat_id}] {marker} ({len(docs)} pages)")
            for doc in docs[:5]:
                print(f"      - {doc['title']} [{doc['id']}]")
            if len(docs) > 5:
                print(f"      ... and {len(docs) - 5} more")
        print()


# ── Main ────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Sync EA documents from Confluence EA space")
    parser.add_argument("--domain", help="Sync only this domain (ai/aa/ta/da/dpp/governance)")
    parser.add_argument("--limit", type=int, help="Max documents per category")
    parser.add_argument("--dry-run", action="store_true", help="Fetch but don't write to PG")
    parser.add_argument("--discover", action="store_true", help="Print tree structure and exit")
    args = parser.parse_args()

    client = make_client()
    base_url = os.environ["CONFLUENCE_BASE_URL"].rstrip("/")

    if args.discover:
        discover(client)
        return

    pg = psycopg.connect(pg_dsn(), row_factory=dict_row, autocommit=False)

    try:
        stats = sync(
            client, pg, base_url,
            domain_filter=args.domain,
            limit_per_category=args.limit,
            dry_run=args.dry_run,
        )
    finally:
        pg.close()
        client.close()

    logger.info("── Done ──")
    for k, v in stats.items():
        logger.info("  %s: %d", k, v)

    if stats["errors"] > 0:
        logger.warning("Completed with %d errors", stats["errors"])
        sys.exit(1)


if __name__ == "__main__":
    main()
