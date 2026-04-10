"""AI quality evaluation — assesses extracted architecture data for completeness and consistency.

Reuses only the LLM calling pattern from EGM: JSON-forced output, temperature 0.3, error handling.
Falls back to rule-based scoring when LLM is disabled or unavailable.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """You are an IT architecture quality reviewer. Evaluate the extracted data from a draw.io architecture diagram on 3 dimensions: completeness, consistency, overall quality.

Output STRICT JSON only, matching this shape:
{
  "completeness": { "score": <0-100>, "findings": [ {"severity": "info|warn|error", "message": "..."} ] },
  "consistency":  { "score": <0-100>, "findings": [ ... ] },
  "overall_score": <0-100>
}

Do not wrap in markdown. Do not add commentary."""


def _llm_json_call(user_payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not (settings.llm_enabled and settings.llm_base_url and settings.llm_api_key):
        return None
    url = settings.llm_base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.llm_model,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
    }
    try:
        resp = httpx.post(url, headers=headers, json=body, timeout=60.0)
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as exc:  # noqa: BLE001
        logger.warning("LLM evaluation call failed: %s", exc)
        return None


def _rule_based_score(applications: list[dict], interactions: list[dict]) -> dict[str, Any]:
    """Fallback rule-based scoring using simple heuristics."""
    findings: list[dict[str, str]] = []
    completeness = 100.0
    consistency = 100.0

    if not applications:
        findings.append({"severity": "error", "message": "No applications extracted"})
        return {
            "completeness": {"score": 0, "findings": findings},
            "consistency": {"score": 0, "findings": []},
            "overall_score": 0.0,
        }

    missing_id = sum(1 for a in applications if not a.get("id_is_standard"))
    if missing_id:
        completeness -= min(40, (missing_id / len(applications)) * 80)
        findings.append({"severity": "warn", "message": f"{missing_id}/{len(applications)} applications missing standard ID"})

    unlabeled_edges = sum(1 for i in interactions if not i.get("interaction_type"))
    if interactions:
        completeness -= min(30, (unlabeled_edges / len(interactions)) * 60)
        if unlabeled_edges:
            findings.append({"severity": "warn", "message": f"{unlabeled_edges}/{len(interactions)} interactions missing type"})

    app_ids = {a.get("cell_id") for a in applications}
    orphans = [
        a for a in applications
        if not any(i.get("source_id") == a.get("cell_id") or i.get("target_id") == a.get("cell_id") for i in interactions)
    ]
    if orphans and len(applications) > 1:
        ratio = len(orphans) / len(applications)
        completeness -= min(20, ratio * 40)
        findings.append({"severity": "info", "message": f"{len(orphans)} orphan applications (no connections)"})

    # Consistency: check same app_name with different statuses
    name_to_status: dict[str, set[str]] = {}
    for a in applications:
        name = a.get("app_name") or ""
        status = a.get("application_status") or ""
        if name:
            name_to_status.setdefault(name, set()).add(status)
    conflicts = [n for n, s in name_to_status.items() if len(s) > 1]
    if conflicts:
        consistency -= min(50, len(conflicts) * 10)
        findings.append({"severity": "warn", "message": f"{len(conflicts)} apps with conflicting statuses"})

    completeness = max(0, round(completeness, 1))
    consistency = max(0, round(consistency, 1))
    overall = round((completeness * 0.6 + consistency * 0.4), 1)
    return {
        "completeness": {"score": completeness, "findings": findings},
        "consistency": {"score": consistency, "findings": []},
        "overall_score": overall,
    }


def evaluate(applications: list[dict], interactions: list[dict]) -> dict[str, Any]:
    """Evaluate extracted architecture data; tries LLM first, then rule-based fallback."""
    # Build compact payload for LLM
    payload = {
        "applications": [
            {
                "name": a.get("app_name"),
                "standard_id": a.get("standard_id"),
                "status": a.get("application_status"),
            }
            for a in applications[:200]
        ],
        "interactions": [
            {
                "source": i.get("source_app"),
                "target": i.get("target_app"),
                "type": i.get("interaction_type"),
                "business_object": i.get("business_object"),
            }
            for i in interactions[:300]
        ],
    }
    llm_result = _llm_json_call(payload)
    if llm_result and "overall_score" in llm_result:
        return llm_result
    return _rule_based_score(applications, interactions)
