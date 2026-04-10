"""Confluence REST API client + local-file fallback.

Confluence structure (Lenovo km.xpaas.lenovo.com, space ARD):
    Architecture Review (root)
      └── FY2526 Projects (parent page, one per fiscal year)
            ├── LI2500073 - Data Analytics Transformation Project
            ├── ...

Project pages carry drawio attachments identified by
mediaType == "application/vnd.jgraph.mxfile" (skip `.backup`).
Each project may have 0 to N diagrams.

Project metadata (PM / IT Lead / DT Lead / Review Status) is embedded in the
page body HTML as <th>label</th><td>value</td> rows — scraped via regex.

Local fallback layout (used when CONFLUENCE_TOKEN is blank):
    LOCAL_DRAWIO_ROOT/
      <fiscal_year>/
        <project_id>__<project_name>/
          *.drawio
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


DRAWIO_MEDIA = "application/vnd.jgraph.mxfile"
PROJECT_ID_RE = re.compile(r"(LI\d{6,7}|RD\d{6,11})")
METADATA_KEYS = {
    "pm": ["PM", "Project Manager"],
    "it_lead": ["IT Lead", "IT Leader", "IT PM"],
    "dt_lead": ["DT Lead", "DT Leader"],
    "review_status": ["Review Status", "Status"],
}


@dataclass
class ProjectPage:
    project_id: str
    name: str
    fiscal_year: str
    page_id: str = ""
    pm: str = ""
    it_lead: str = ""
    dt_lead: str = ""
    review_status: str = ""
    drawio_xmls: list[str] = field(default_factory=list)


def _extract_metadata(body_html: str) -> dict[str, str]:
    """Extract project metadata from Confluence page body HTML using regex."""
    out: dict[str, str] = {}
    if not body_html:
        return out
    for field_name, labels in METADATA_KEYS.items():
        for label in labels:
            # Pattern: <th>label</th><td>value</td> or similar
            pattern = rf"{re.escape(label)}[^<]*?</(?:th|td|strong|b|p)>\s*<(?:th|td|strong|b|p)[^>]*>([^<]{{1,120}})"
            m = re.search(pattern, body_html, re.IGNORECASE)
            if m:
                value = re.sub(r"\s+", " ", m.group(1)).strip()
                if value and value.lower() not in ("", "n/a", "tbd"):
                    out[field_name] = value
                    break
    return out


def _extract_project_id(title: str, page_id: str) -> str:
    match = PROJECT_ID_RE.search(title)
    if match:
        return match.group(1)
    return f"P{page_id}"


class ConfluenceClient:
    def __init__(self) -> None:
        self.base = settings.confluence_base_url.rstrip("/")
        self.token = settings.confluence_token
        self.space = settings.confluence_space_key
        self._client = httpx.Client(
            base_url=self.base,
            timeout=60.0,
            follow_redirects=True,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
            },
        )
        self._fy_cache: dict[str, Optional[str]] = {}

    @property
    def configured(self) -> bool:
        return bool(self.base and self.token)

    def close(self) -> None:
        self._client.close()

    # ---------- low level ----------

    def _get_json(self, path: str, params: Optional[dict] = None, max_retries: int = 3) -> dict:
        url = path
        last_exc: Optional[Exception] = None
        for attempt in range(max_retries):
            try:
                resp = self._client.get(url, params=params)
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError("retriable", request=resp.request, response=resp)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                wait = 1 << attempt
                logger.warning("GET %s failed (attempt %d): %s — retry in %ds", url, attempt + 1, exc, wait)
                time.sleep(wait)
        assert last_exc is not None
        raise last_exc

    def _get_bytes(self, path: str) -> bytes:
        resp = self._client.get(path)
        resp.raise_for_status()
        return resp.content

    # ---------- FY parent lookup ----------

    def get_fy_parent_id(self, fiscal_year: str) -> Optional[str]:
        if fiscal_year in self._fy_cache:
            return self._fy_cache[fiscal_year]
        title = f"{fiscal_year} Projects"
        data = self._get_json(
            "/rest/api/content",
            params={"spaceKey": self.space, "title": title, "limit": 5},
        )
        results = data.get("results", [])
        page_id = results[0]["id"] if results else None
        self._fy_cache[fiscal_year] = page_id
        if page_id:
            logger.info("FY parent for %s = %s (%s)", fiscal_year, page_id, title)
        else:
            logger.warning("FY parent not found for %s (searched title=%s)", fiscal_year, title)
        return page_id

    # ---------- project listing ----------

    def list_project_pages(
        self, fy_parent_id: str, fiscal_year: str, limit: Optional[int] = None
    ) -> list[ProjectPage]:
        """Paginate through child pages of a FY parent."""
        projects: list[ProjectPage] = []
        start = 0
        page_size = 50
        while True:
            data = self._get_json(
                f"/rest/api/content/{fy_parent_id}/child/page",
                params={"limit": page_size, "start": start},
            )
            results = data.get("results", [])
            for r in results:
                pid = r["id"]
                title = r["title"]
                proj = ProjectPage(
                    project_id=_extract_project_id(title, pid),
                    name=title,
                    fiscal_year=fiscal_year,
                    page_id=pid,
                )
                projects.append(proj)
                if limit and len(projects) >= limit:
                    return projects
            if len(results) < page_size:
                break
            start += page_size
        return projects

    # ---------- page metadata ----------

    def enrich_metadata(self, project: ProjectPage) -> None:
        try:
            data = self._get_json(
                f"/rest/api/content/{project.page_id}",
                params={"expand": "body.storage"},
            )
            body = data.get("body", {}).get("storage", {}).get("value", "")
            meta = _extract_metadata(body)
            project.pm = meta.get("pm", "")
            project.it_lead = meta.get("it_lead", "")
            project.dt_lead = meta.get("dt_lead", "")
            project.review_status = meta.get("review_status", "")
        except Exception as exc:  # noqa: BLE001
            logger.warning("enrich_metadata failed for %s: %s", project.project_id, exc)

    # ---------- drawio attachments ----------

    def fetch_drawio_xmls(self, project: ProjectPage) -> None:
        """Download all drawio attachments for a project page."""
        try:
            data = self._get_json(
                f"/rest/api/content/{project.page_id}/child/attachment",
                params={"limit": 100, "expand": "metadata"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("list attachments failed for %s: %s", project.project_id, exc)
            return

        for att in data.get("results", []):
            mt = att.get("metadata", {}).get("mediaType", "")
            if mt != DRAWIO_MEDIA:
                continue
            title = att.get("title", "")
            if title.startswith("drawio-backup") or title.startswith("~"):
                continue
            download_path = att.get("_links", {}).get("download")
            if not download_path:
                continue
            try:
                content = self._get_bytes(download_path)
                xml = content.decode("utf-8", errors="ignore")
                if xml:
                    project.drawio_xmls.append(xml)
                    logger.info(
                        "downloaded %s / %s (%d bytes)",
                        project.project_id,
                        title,
                        len(content),
                    )
            except Exception as exc:  # noqa: BLE001
                logger.warning("download failed %s: %s", title, exc)


# ---------------------------------------------------------------------------
# Local-file fallback
# ---------------------------------------------------------------------------


def load_local_projects(fiscal_year: str, limit: Optional[int] = None) -> list[ProjectPage]:
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
        drawio_files = (
            list(proj_dir.glob("*.drawio"))
            + list(proj_dir.glob("*App*.xml"))
            + list(proj_dir.glob("*.mxfile"))
        )
        if not drawio_files:
            continue
        xmls = [f.read_text(encoding="utf-8", errors="ignore") for f in drawio_files]
        projects.append(
            ProjectPage(
                project_id=project_id,
                name=project_name,
                fiscal_year=fiscal_year,
                drawio_xmls=xmls,
            )
        )
        if limit and len(projects) >= limit:
            break
    logger.info("Loaded %d local projects for %s", len(projects), fiscal_year)
    return projects


# ---------------------------------------------------------------------------
# Primary entry point
# ---------------------------------------------------------------------------


def _fetch_confluence_projects(fiscal_year: str, limit: Optional[int]) -> list[ProjectPage]:
    client = ConfluenceClient()
    try:
        fy_parent_id = client.get_fy_parent_id(fiscal_year)
        if not fy_parent_id:
            return []
        projects = client.list_project_pages(fy_parent_id, fiscal_year, limit=limit)
        logger.info("FY %s: %d project pages", fiscal_year, len(projects))
        for i, project in enumerate(projects):
            client.enrich_metadata(project)
            client.fetch_drawio_xmls(project)
            if i % 10 == 0:
                logger.info("FY %s: processed %d/%d", fiscal_year, i + 1, len(projects))
        return projects
    finally:
        client.close()


async def fetch_projects(fiscal_year: str, limit: Optional[int] = None) -> list[ProjectPage]:
    client = ConfluenceClient()
    if client.configured:
        client.close()
        logger.info("Fetching Confluence projects for %s (limit=%s)", fiscal_year, limit)
        return await asyncio.to_thread(_fetch_confluence_projects, fiscal_year, limit)
    client.close()
    return await asyncio.to_thread(load_local_projects, fiscal_year, limit)
