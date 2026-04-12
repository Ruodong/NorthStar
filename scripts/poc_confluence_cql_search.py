#!/usr/bin/env python3
"""PoC: Use Confluence CQL to search for application names across ALL spaces.

Tests whether we can discover drawio diagrams and pages mentioning NorthStar
applications outside the ARD space we already scan.

Picks 5 well-known apps (by diagram count) and searches for each.
"""
import os
import sys
import json
import httpx
from pathlib import Path

# ---------------------------------------------------------------------------
# Load .env from project root
# ---------------------------------------------------------------------------
env_file = Path(__file__).resolve().parent.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

BASE_URL = os.environ["CONFLUENCE_BASE_URL"].rstrip("/")
TOKEN = os.environ["CONFLUENCE_TOKEN"]

# 5 apps chosen from top-20 by diagram count, varying name specificity
APPS = [
    ("A000001", "ECC"),              # 340 diagrams, very short — may have noise
    ("A002507", "S4 HANA"),          # 155 diagrams, distinctive
    ("A000710", "Lenovo ID"),        # 87 diagrams, multi-word
    ("A003432", "APIH"),             # 178 diagrams, abbreviation
    ("A000424", "LUDP-Lakehouse"),   # 159 diagrams, very specific
]

EXCLUDE_SPACE = "ARD"  # already scanned


def make_client() -> httpx.Client:
    return httpx.Client(
        base_url=BASE_URL,
        timeout=60.0,
        follow_redirects=True,
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"},
    )


def cql_search(client: httpx.Client, cql: str, limit: int = 20) -> dict:
    """Execute a CQL search and return the raw JSON response."""
    r = client.get("/rest/api/content/search", params={"cql": cql, "limit": limit})
    r.raise_for_status()
    return r.json()


def search_app(client: httpx.Client, app_id: str, app_name: str):
    """Search for an app name across non-ARD spaces. Print summary."""
    print(f"\n{'='*70}")
    print(f"  {app_id}  {app_name}")
    print(f"{'='*70}")

    # --- Search 1: Pages mentioning this app name (outside ARD) ---
    cql_pages = f'type = page AND text ~ "{app_name}" AND space != "{EXCLUDE_SPACE}"'
    print(f"\n  CQL: {cql_pages}")
    try:
        result = cql_search(client, cql_pages, limit=10)
        total = result.get("totalSize", result.get("size", 0))
        pages = result.get("results", [])
        print(f"  → {total} total page hits (showing {len(pages)})")
        for p in pages:
            space_key = p.get("_expandable", {}).get("space", "").rsplit("/", 1)[-1]
            # Try to extract space from different locations
            if not space_key:
                space_key = "?"
            title = p.get("title", "?")
            page_id = p.get("id", "?")
            print(f"     [{space_key:>6}] {page_id:>10}  {title[:80]}")
    except Exception as exc:
        print(f"  ✗ Error: {exc}")

    # --- Search 2: drawio attachments mentioning this app name ---
    cql_drawio = (
        f'type = attachment AND filename ~ ".drawio"'
        f' AND container.content.title ~ "{app_name}"'
        f' AND space != "{EXCLUDE_SPACE}"'
    )
    print(f"\n  CQL (drawio on pages titled with app): {cql_drawio}")
    try:
        result = cql_search(client, cql_drawio, limit=5)
        total = result.get("totalSize", result.get("size", 0))
        attachments = result.get("results", [])
        print(f"  → {total} drawio attachment hits (showing {len(attachments)})")
        for a in attachments:
            title = a.get("title", "?")
            att_id = a.get("id", "?")
            print(f"     att:{att_id:>10}  {title[:80]}")
    except Exception as exc:
        print(f"  ✗ Error (may not support this CQL): {exc}")

    # --- Search 3: Simpler — all drawio attachments in non-ARD spaces ---
    # (just count, to understand the universe)
    # Only run for first app to avoid repetition
    if app_id == "A000001":
        cql_all_drawio = f'type = attachment AND filename ~ ".drawio" AND space != "{EXCLUDE_SPACE}"'
        print(f"\n  CQL (ALL drawio outside ARD): {cql_all_drawio}")
        try:
            result = cql_search(client, cql_all_drawio, limit=1)
            total = result.get("totalSize", result.get("size", 0))
            print(f"  → {total} total drawio attachments outside ARD")
        except Exception as exc:
            print(f"  ✗ Error: {exc}")

    # --- Search 4: Pages with app name in TITLE (more precise) ---
    cql_title = f'type = page AND title ~ "{app_name}" AND space != "{EXCLUDE_SPACE}"'
    print(f"\n  CQL (title only): {cql_title}")
    try:
        result = cql_search(client, cql_title, limit=10)
        total = result.get("totalSize", result.get("size", 0))
        pages = result.get("results", [])
        print(f"  → {total} title-match hits (showing {len(pages)})")
        for p in pages:
            space_key = p.get("_expandable", {}).get("space", "").rsplit("/", 1)[-1]
            if not space_key:
                space_key = "?"
            title = p.get("title", "?")
            page_id = p.get("id", "?")
            print(f"     [{space_key:>6}] {page_id:>10}  {title[:80]}")
    except Exception as exc:
        print(f"  ✗ Error: {exc}")


def main():
    client = make_client()
    print(f"Confluence: {BASE_URL}")
    print(f"Exclude space: {EXCLUDE_SPACE}")
    print(f"Apps to search: {len(APPS)}")

    for app_id, app_name in APPS:
        search_app(client, app_id, app_name)

    print(f"\n{'='*70}")
    print("Done.")


if __name__ == "__main__":
    main()
