"""Sync neo4j-session-compatible adapter for Apache AGE (used by loaders).

The host-side loader (load_age_from_pg.py) was forked from load_neo4j_from_pg.py
with surgical changes — instead of `driver.session()`, it uses this adapter to
get an object with the same `.run(cypher, **kwargs)` surface but executing
against AGE (Postgres extension) via sync psycopg.

This keeps the 1500-line loader mostly identical between the Neo4j and AGE
variants. Once the migration cuts over (PR 3), the Neo4j loader is deleted
and only this AGE path remains.

Scope: only what the loaders need (psycopg sync, not asyncpg). For the
FastAPI backend's async path, see backend/app/services/graph_client.py.

Spec: .specify/features/age-migration/spec.md  §FR-LDR-1..FR-LDR-4
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

import psycopg

GRAPH_NAME = "ns_graph"


# ---------------------------------------------------------------------------
# RETURN-clause parser + agtype decoder — duplicated from graph_client.py
# because that module is async/asyncpg-only. We keep the two in sync by hand;
# the logic is small enough that duplication is cheaper than a shared lib.
# ---------------------------------------------------------------------------

_TAIL_RE = re.compile(r"\b(order\s+by|limit|skip|union)\b", re.IGNORECASE)
_AS_RE = re.compile(r"\bas\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", re.IGNORECASE)
_SIMPLE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_COMMENT_RE = re.compile(r"//[^\n]*")
_AGTYPE_SUFFIX_RE = re.compile(r"(?<=[\]}])::(?:vertex|edge|path)\b")
_IDENT_RE = re.compile(r"[^A-Za-z0-9_]")


def _extract_return_columns(cypher: str) -> list[str]:
    text = _COMMENT_RE.sub("", cypher)
    idx = _find_last_keyword(text, "return")
    if idx < 0:
        return []
    tail = text[idx + len("return"):]
    m = _TAIL_RE.search(tail)
    if m:
        tail = tail[: m.start()]
    parts = _split_top_level_commas(tail)
    columns: list[str] = []
    for i, part in enumerate(parts):
        expr = part.strip()
        if not expr:
            continue
        alias = _extract_alias(expr)
        if alias:
            columns.append(alias)
        elif _SIMPLE_IDENT_RE.match(expr):
            columns.append(expr)
        elif "." in expr and _SIMPLE_IDENT_RE.match(expr.split(".")[-1] or ""):
            columns.append(expr.split(".")[-1])
        else:
            columns.append(f"col{i}")
    return columns


def _find_last_keyword(text: str, keyword: str) -> int:
    lower = text.lower()
    i = len(text) - len(keyword)
    while i >= 0:
        idx = lower.rfind(keyword, 0, i + len(keyword) + 1)
        if idx < 0:
            return -1
        before_ok = idx == 0 or (
            not text[idx - 1].isalnum() and text[idx - 1] != "_"
        )
        after = idx + len(keyword)
        after_ok = after >= len(text) or (
            not text[after].isalnum() and text[after] != "_"
        )
        if before_ok and after_ok and not _is_inside_string(text, idx):
            return idx
        i = idx - 1
    return -1


def _is_inside_string(text: str, pos: int) -> bool:
    in_single = False
    in_double = False
    i = 0
    while i < pos:
        c = text[i]
        if c == "'" and not in_double:
            if i + 1 < len(text) and text[i + 1] == "'" and in_single:
                i += 2
                continue
            in_single = not in_single
        elif c == '"' and not in_single:
            in_double = not in_double
        elif c == "\\" and (in_single or in_double):
            i += 2
            continue
        i += 1
    return in_single or in_double


def _split_top_level_commas(text: str) -> list[str]:
    parts: list[str] = []
    depth = 0
    start = 0
    i = 0
    in_str: Optional[str] = None
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c in ("'", '"'):
            in_str = c
        elif c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    parts.append(text[start:])
    return parts


def _extract_alias(expr: str) -> Optional[str]:
    collapsed = _collapse_brackets(expr)
    m = _AS_RE.search(collapsed)
    return m.group(1) if m else None


def _collapse_brackets(expr: str) -> str:
    out = []
    depth = 0
    in_str: Optional[str] = None
    for c in expr:
        if in_str:
            out.append(c if depth == 0 else "X")
            if c == in_str:
                in_str = None
            continue
        if c in ("'", '"'):
            in_str = c
            out.append(c if depth == 0 else "X")
            continue
        if c in "([{":
            depth += 1
            out.append("X")
        elif c in ")]}":
            depth -= 1
            out.append("X")
        else:
            out.append("X" if depth > 0 else c)
    return "".join(out)


def _parse_agtype(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return _flatten_graph_elements(value)
    cleaned = _AGTYPE_SUFFIX_RE.sub("", value)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return cleaned
    return _flatten_graph_elements(parsed)


def _flatten_graph_elements(val: Any) -> Any:
    if isinstance(val, dict):
        keys = set(val.keys())
        if (
            "properties" in keys
            and "label" in keys
            and "id" in keys
            and keys <= {"id", "label", "properties", "start_id", "end_id"}
        ):
            return _flatten_graph_elements(val.get("properties") or {})
        return {k: _flatten_graph_elements(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_flatten_graph_elements(x) for x in val]
    return val


def _safe_ident(name: str) -> str:
    cleaned = _IDENT_RE.sub("_", name)
    return cleaned or "col"


def _unused_dollar_tag(text: str) -> str:
    for tag in ("ns", "nscy", "nsage", "nsq"):
        if f"${tag}$" not in text:
            return tag
    i = 0
    while True:
        tag = f"nsx{i}"
        if f"${tag}$" not in text:
            return tag
        i += 1


def _json_default(obj: Any) -> Any:
    return str(obj)


# ---------------------------------------------------------------------------
# Neo4j-compatible session adapter
# ---------------------------------------------------------------------------

class _Record(dict):
    """Dict subclass so the loader can do `row["key"]` — same as Neo4j Record."""

    def data(self) -> dict:
        return dict(self)


class _Result:
    """Iterable of _Record, mimics neo4j.Result."""

    def __init__(self, rows: list[_Record]):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)

    def single(self) -> Optional[_Record]:
        return self._rows[0] if self._rows else None

    def data(self) -> list[dict]:
        return [dict(r) for r in self._rows]


class AGESession:
    """Drop-in replacement for neo4j.Session, scoped to psycopg + AGE.

    The host-side loader uses `with driver.session() as ns: ns.run(...)`.
    This adapter provides `AGEDriver.session()` returning an AGESession that
    serves the same surface.

    Each `run()` call wraps the Cypher in AGE's SQL `cypher()` function,
    using the shared parser in this module to decide how many columns to
    declare in `AS (...)`.

    Transactions: the loader doesn't wrap writes in explicit transactions;
    it just calls `.run()` repeatedly. psycopg opens an implicit transaction
    that we commit on exit. For consistency with Neo4j's auto-commit-per-run
    semantics, we commit after each `.run()` call.
    """

    def __init__(self, conn: psycopg.Connection):
        self._conn = conn
        self._conn.autocommit = True  # auto-commit per run, like neo4j sessions
        with self._conn.cursor() as cur:
            cur.execute("LOAD 'age'")
            cur.execute('SET search_path = ag_catalog, "$user", public')

    def run(self, cypher: str, **kwargs: Any) -> _Result:
        """Execute Cypher; kwargs become the $param map inside the Cypher body."""
        columns = _extract_return_columns(cypher)

        # Write queries without RETURN — append a no-op RETURN so AGE's AS()
        # list has at least one column (syntactic requirement).
        if not columns:
            cypher = cypher.rstrip().rstrip(";") + "\nRETURN 0 AS _ignored"
            columns = ["_ignored"]

        col_decl = ", ".join(
            f'"{_safe_ident(c)}" ag_catalog.agtype' for c in columns
        )
        tag = _unused_dollar_tag(cypher)

        if kwargs:
            sql = (
                f"SELECT * FROM ag_catalog.cypher("
                f"'{GRAPH_NAME}', "
                f"${tag}${cypher}${tag}$, "
                f"%s::ag_catalog.agtype"
                f") AS ({col_decl})"
            )
            args: tuple = (json.dumps(kwargs, default=_json_default),)
        else:
            sql = (
                f"SELECT * FROM ag_catalog.cypher("
                f"'{GRAPH_NAME}', "
                f"${tag}${cypher}${tag}$"
                f") AS ({col_decl})"
            )
            args = ()

        with self._conn.cursor() as cur:
            cur.execute(sql, args)
            raw_rows = cur.fetchall() if cur.description else []
            col_names = [d.name for d in cur.description] if cur.description else []

        records: list[_Record] = []
        for raw in raw_rows:
            rec = _Record()
            for name, val in zip(col_names, raw):
                rec[name] = _parse_agtype(val)
            # Also key by the original RETURN alias (column names in SQL are
            # sanitized; if we mangled, add the original too).
            for original, sanitised in zip(columns, col_names):
                if original != sanitised and original in columns:
                    rec[original] = rec.get(sanitised)
            records.append(rec)
        return _Result(records)

    def close(self) -> None:
        pass  # connection lifetime is owned by AGEDriver

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.close()


class AGEDriver:
    """Drop-in for neo4j.GraphDatabase.driver + driver object."""

    def __init__(self, dsn: str):
        self._dsn = dsn
        self._conn = psycopg.connect(dsn)

    def session(self) -> AGESession:
        return AGESession(self._conn)

    def verify_connectivity(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()


def connect(dsn: str) -> AGEDriver:
    """Factory mirroring neo4j.GraphDatabase.driver(uri, auth=...)."""
    return AGEDriver(dsn)


def ensure_schema(driver: AGEDriver) -> None:
    """Idempotent: create vertex/edge labels + property indexes.

    Mirrors backend/app/services/graph_client.ensure_schema for sync callers.
    """
    # All node + edge labels the loader writes. Pre-registering them here
    # (before any MERGE fires) means AGE doesn't have to auto-create them
    # during the loader run, AND we can build property indexes upfront.
    # Without upfront property indexes every MERGE goes full-table scan
    # — that's what caused the 1hr loader run on 2026-04-17 (Server grew
    # to 34k rows with each MERGE doing an O(n) lookup).
    node_labels = (
        # Core app/project entities
        "Application", "Project", "Diagram", "ConfluencePage",
        # Deployment infrastructure (Application -[:DEPLOYED_ON]-> x)
        "Server", "Container", "Database", "ObjectStorage", "NAS",
        # Organisation (Application -[:OWNED_BY]-> x)
        "Team", "Person",
    )
    edge_types = (
        "INVESTS_IN",
        "INTEGRATES_WITH",
        "HAS_DIAGRAM",
        "DESCRIBED_BY",
        "HAS_CONFLUENCE_PAGE",
        "HAS_REVIEW_PAGE",
        "DEPLOYED_ON",
        "OWNED_BY",
    )
    # Uniqueness indexes — hit by MERGE lookup patterns
    # `MERGE (x:Label {key: $val})`.
    unique_idx = (
        ("app_id_uniq", "Application", "app_id"),
        ("project_id_uniq", "Project", "project_id"),
        ("diagram_id_uniq", "Diagram", "diagram_id"),
        ("page_id_uniq", "ConfluencePage", "page_id"),
        # Deployment infra — all MERGEd by `name` in load_age_from_pg.
        ("server_name_uniq", "Server", "name"),
        ("container_name_uniq", "Container", "name"),
        ("database_name_uniq", "Database", "name"),
        ("oss_name_uniq", "ObjectStorage", "name"),
        ("nas_name_uniq", "NAS", "name"),
        # Org — MERGEd by itcode (person) / name (team).
        ("team_name_uniq", "Team", "name"),
        ("person_itcode_uniq", "Person", "itcode"),
    )
    # Non-unique filter indexes — hit by WHERE clauses in router queries.
    filter_idx = (
        ("app_status_idx", "Application", "status"),
        ("app_cmdb_linked_idx", "Application", "cmdb_linked"),
        ("project_fy_idx", "Project", "fiscal_year"),
        ("diagram_type_idx", "Diagram", "diagram_type"),
        ("invests_in_fy_idx", "INVESTS_IN", "fiscal_year"),
    )

    # Use autocommit so one failed create_vlabel (already exists) doesn't
    # poison subsequent DDL in the same transaction. Each label's creation
    # is independent and idempotent via our duplicate-catch.
    # psycopg refuses to flip autocommit mid-transaction, so commit any
    # pending implicit transaction (e.g. from verify_connectivity's SELECT 1)
    # before switching.
    driver._conn.commit()
    driver._conn.autocommit = True
    with driver._conn.cursor() as cur:
        cur.execute("LOAD 'age'")
        # ag_catalog must be in search_path for the agtype `->` operator
        # used in the expression indexes below.
        cur.execute('SET search_path = ag_catalog, "$user", public')
        for label in node_labels:
            try:
                # Schema-qualify — search_path manipulation is fragile
                # across psycopg transaction boundaries.
                cur.execute(f"SELECT ag_catalog.create_vlabel('{GRAPH_NAME}', '{label}')")
            except psycopg.errors.DuplicateTable:
                pass
            except Exception as exc:
                if "already exists" not in str(exc).lower():
                    raise
        for etype in edge_types:
            try:
                cur.execute(f"SELECT ag_catalog.create_elabel('{GRAPH_NAME}', '{etype}')")
            except psycopg.errors.DuplicateTable:
                pass
            except Exception as exc:
                if "already exists" not in str(exc).lower():
                    raise
        for idx_name, label, prop in unique_idx:
            cur.execute(
                f'CREATE UNIQUE INDEX IF NOT EXISTS {idx_name} '
                f'ON {GRAPH_NAME}."{label}" (((properties -> \'"{prop}"\'::ag_catalog.agtype)::text))'
            )
        for idx_name, label, prop in filter_idx:
            cur.execute(
                f'CREATE INDEX IF NOT EXISTS {idx_name} '
                f'ON {GRAPH_NAME}."{label}" (((properties -> \'"{prop}"\'::ag_catalog.agtype)::text))'
            )
