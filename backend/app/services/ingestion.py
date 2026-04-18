"""Ingestion pipeline orchestration: Confluence → parser → evaluator → AGE graph.

Runs as FastAPI BackgroundTask. Task state stored in-memory (MVP).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from datetime import datetime
from typing import Optional

from app.models.schemas import (
    IngestionProjectResult,
    IngestionTask,
    QualityReport,
    QualityFinding,
)
from app.services import ai_evaluator, graph_client
from app.services.confluence import ProjectPage, fetch_projects
from app.services.drawio_parser import parse_drawio_xml

logger = logging.getLogger(__name__)


_tasks: dict[str, IngestionTask] = {}
_quality_reports: dict[str, QualityReport] = {}


def _derive_app_id(app: dict, project_id: str) -> str:
    if app.get("id_is_standard") and app.get("standard_id"):
        return app["standard_id"]
    seed = f"{app.get('app_name', '')}|{project_id}"
    return "X" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:12]


async def _load_project(project: ProjectPage) -> tuple[int, int, dict]:
    """Parse one project and MERGE it into Neo4j. Returns (apps_loaded, interactions_loaded, quality)."""
    if not project.drawio_xmls:
        return 0, 0, {"overall_score": 0.0, "completeness": {"findings": []}, "consistency": {"findings": []}}

    # Parse all diagrams on this project page and union the results.
    applications: list[dict] = []
    interactions: list[dict] = []
    for xml in project.drawio_xmls:
        parsed = parse_drawio_xml(xml, "App_Arch")
        applications.extend(parsed.get("applications", []))
        interactions.extend(parsed.get("interactions", []))

    # Build app_id mapping
    app_id_by_cell: dict[str, str] = {}
    for app in applications:
        app_id = _derive_app_id(app, project.project_id)
        app_id_by_cell[app.get("cell_id", "")] = app_id

    now = datetime.utcnow().isoformat()

    # Merge Project node
    await graph_client.run_write(
        """
        MERGE (p:Project {project_id: $project_id})
        SET p.name = $name,
            p.fiscal_year = $fiscal_year,
            p.pm = $pm,
            p.it_lead = $it_lead,
            p.dt_lead = $dt_lead,
            p.review_status = $review_status,
            p.last_updated = $now
        """,
        {
            "project_id": project.project_id,
            "name": project.name,
            "fiscal_year": project.fiscal_year,
            "pm": project.pm,
            "it_lead": project.it_lead,
            "dt_lead": project.dt_lead,
            "review_status": project.review_status,
            "now": now,
        },
    )

    # Merge applications + INVESTS_IN edge (ontology-fix: Project invests in App,
    # fiscal_year lives on the edge, not on the Application node)
    for app in applications:
        cell_id = app.get("cell_id", "")
        app_id = app_id_by_cell.get(cell_id)
        if not app_id:
            continue
        await graph_client.run_write(
            """
            MERGE (a:Application {app_id: $app_id})
            ON CREATE SET a.cmdb_linked = false
            SET a.name = $name,
                a.status = $status,
                a.description = $description,
                a.last_updated = $now
            WITH a
            MATCH (p:Project {project_id: $project_id})
            MERGE (p)-[r:INVESTS_IN]->(a)
            SET r.fiscal_year = coalesce($fiscal_year, r.fiscal_year, ''),
                r.review_status = coalesce($review_status, r.review_status, ''),
                r.last_seen_at = $now
            """,
            {
                "app_id": app_id,
                "name": app.get("app_name", ""),
                "status": app.get("application_status") or "Keep",
                "description": app.get("functions", ""),
                "project_id": project.project_id,
                "fiscal_year": project.fiscal_year,
                "review_status": project.review_status,
                "now": now,
            },
        )

    # Merge interactions
    loaded_interactions = 0
    for inter in interactions:
        src_cell = inter.get("source_id")
        tgt_cell = inter.get("target_id")
        src_id = app_id_by_cell.get(src_cell)
        tgt_id = app_id_by_cell.get(tgt_cell)
        if not src_id or not tgt_id:
            continue
        await graph_client.run_write(
            """
            MATCH (a:Application {app_id: $src}), (b:Application {app_id: $tgt})
            MERGE (a)-[r:INTEGRATES_WITH {interaction_type: $itype, business_object: $bobj}]->(b)
            SET r.status = $status,
                r.protocol = $protocol
            """,
            {
                "src": src_id,
                "tgt": tgt_id,
                "itype": inter.get("interaction_type") or "",
                "bobj": inter.get("business_object") or "",
                "status": inter.get("interaction_status") or "Keep",
                "protocol": inter.get("label") or "",
            },
        )
        loaded_interactions += 1

    quality = ai_evaluator.evaluate(applications, interactions)
    return len(applications), loaded_interactions, quality


async def _run_ingestion(task_id: str, fiscal_years: list[str], limit: Optional[int] = None) -> None:
    task = _tasks[task_id]
    report = QualityReport(task_id=task_id)
    _quality_reports[task_id] = report
    try:
        for fy in fiscal_years:
            projects = await fetch_projects(fy, limit=limit)
            task.total_projects += len(projects)
            for project in projects:
                result = IngestionProjectResult(
                    project_id=project.project_id,
                    project_name=project.name,
                    fiscal_year=project.fiscal_year,
                    status="ok",
                )
                try:
                    apps, inters, quality = await _load_project(project)
                    result.applications_loaded = apps
                    result.interactions_loaded = inters
                    result.quality_score = float(quality.get("overall_score", 0.0))
                    task.success_count += 1
                    task.new_applications += apps
                    task.new_interactions += inters
                    report.project_scores[project.project_id] = result.quality_score
                    for dim in ("completeness", "consistency"):
                        for f in quality.get(dim, {}).get("findings", []):
                            report.findings.append(
                                QualityFinding(
                                    dimension=dim,
                                    severity=f.get("severity", "info"),
                                    message=f"[{project.project_id}] {f.get('message', '')}",
                                )
                            )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Project %s ingestion failed", project.project_id)
                    result.status = "error"
                    result.error = str(exc)
                    task.error_count += 1
                task.results.append(result)

        if task.error_count == 0:
            task.status = "completed"
        elif task.success_count > 0:
            task.status = "completed_with_errors"
        else:
            task.status = "failed"

        scores = list(report.project_scores.values())
        report.overall_score = round(sum(scores) / len(scores), 1) if scores else 0.0
    except Exception as exc:  # noqa: BLE001
        logger.exception("Ingestion task %s failed", task_id)
        task.status = "failed"
    finally:
        task.completed_at = datetime.utcnow()


def create_task(fiscal_years: list[str], limit: Optional[int] = None) -> IngestionTask:
    task_id = uuid.uuid4().hex[:12]
    task = IngestionTask(
        task_id=task_id,
        fiscal_years=fiscal_years,
        status="running",
        started_at=datetime.utcnow(),
    )
    _tasks[task_id] = task
    # stash limit in task for replay/debug
    setattr(task, "_limit", limit)
    return task


async def start_task(task: IngestionTask) -> None:
    limit = getattr(task, "_limit", None)
    asyncio.create_task(_run_ingestion(task.task_id, task.fiscal_years, limit))


def list_tasks(status: Optional[str] = None, limit: int = 50, offset: int = 0) -> list[IngestionTask]:
    tasks = sorted(_tasks.values(), key=lambda t: t.started_at, reverse=True)
    if status:
        tasks = [t for t in tasks if t.status == status]
    return tasks[offset : offset + limit]


def get_task(task_id: str) -> Optional[IngestionTask]:
    return _tasks.get(task_id)


def get_quality_report(task_id: str) -> Optional[QualityReport]:
    return _quality_reports.get(task_id)
