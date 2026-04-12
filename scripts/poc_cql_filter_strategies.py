#!/usr/bin/env python3
"""PoC: Test filtering strategies for Confluence CQL search.

Compares different CQL refinements to reduce noise when searching
for application names across non-ARD spaces.
"""
import os
import httpx
from pathlib import Path

# Load .env
env_file = Path(__file__).resolve().parent.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

BASE_URL = os.environ["CONFLUENCE_BASE_URL"].rstrip("/")
TOKEN = os.environ["CONFLUENCE_TOKEN"]
EXCLUDE = "ARD"

# Use ECC (noisiest) and APIH (moderate) as test subjects
TEST_APPS = [("A000001", "ECC"), ("A003432", "APIH")]


def client():
    return httpx.Client(
        base_url=BASE_URL, timeout=60.0, follow_redirects=True,
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"},
    )


def cql(c, q, limit=5):
    r = c.get("/rest/api/content/search", params={"cql": q, "limit": limit})
    if r.status_code == 400:
        return {"error": r.text[:200], "totalSize": -1}
    r.raise_for_status()
    return r.json()


def show(label, result, show_results=True):
    total = result.get("totalSize", result.get("size", "?"))
    if total == -1:
        print(f"  {label:50s}  → CQL 400 ERROR")
        return
    print(f"  {label:50s}  → {total:>6} hits")
    if show_results:
        for p in result.get("results", [])[:3]:
            sp = p.get("_expandable", {}).get("space", "").rsplit("/", 1)[-1] or "?"
            print(f"       [{sp:>8}] {p.get('title', '?')[:70]}")


def test_app(c, app_id, name):
    print(f"\n{'='*70}")
    print(f"  {app_id}  {name}")
    print(f"{'='*70}")

    # --- Baseline ---
    show("baseline: text~name",
         cql(c, f'type=page AND text~"{name}" AND space!="{EXCLUDE}"'))

    # --- Strategy 1: Title-only (much tighter) ---
    show("S1: title~name",
         cql(c, f'type=page AND title~"{name}" AND space!="{EXCLUDE}"'))

    # --- Strategy 2: Exclude personal spaces (~username) ---
    show("S2: title + not personal space",
         cql(c, f'type=page AND title~"{name}" AND space!="{EXCLUDE}" AND type=page AND space.type="global"'))

    # --- Strategy 3: Recency (last 2 years) ---
    show("S3: title + modified after 2024-04-01",
         cql(c, f'type=page AND title~"{name}" AND space!="{EXCLUDE}" AND lastModified>="2024-04-01"'))

    # --- Strategy 4: Title exact phrase (quoted) ---
    show("S4: title = exact name",
         cql(c, f'type=page AND title="{name}" AND space!="{EXCLUDE}"'))

    # --- Strategy 5: Has attachment (pages with any attachment) ---
    # CQL doesn't support has:attachment, but we can try content.type
    # Actually: try searching for pages that have macros (drawio embeds use ac:structured-macro)
    show("S5: text~name + text~drawio",
         cql(c, f'type=page AND text~"{name}" AND text~"drawio" AND space!="{EXCLUDE}"'))

    # --- Strategy 6: Known architecture spaces ---
    # From PoC results, these spaces had architecture content
    arch_spaces = "GCET,SFI,GSCOF,CCM,AUTH,AIOPS,BSA,DCS,ITOM,GD,GLWM,SAPBasisDoc"
    space_filter = " OR ".join(f'space="{s}"' for s in arch_spaces.split(","))
    show("S6: title~name + known arch spaces",
         cql(c, f'type=page AND title~"{name}" AND ({space_filter})'))

    # --- Strategy 7: Label filter ---
    show("S7: text~name + label=architecture",
         cql(c, f'type=page AND text~"{name}" AND label="architecture" AND space!="{EXCLUDE}"'))

    show("S7b: text~name + label contains arch",
         cql(c, f'type=page AND text~"{name}" AND label~"arch" AND space!="{EXCLUDE}"'))

    # --- Strategy 8: Two-pass — pages with drawio in body (ac:structured-macro) ---
    show("S8: text~name + text~structured-macro",
         cql(c, f'type=page AND text~"{name}" AND text~"ac:structured-macro" AND space!="{EXCLUDE}"'))

    # --- Strategy 9: Combination — title match + recent + not personal ---
    show("S9: title~name + recent + global space",
         cql(c, f'type=page AND title~"{name}" AND space!="{EXCLUDE}" AND lastModified>="2024-04-01" AND space.type="global"'))

    # --- Bonus: Check page children for attachments (2-pass demo) ---
    # First get 3 title-match pages, then check each for drawio attachments
    print(f"\n  --- 2-pass demo: title pages → check drawio attachments ---")
    r = cql(c, f'type=page AND title~"{name}" AND space!="{EXCLUDE}" AND lastModified>="2024-04-01"', limit=5)
    pages_with_drawio = 0
    for p in r.get("results", []):
        pid = p["id"]
        att_r = c.get(f"/rest/api/content/{pid}/child/attachment",
                       params={"limit": 50, "expand": "metadata"})
        if att_r.status_code != 200:
            continue
        atts = att_r.json().get("results", [])
        drawio_atts = [a for a in atts if a.get("title", "").endswith(".drawio")]
        if drawio_atts:
            pages_with_drawio += 1
            sp = p.get("_expandable", {}).get("space", "").rsplit("/", 1)[-1] or "?"
            print(f"       [{sp:>8}] {p['title'][:55]:55s}  drawio: {len(drawio_atts)}")
    print(f"  → {pages_with_drawio}/{min(5, len(r.get('results',[])))} pages have drawio attachments")


def main():
    c = client()
    print(f"Confluence: {BASE_URL}")
    for app_id, name in TEST_APPS:
        test_app(c, app_id, name)
    print(f"\n{'='*70}\nDone.")


if __name__ == "__main__":
    main()
