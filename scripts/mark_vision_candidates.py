#!/usr/bin/env python3
"""Phase 0 of image-vision-extract: identify PNG/JPEG attachments that
are NOT derivable from a same-page drawio, and flag them as vision
extraction candidates.

Run on the host under .venv-ingest:

    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/mark_vision_candidates.py

Idempotent — running twice reports 0 newly marked rows on the
second invocation. Writes only to `confluence_attachment`:

    derived_source         = 'drawio'      (if stem matches a same-page drawio)
    derived_source_att     = <drawio_id>   (backref)
    vision_candidate       = TRUE          (for remaining real PNG/JPEG)

Spec: .specify/features/image-vision-extract/spec.md  (FR-1..FR-5)
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
logger = logging.getLogger("mark-vision-candidates")


# Suffixes we strip off the filename to compute a stem for matching.
# Case-insensitive. ORDER MATTERS: longer suffixes (".drawio.xml")
# must be tried before shorter ones (".xml") so we don't end up
# comparing "foo.drawio" vs "foo".
_IMAGE_SUFFIXES = [".png", ".jpeg", ".jpg", ".webp", ".gif", ".svg"]
_DRAWIO_SUFFIXES = [".drawio.xml", ".drawio", ".xml"]


def _strip_suffix(name: str, suffixes: list[str]) -> str:
    """Lowercase, normalise whitespace, strip any known suffix."""
    s = (name or "").strip().lower()
    for suf in suffixes:
        if s.endswith(suf):
            return s[: -len(suf)]
    return s


_WS_RE = re.compile(r"\s+")


def _stem_for_match(name: str, kind: str) -> str:
    """Produce a comparable stem for image vs drawio titles.

    Collapses internal whitespace so "ADM TECH架构" matches
    "ADM  TECH架构.drawio"; lowercases so "Solution Design.pptx"
    matches "solution design.pptx". Does NOT strip punctuation —
    Lenovo titles frequently have "-", "_", "—" as semantic
    separators and collapsing them would cause false merges.
    """
    raw = _WS_RE.sub(" ", (name or "").strip())
    if kind == "image":
        return _strip_suffix(raw, _IMAGE_SUFFIXES)
    return _strip_suffix(raw, _DRAWIO_SUFFIXES)


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


def mark_drawio_derived(conn: psycopg.Connection) -> tuple[int, int]:
    """Set derived_source='drawio' on every PNG/JPEG whose filename
    stem matches a drawio attachment on the same page.

    Returns (scanned, newly_marked).
    """
    # Pull candidates into Python so we can do case-insensitive +
    # whitespace-collapsing stem matching that pg_trgm alone can't
    # express cleanly. The scale is ~4k PNG rows, negligible.
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT attachment_id, page_id, title, file_kind, derived_source
            FROM northstar.confluence_attachment
            WHERE file_kind IN ('image', 'drawio')
              AND title NOT LIKE 'drawio-backup%%'
              AND title NOT LIKE '~%%'
              AND title IS NOT NULL
            """
        )
        rows = cur.fetchall()

    # Build per-page index: stem → drawio attachment_id (first wins,
    # same page rarely has two drawios with identical stems).
    drawios_by_page: dict[str, dict[str, str]] = {}
    for r in rows:
        if r["file_kind"] != "drawio":
            continue
        page_id = r["page_id"]
        stem = _stem_for_match(r["title"], "drawio")
        if not stem:
            continue
        drawios_by_page.setdefault(page_id, {}).setdefault(stem, r["attachment_id"])

    pending_updates: list[tuple[str, str, str]] = []  # (derived_att_id, image_att_id, image_stem)
    scanned = 0
    for r in rows:
        if r["file_kind"] != "image":
            continue
        scanned += 1
        if r["derived_source"] == "drawio":
            # Already marked — skip so the "newly_marked" count is
            # accurate on re-runs (FR-5 idempotency).
            continue
        page_drawios = drawios_by_page.get(r["page_id"]) or {}
        if not page_drawios:
            continue
        stem = _stem_for_match(r["title"], "image")
        if not stem:
            continue
        drawio_att = page_drawios.get(stem)
        if drawio_att:
            pending_updates.append((drawio_att, r["attachment_id"], stem))

    if not pending_updates:
        return scanned, 0

    with conn.cursor() as cur:
        cur.executemany(
            """
            UPDATE northstar.confluence_attachment
               SET derived_source     = 'drawio',
                   derived_source_att = %s
             WHERE attachment_id = %s
            """,
            [(src, img) for src, img, _stem in pending_updates],
        )
    conn.commit()

    logger.info("marked %d PNG/JPEG rows as drawio-derived", len(pending_updates))
    for src, img, stem in pending_updates[:10]:
        logger.info("  %s → %s   (stem=%r)", img, src, stem)
    if len(pending_updates) > 10:
        logger.info("  ... and %d more", len(pending_updates) - 10)

    return scanned, len(pending_updates)


