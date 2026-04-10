#!/usr/bin/env python3
"""Resolve free-text PM / IT Lead / DT Lead values in confluence_page to itcodes.

Confluence authors filled owner fields with a mix of formats:
  - itcode:          'liujr2', 'wangsy84'
  - email:           'chenxz8@lenovo.com'
  - english name:    'Jenna Zhai', 'Helen Chen'
  - name + itcode:   'Annie ZY64 Wang(wangzy64)'
  - multi-person:    'gaochen7, sunhong3' / 'Helen Chen (PM)/ Wayne Zhou (PA)'
  - template text:   'IT Code', 'IT Code, optional', 'N/A'

This script resolves each value to a canonical itcode (first match when
multi-person) and writes the resolved itcode + the employee's display name
back to confluence_page columns:
  q_pm / q_pm_itcode / q_pm_name   (same for q_it_lead and q_dt_lead)

Uses a cascade:
  1. exact itcode match (lowercased alphanum only)
  2. email prefix extraction before '@'
  3. '(itcode)' inside parens
  4. first token after splitting on [,;/、，；]
  5. exact name match in ref_employee.name (case-insensitive, substring)
  6. pg_trgm similarity > 0.5 on ref_employee.name

Usage:
    set -a && source .env && set +a
    .venv-ingest/bin/python scripts/resolve_owners.py [--dry-run] [--limit N]
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from typing import Optional

import psycopg
from psycopg.rows import dict_row

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("resolve-owners")

PLACEHOLDER_VALUES = {
    "it code",
    "it code, optional",
    "n/a",
    "na",
    "none",
    "tbd",
    "todo",
    "to be decided",
    "to be defined",
    "",
}

SPLIT_RE = re.compile(r"[,;/、，；]+")
PAREN_RE = re.compile(r"\(([a-zA-Z0-9_]{2,15})\)")
EMAIL_RE = re.compile(r"([a-zA-Z0-9_]+)@[a-zA-Z0-9.\-]+")
ITCODE_RE = re.compile(r"^[a-zA-Z0-9_]{2,15}$")
ROLE_TRAILER_RE = re.compile(r"\s*\((PM|PA|IT|DT|Owner|Lead|Backup)[^)]*\)\s*", re.IGNORECASE)


def pg_dsn() -> str:
    return (
        f"host={os.environ.get('NORTHSTAR_PG_HOST', 'localhost')} "
        f"port={os.environ.get('NORTHSTAR_PG_PORT', '5434')} "
        f"dbname={os.environ.get('NORTHSTAR_PG_DB', 'northstar')} "
        f"user={os.environ.get('NORTHSTAR_PG_USER', 'northstar')} "
        f"password={os.environ.get('POSTGRES_PASSWORD', 'northstar_dev')}"
    )


class Resolver:
    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        # Preload ref_employee into memory for fast lookups.
        # Two indexes:
        #   by_itcode:   exact itcode → display name
        #   by_name_lc:  lowercase name substring → itcode
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute("SELECT itcode, name FROM northstar.ref_employee WHERE itcode IS NOT NULL")
            rows = cur.fetchall()
        self.by_itcode: dict[str, str] = {
            r["itcode"].lower(): r["name"] or "" for r in rows
        }
        # Extract "first last" and "chinese" tokens for name-based matching.
        # ref_employee.name format: "First [Middle] Last [| 中文]"
        self.name_to_itcode: dict[str, str] = {}
        for r in rows:
            name = (r["name"] or "").strip()
            if not name:
                continue
            itcode = r["itcode"].lower()
            # index whole lowercased name
            self.name_to_itcode.setdefault(name.lower(), itcode)
            # Also index the English part before '|' if any
            if "|" in name:
                eng = name.split("|", 1)[0].strip().lower()
                self.name_to_itcode.setdefault(eng, itcode)
                cn = name.split("|", 1)[1].strip()
                if cn:
                    self.name_to_itcode.setdefault(cn.lower(), itcode)
        logger.info(
            "loaded ref_employee: %d itcodes, %d searchable name keys",
            len(self.by_itcode),
            len(self.name_to_itcode),
        )

    def _trgm_find(self, query: str, threshold: float = 0.5) -> Optional[str]:
        """pg_trgm similarity search against ref_employee.name. Returns itcode or None."""
        q = query.strip().lower()
        if not q or len(q) < 3:
            return None
        with self.conn.cursor() as cur:
            cur.execute(
                """
                SELECT itcode, name, similarity(lower(name), %s) AS sim
                FROM northstar.ref_employee
                WHERE lower(name) %% %s
                ORDER BY sim DESC
                LIMIT 1
                """,
                (q, q),
            )
            row = cur.fetchone()
            if row and row[2] >= threshold:
                return row[0]
        return None

    def resolve_one(self, raw: str) -> tuple[Optional[str], Optional[str]]:
        """Return (itcode, canonical_name) for a single person token, or (None, None)."""
        if not raw:
            return None, None

        # Strip role trailer like "(PM)" "(Backup)"
        v = ROLE_TRAILER_RE.sub("", raw).strip()
        if not v:
            return None, None
        vlower = v.lower()

        # placeholder / template text
        if vlower in PLACEHOLDER_VALUES:
            return None, None

        # 1. exact itcode (alphanumeric-only)
        if ITCODE_RE.match(v) and vlower in self.by_itcode:
            return vlower, self.by_itcode[vlower]

        # 2. email → extract prefix
        m = EMAIL_RE.search(v)
        if m:
            code = m.group(1).lower()
            if code in self.by_itcode:
                return code, self.by_itcode[code]

        # 3. parenthesized itcode like 'Annie ZY64 Wang(wangzy64)'
        m = PAREN_RE.search(v)
        if m:
            code = m.group(1).lower()
            if code in self.by_itcode:
                return code, self.by_itcode[code]
            # fall through to name match on the non-paren prefix
            v_noparen = PAREN_RE.sub("", v).strip()
            if v_noparen:
                return self.resolve_one(v_noparen)

        # 4. multi-person split → take the first
        if SPLIT_RE.search(v):
            first = SPLIT_RE.split(v, maxsplit=1)[0].strip()
            if first and first != v:
                return self.resolve_one(first)

        # 5. exact name match in our index
        if vlower in self.name_to_itcode:
            code = self.name_to_itcode[vlower]
            return code, self.by_itcode.get(code, v)

        # 6. fuzzy trigram search
        code = self._trgm_find(v)
        if code:
            return code, self.by_itcode.get(code, v)

        return None, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Print what would change but don't write")
    ap.add_argument("--limit", type=int, default=None, help="Limit pages processed (for testing)")
    args = ap.parse_args()

    conn = psycopg.connect(pg_dsn())
    conn.autocommit = False
    resolver = Resolver(conn)

    with conn.cursor(row_factory=dict_row) as cur:
        sql = """
        SELECT page_id, q_pm, q_it_lead, q_dt_lead
        FROM northstar.confluence_page
        WHERE q_pm IS NOT NULL OR q_it_lead IS NOT NULL OR q_dt_lead IS NOT NULL
        """
        if args.limit:
            sql += f" LIMIT {int(args.limit)}"
        cur.execute(sql)
        pages = cur.fetchall()

    logger.info("resolving %d pages", len(pages))

    stats = {
        "pages": 0,
        "pm_resolved": 0, "pm_total": 0,
        "it_resolved": 0, "it_total": 0,
        "dt_resolved": 0, "dt_total": 0,
    }

    with conn.cursor() as cur:
        for p in pages:
            updates = {}
            for field, col_itcode, col_name in (
                ("q_pm", "q_pm_itcode", "q_pm_name"),
                ("q_it_lead", "q_it_lead_itcode", "q_it_lead_name"),
                ("q_dt_lead", "q_dt_lead_itcode", "q_dt_lead_name"),
            ):
                raw = p.get(field)
                if not raw:
                    continue
                key = field.replace("q_", "").replace("_lead", "")
                stats[f"{key}_total"] += 1
                itcode, name = resolver.resolve_one(raw)
                if itcode:
                    updates[col_itcode] = itcode
                    updates[col_name] = name
                    stats[f"{key}_resolved"] += 1

            if updates and not args.dry_run:
                set_clause = ", ".join(f"{k} = %s" for k in updates)
                cur.execute(
                    f"UPDATE northstar.confluence_page SET {set_clause} WHERE page_id = %s",
                    (*updates.values(), p["page_id"]),
                )
                stats["pages"] += 1

    if not args.dry_run:
        conn.commit()
    conn.close()

    logger.info("DONE")
    for k, v in stats.items():
        logger.info("  %-20s %d", k, v)
    for role in ("pm", "it", "dt"):
        total = stats[f"{role}_total"]
        resolved = stats[f"{role}_resolved"]
        pct = 100 * resolved / total if total else 0
        logger.info("  %s coverage: %d/%d (%.1f%%)", role.upper(), resolved, total, pct)
    return 0


if __name__ == "__main__":
    sys.exit(main())
