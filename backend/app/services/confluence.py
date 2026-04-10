"""Confluence REST API client + local-file fallback.

Minimal client that supports:
  - Listing pages under a space
  - Downloading .drawio attachments
  - Local fallback: load .drawio files from a directory structure:
      LOCAL_DRAWIO_ROOT/
        <fiscal_year>/
          <project_id>__<project_name>/
            App_Arch.drawio
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ProjectPage:
    project_id: str
    name: str
    fiscal_year: str
    pm: str = ""
    it_lead: str = ""
    dt_lead: str = ""
    review_status: str = ""
    drawio_xml: str = ""


def _retry_get(url: str, headers: dict, params: Optional[dict] = None, max_retries: int = 3) -> httpx.Response:
    last: Optional[Exception] = None
    for i in range(max_retries):
        try:
            resp = httpx.get(url, headers=headers, params=params, timeout=30.0, follow_redirects=True)
            if resp.status_code in (429, 500, 502, 503, 504):
                raise httpx.HTTPStatusError("retriable", request=resp.request, response=resp)
            resp.raise_for_status()
            return resp
        except Exception as exc:  # noqa: BLE001
            last = exc
            wait = 1 << i  # 1s, 2s, 4s
            logger.warning("Confluence GET failed (attempt %d): %s — retrying in %ds", i + 1, exc, wait)
            import time
            time.sleep(wait)
    assert last is not None
    raise last


def _slugify(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s)[:80]


class ConfluenceClient:
    def __init__(self) -> None:
        self.base = settings.confluence_base_url.rstrip("/")
        self.token = settings.confluence_token
        self.space = settings.confluence_space_key

    @property
    def configured(self) -> bool:
        return bool(self.base and self.token)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }

    def list_project_pages(self, fiscal_year: str) -> list[ProjectPage]:
        """List all project pages under a fiscal-year parent. MVP uses a simple CQL search."""
        if not self.configured:
            return []
        cql = f'space = "{self.space}" AND title ~ "{fiscal_year}"'
        url = f"{self.base}/rest/api/content/search"
        params = {"cql": cql, "limit": 200, "expand": "metadata,space"}
        try:
            resp = _retry_get(url, self._headers(), params)
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.error("Confluence list_project_pages failed: %s", exc)
            return []
        pages: list[ProjectPage] = []
        for result in data.get("results", []):
            title = result.get("title", "")
            match = re.search(r"(LI\d{6,})", title)
            project_id = match.group(1) if match else _slugify(title)
            pages.append(
                ProjectPage(
                    project_id=project_id,
                    name=title,
                    fiscal_year=fiscal_year,
                )
            )
        return pages


def load_local_projects(fiscal_year: str) -> list[ProjectPage]:
    """Load projects from local filesystem layout for dev/offline mode."""
    root = Path(settings.local_drawio_root)
    if not root.exists():
        return []
    fy_dir = root / fiscal_year
    if not fy_dir.exists():
        return []
    projects: list[ProjectPage] = []
    for proj_dir in sorted(fy_dir.iterdir()):
        if not proj_dir.is_dir():
            continue
        name = proj_dir.name
        parts = name.split("__", 1)
        project_id = parts[0]
        project_name = parts[1] if len(parts) > 1 else name
        drawio_files = list(proj_dir.glob("*.drawio")) + list(proj_dir.glob("*App*.xml"))
        if not drawio_files:
            continue
        xml = drawio_files[0].read_text(encoding="utf-8", errors="ignore")
        projects.append(
            ProjectPage(
                project_id=project_id,
                name=project_name,
                fiscal_year=fiscal_year,
                drawio_xml=xml,
            )
        )
    logger.info("Loaded %d local projects for %s", len(projects), fiscal_year)
    return projects


async def fetch_projects(fiscal_year: str) -> list[ProjectPage]:
    """Primary entry: returns projects for a fiscal year, using Confluence or local fallback."""
    client = ConfluenceClient()
    if client.configured:
        logger.info("Fetching Confluence projects for %s", fiscal_year)
        return await asyncio.to_thread(client.list_project_pages, fiscal_year)
    return await asyncio.to_thread(load_local_projects, fiscal_year)