def mark_vision_candidates(conn: psycopg.Connection) -> tuple[int, int]:
    """Set vision_candidate=TRUE on every PNG/JPEG that (a) is not
    derived from a drawio on the same page, (b) has a local file,
    (c) belongs to an FY2425 or FY2526 page.

    Returns (eligible, newly_marked). Eligible counts all rows that
    match the filter even if they were already marked on a prior
    run; newly_marked is the count that transitioned FALSE→TRUE
    this invocation.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)                                 AS eligible,
                   COUNT(*) FILTER (WHERE NOT ca.vision_candidate) AS to_mark
            FROM northstar.confluence_attachment ca
            JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
            WHERE ca.file_kind = 'image'
              AND ca.media_type IN ('image/png', 'image/jpeg')
              AND ca.local_path IS NOT NULL
              AND ca.derived_source IS NULL
              AND cp.fiscal_year IN ('FY2425', 'FY2526')
              AND ca.title NOT LIKE 'drawio-backup%%'
              AND ca.title NOT LIKE '~%%'
            """
        )
        counts = cur.fetchone()
        eligible = counts[0]
        to_mark = counts[1]

        if to_mark > 0:
            cur.execute(
                """
                UPDATE northstar.confluence_attachment ca
                   SET vision_candidate = TRUE
                  FROM northstar.confluence_page cp
                 WHERE cp.page_id = ca.page_id
                   AND ca.file_kind = 'image'
                   AND ca.media_type IN ('image/png', 'image/jpeg')
                   AND ca.local_path IS NOT NULL
                   AND ca.derived_source IS NULL
                   AND cp.fiscal_year IN ('FY2425', 'FY2526')
                   AND ca.title NOT LIKE 'drawio-backup%%'
                   AND ca.title NOT LIKE '~%%'
                   AND NOT ca.vision_candidate
                """
            )
    conn.commit()
    return eligible, to_mark


def print_summary(conn: psycopg.Connection) -> None:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT
              COUNT(*) FILTER (WHERE ca.file_kind = 'image'
                               AND ca.media_type IN ('image/png', 'image/jpeg')
                               AND ca.title NOT LIKE 'drawio-backup%%'
                               AND ca.title NOT LIKE '~%%')                 AS total_png_jpeg,
              COUNT(*) FILTER (WHERE ca.derived_source = 'drawio')           AS drawio_derived,
              COUNT(*) FILTER (WHERE ca.vision_candidate)                    AS candidates
            FROM northstar.confluence_attachment ca
            """
        )
        t = cur.fetchone()

        cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM northstar.confluence_attachment ca
            JOIN northstar.confluence_page cp ON cp.page_id = ca.page_id
            WHERE ca.vision_candidate
              AND (cp.title ILIKE '%architecture%' OR cp.title ILIKE '%架构%')
            """
        )
        arch_candidates = cur.fetchone()["n"]

    logger.info("=" * 60)
    logger.info("SUMMARY")
    logger.info("  total png+jpeg (excl. backups): %d", t["total_png_jpeg"])
    logger.info("  drawio-derived                 : %d", t["drawio_derived"])
    logger.info("  vision_candidate = TRUE        : %d", t["candidates"])
    logger.info("  ...on architecture-titled pages: %d", arch_candidates)
    logger.info("=" * 60)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="Print what would be marked, do not write.")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn())
    conn.autocommit = False
    try:
        if args.dry_run:
            logger.warning("DRY RUN — no rows will be updated")
            # Still run the detection and print counts, but roll back
            scanned, would_mark_derived = mark_drawio_derived(conn)
            logger.info("would mark derived: %d of %d scanned", would_mark_derived, scanned)
            conn.rollback()
            eligible, would_mark_cand = mark_vision_candidates(conn)
            logger.info("would mark candidates: %d of %d eligible", would_mark_cand, eligible)
            conn.rollback()
            return 0

        scanned, newly_derived = mark_drawio_derived(conn)
        eligible, newly_cand = mark_vision_candidates(conn)

        logger.info(
            "derived pass:    scanned=%d newly_marked=%d",
            scanned, newly_derived,
        )
        logger.info(
            "candidate pass:  eligible=%d newly_marked=%d",
            eligible, newly_cand,
        )
        print_summary(conn)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
