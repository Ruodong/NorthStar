"""Unit tests for backend/app/services/image_vision.py pure functions."""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.services.image_vision import (
    _strip_code_fence,
    _parse_llm_json,
    _validate_and_normalize,
    VisionExtractError,
    VisionExtractResult,
)


# ---------------------------------------------------------------------------
# _strip_code_fence
# ---------------------------------------------------------------------------

class TestStripCodeFence:
    def test_json_fence(self):
        text = '```json\n{"key": "value"}\n```'
        assert _strip_code_fence(text) == '{"key": "value"}'

    def test_plain_fence(self):
        text = '```\n{"key": "value"}\n```'
        assert _strip_code_fence(text) == '{"key": "value"}'

    def test_no_fence(self):
        text = '{"key": "value"}'
        assert _strip_code_fence(text) == '{"key": "value"}'

    def test_empty(self):
        assert _strip_code_fence("") == ""


# ---------------------------------------------------------------------------
# _parse_llm_json
# ---------------------------------------------------------------------------

class TestParseLlmJson:
    def test_valid_json(self):
        result = _parse_llm_json('{"diagram_type": "app_arch", "applications": []}')
        assert result["diagram_type"] == "app_arch"

    def test_with_code_fence(self):
        result = _parse_llm_json('```json\n{"diagram_type": "tech_arch"}\n```')
        assert result["diagram_type"] == "tech_arch"

    def test_invalid_json(self):
        with pytest.raises(VisionExtractError) as exc_info:
            _parse_llm_json("this is not json")
        assert "malformed_llm_output" in str(exc_info.value)

    def test_not_a_dict(self):
        with pytest.raises(VisionExtractError):
            _parse_llm_json("[1, 2, 3]")


# ---------------------------------------------------------------------------
# _validate_and_normalize
# ---------------------------------------------------------------------------

class TestValidateAndNormalize:
    def test_empty_input(self):
        result = _validate_and_normalize({})
        assert isinstance(result, VisionExtractResult)
        assert result.diagram_type == "unknown"
        assert result.applications == []
        assert result.interactions == []

    def test_full_input(self):
        parsed = {
            "diagram_type": "app_arch",
            "applications": [
                {
                    "app_id": "A000575",
                    "id_is_standard": True,
                    "standard_id": "A000575",
                    "name": "Polaris",
                    "functions": ["CRM"],
                    "application_status": "Change",
                }
            ],
            "interactions": [
                {
                    "source_app_id": "A000575",
                    "target_app_id": "A004159",
                    "interaction_type": "Command",
                    "direction": "one_way",
                    "business_object": "JSON",
                    "interface_status": "Change",
                }
            ],
        }
        result = _validate_and_normalize(parsed)
        assert result.diagram_type == "app_arch"
        assert len(result.applications) == 1
        assert result.applications[0]["name"] == "Polaris"
        assert result.applications[0]["source"] == "vision"
        assert len(result.interactions) == 1
        assert result.interactions[0]["source_app_id"] == "A000575"

    def test_missing_fields_default(self):
        parsed = {
            "applications": [{"name": "TestApp"}],
        }
        result = _validate_and_normalize(parsed)
        app = result.applications[0]
        assert app["app_id"] == "TestApp"  # falls back to name
        assert app["standard_id"] == ""
        assert app["application_status"] == ""

    def test_tech_components(self):
        parsed = {
            "diagram_type": "tech_arch",
            "tech_components": [
                {"name": "nginx", "component_type": "web_server"}
            ],
        }
        result = _validate_and_normalize(parsed)
        assert len(result.tech_components) == 1
        assert result.tech_components[0]["name"] == "nginx"
