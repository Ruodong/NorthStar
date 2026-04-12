"""Confluence CQL search — cross-space knowledge base lookup.

Provides a cached, async-friendly wrapper around the Confluence REST
search endpoint.  Used by the Knowledge Base tab on the App Detail page
to discover pages in non-ARD spaces that mention an application by name.

Cache: in-memory dict with per-key TTL (default 5 min).  The backend
process restarts on deploy so stale entries never live long.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL Cache
# ---------------------------------------------------------------------------
_CACHE_TTL_SECONDS = 300  # 5 minutes
_cache: dict[str, tuple[float, list[dict]]] = {}


def _cache_get(key: str) -> Optional[list[dict]]:
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, data = entry
    if time.monotonic() - ts > _CACHE_TTL_SECONDS:
        del _cache[key]
        return None
    return data


def _cache_set(key: str, data: list[dict]) -> None:
    _cache[key] = (time.monotonic(), data)


# ---------------------------------------------------------------------------
# CQL Search
# ---------------------------------------------------------------------------

EXCLUDE_SPACE = "ARD"
CQL_LIMIT = 50  # max pages per query (Confluence caps at 200)


def _build_cql(app_name: str) -> str:
    """Build the CQL query with all backend-side filters."""
    # Escape double quotes in app name
    safe = app_name.replace('"', '\\"')
    return (
        f'type=page'
        f' AND title~"{safe}"'
        f' AND space!="{EXCLUDE_SPACE}"'
        f' AND space.type="global"'
        f' AND lastModified>="2024-04-01"'
    )


def _search_sync(app_name: str) -> list[dict]:
    """Execute CQL search against Confluence (blocking)."""
    base = settings.confluence_base_url.rstrip("/")
    token = settings.confluence_token
    if not base or not token:
        logger.warning("Confluence not configured — returning empty knowledge base")
        return []

    client = httpx.Client(
        base_url=base,
        timeout=30.0,
        follow_redirects=True,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    try:
        cql = _build_cql(app_name)
        logger.info("CQL search: %s", cql)
        resp = client.get(
            "/rest/api/content/search",
            params={
                "cql": cql,
                "limit": CQL_LIMIT,
                "expand": "space,history.lastUpdated",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        total = data.get("totalSize", 0)
        results = data.get("results", [])
        logger.info("CQL returned %d/%d for '%s'", len(results), total, app_name)

        pages: list[dict] = []
        for p in results:
            space = p.get("space", {})
            hist = p.get("history", {})
            last_upd = hist.get("lastUpdated", {})
            web_ui = p.get("_links", {}).get("webui", "")
            page_url = f"{base}{web_ui}" if web_ui else ""

            pages.append({
                "page_id": p.get("id", ""),
                "title": p.get("title", ""),
                "space_key": space.get("key", ""),
                "space_name": space.get("name", ""),
                "last_modified": last_upd.get("when", "")[:10],
                "updater": last_upd.get("by", {}).get("displayName", ""),
                "page_url": page_url,
            })

        return pages
    except Exception:
        logger.exception("CQL search failed for '%s'", app_name)
        return []
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------

async def search_knowledge_base(app_name: str) -> dict:
    """Search Confluence for pages mentioning *app_name* outside ARD.

    Returns::

        {
            "total": int,           # totalSize from CQL (may exceed returned)
            "app_name": str,
            "spaces": [             # grouped by space, sorted by page count DESC
                {
                    "space_key": str,
                    "space_name": str,
                    "page_count": int,
                    "pages": [
                        {
                            "page_id": str,
                            "title": str,
                            "last_modified": str,   # "YYYY-MM-DD"
                            "updater": str,
                            "page_url": str,         # full Confluence URL
                        },
                        ...
                    ],
                },
                ...
            ],
        }
    """
    cache_key = f"kb:{app_name}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info("Cache hit for knowledge base '%s'", app_name)
        # cached is the flat pages list; re-group on return
        pages = cached
    else:
        pages = await asyncio.to_thread(_search_sync, app_name)
        _cache_set(cache_key, pages)

    # Group by space, sort spaces by page count DESC
    by_space: dict[str, dict] = {}
    for pg in pages:
        sk = pg["space_key"]
        if sk not in by_space:
            by_space[sk] = {
                "space_key": sk,
                "space_name": pg["space_name"],
                "pages": [],
            }
        by_space[sk]["pages"].append({
            "page_id": pg["page_id"],
            "title": pg["title"],
            "last_modified": pg["last_modified"],
            "updater": pg["updater"],
            "page_url": pg["page_url"],
        })

    spaces = sorted(by_space.values(), key=lambda s: len(s["pages"]), reverse=True)
    for s in spaces:
        s["page_count"] = len(s["pages"])
        # Sort pages within space by date DESC
        s["pages"].sort(key=lambda p: p["last_modified"], reverse=True)

    return {
        "total": len(pages),
        "app_name": app_name,
        "spaces": spaces,
    }
