"""Unit tests for backend/app/services/graph_client.py pure helpers.

No DB required — these exercise the Cypher RETURN-clause parser, the
agtype text decoder, and the graph-element flattener. Each of these is a
potential migration bug source (they translate between Neo4j and AGE
conventions), so we lock in their behaviour with focused tests.

Spec: .specify/features/age-migration/spec.md  §FR-CLT-2..FR-CLT-4
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Import by path so this runs whether or not the backend package is on PYTHONPATH
_BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(_BACKEND))

from app.services.graph_client import (  # noqa: E402
    _extract_return_columns,
    _flatten_graph_elements,
    _parse_agtype,
    _split_top_level_commas,
)

pytestmark = pytest.mark.age


# -----------------------------------------------------------------------------
# _extract_return_columns
# -----------------------------------------------------------------------------

class TestExtractReturnColumns:
    def test_simple_single_variable(self):
        assert _extract_return_columns("MATCH (a) RETURN a") == ["a"]

    def test_single_alias(self):
        assert _extract_return_columns("MATCH (a) RETURN a AS app") == ["app"]

    def test_multiple_aliases(self):
        cypher = "MATCH (a) RETURN a.app_id AS app_id, a.name AS name, count(*) AS c"
        assert _extract_return_columns(cypher) == ["app_id", "name", "c"]

    def test_property_without_alias(self):
        assert _extract_return_columns("MATCH (a) RETURN a.name") == ["name"]

    def test_mixed_aliased_and_not(self):
        cypher = "MATCH (a)-[r]->(b) RETURN a, r, b AS target"
        assert _extract_return_columns(cypher) == ["a", "r", "target"]

    def test_count_with_alias(self):
        assert _extract_return_columns("MATCH ()-[r]-() RETURN count(r) AS c") == ["c"]

    def test_limit_clause_truncated(self):
        cypher = "MATCH (a) RETURN a.name AS name LIMIT 10"
        assert _extract_return_columns(cypher) == ["name"]

    def test_order_by_clause_truncated(self):
        cypher = "MATCH (a) RETURN a.app_id AS id, a.name AS name ORDER BY a.name"
        assert _extract_return_columns(cypher) == ["id", "name"]

    def test_collect_expression(self):
        cypher = """
        MATCH (a)-[r]->(b)
        RETURN a, collect({target: b.id, type: r.type}) AS out_edges
        """
        assert _extract_return_columns(cypher) == ["a", "out_edges"]

    def test_nested_map_with_commas(self):
        """Commas inside { } must not split the expression."""
        cypher = "RETURN {k1: 1, k2: 2, k3: 3} AS m"
        assert _extract_return_columns(cypher) == ["m"]

    def test_list_comprehension_with_as(self):
        """The 'AS' at end of expression is the alias; inner commas don't count."""
        cypher = """
        RETURN [rel IN path | {source: rel.s, target: rel.t}] AS edges
        """
        assert _extract_return_columns(cypher) == ["edges"]

    def test_no_return_clause_returns_empty(self):
        assert _extract_return_columns("MATCH (n) DETACH DELETE n") == []

    def test_comment_handling(self):
        cypher = """
        MATCH (a) // this is a comment with RETURN inside
        RETURN a.app_id AS id
        """
        assert _extract_return_columns(cypher) == ["id"]


# -----------------------------------------------------------------------------
# _split_top_level_commas
# -----------------------------------------------------------------------------

class TestSplitTopLevelCommas:
    def test_simple(self):
        assert _split_top_level_commas("a, b, c") == ["a", " b", " c"]

    def test_parens(self):
        assert _split_top_level_commas("count(a, b), sum(c)") == ["count(a, b)", " sum(c)"]

    def test_braces(self):
        assert _split_top_level_commas("{k: 1, v: 2}, x") == ["{k: 1, v: 2}", " x"]

    def test_brackets(self):
        assert _split_top_level_commas("[1, 2, 3], y") == ["[1, 2, 3]", " y"]

    def test_nested(self):
        assert _split_top_level_commas("{a: [1, 2], b: (3, 4)}, z") == [
            "{a: [1, 2], b: (3, 4)}",
            " z",
        ]

    def test_string_with_comma(self):
        assert _split_top_level_commas("'hello, world', x") == ["'hello, world'", " x"]


# -----------------------------------------------------------------------------
# _parse_agtype
# -----------------------------------------------------------------------------

class TestParseAgtype:
    def test_none(self):
        assert _parse_agtype(None) is None

    def test_scalar_int(self):
        assert _parse_agtype("42") == 42

    def test_scalar_float(self):
        assert _parse_agtype("3.14") == 3.14

    def test_scalar_string(self):
        assert _parse_agtype('"hello"') == "hello"

    def test_scalar_bool(self):
        assert _parse_agtype("true") is True
        assert _parse_agtype("false") is False

    def test_list_of_ints(self):
        assert _parse_agtype("[1, 2, 3]") == [1, 2, 3]

    def test_plain_object(self):
        assert _parse_agtype('{"a": 1, "b": 2}') == {"a": 1, "b": 2}

    def test_vertex_flattened_to_properties(self):
        vertex = '{"id": 123, "label": "Application", "properties": {"app_id": "A000001", "name": "Foo"}}::vertex'
        result = _parse_agtype(vertex)
        assert result == {"app_id": "A000001", "name": "Foo"}

    def test_edge_flattened_to_properties(self):
        edge = (
            '{"id": 1, "label": "INVESTS_IN", "start_id": 10, "end_id": 20, '
            '"properties": {"fiscal_year": "FY2526"}}::edge'
        )
        assert _parse_agtype(edge) == {"fiscal_year": "FY2526"}

    def test_list_of_vertices_flattened(self):
        raw = (
            '[{"id": 1, "label": "App", "properties": {"k": "v1"}}::vertex, '
            '{"id": 2, "label": "App", "properties": {"k": "v2"}}::vertex]'
        )
        assert _parse_agtype(raw) == [{"k": "v1"}, {"k": "v2"}]


# -----------------------------------------------------------------------------
# _flatten_graph_elements
# -----------------------------------------------------------------------------

class TestFlattenGraphElements:
    def test_plain_dict_untouched(self):
        d = {"name": "Foo", "status": "Active"}
        assert _flatten_graph_elements(d) == d

    def test_vertex_becomes_properties(self):
        v = {"id": 1, "label": "Application", "properties": {"app_id": "A001"}}
        assert _flatten_graph_elements(v) == {"app_id": "A001"}

    def test_nested_map_with_vertex_value(self):
        d = {
            "app": {"id": 1, "label": "App", "properties": {"name": "Foo"}},
            "count": 5,
        }
        assert _flatten_graph_elements(d) == {"app": {"name": "Foo"}, "count": 5}

    def test_list_of_mixed_scalars(self):
        assert _flatten_graph_elements([1, "two", 3.0, True, None]) == [1, "two", 3.0, True, None]

    def test_empty_properties(self):
        v = {"id": 1, "label": "Application", "properties": {}}
        assert _flatten_graph_elements(v) == {}

    def test_null_properties(self):
        v = {"id": 1, "label": "Application", "properties": None}
        assert _flatten_graph_elements(v) == {}
