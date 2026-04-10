"""Pydantic schemas for API requests and responses."""
from __future__ import annotations

from datetime import datetime
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    error: Optional[str] = None


class ApplicationNode(BaseModel):
    app_id: str
    name: str
    status: str = "Keep"
    description: str = ""
    source_project_id: str = ""
    source_fiscal_year: str = ""
    last_updated: Optional[datetime] = None


class IntegrationEdge(BaseModel):
    source_app_id: str
    target_app_id: str
    interaction_type: str = ""
    business_object: str = ""
    status: str = "Keep"
    protocol: str = ""


class ProjectNode(BaseModel):
    project_id: str
    name: str
    fiscal_year: str = ""
    pm: str = ""
    it_lead: str = ""
    dt_lead: str = ""
    review_status: str = ""


class GraphFull(BaseModel):
    nodes: list[ApplicationNode] = Field(default_factory=list)
    edges: list[IntegrationEdge] = Field(default_factory=list)


class IngestionRunRequest(BaseModel):
    fiscal_years: list[str] = Field(default_factory=list)


class IngestionProjectResult(BaseModel):
    project_id: str
    project_name: str = ""
    fiscal_year: str = ""
    status: str  # "ok" | "error"
    applications_loaded: int = 0
    interactions_loaded: int = 0
    quality_score: Optional[float] = None
    error: Optional[str] = None


class IngestionTask(BaseModel):
    task_id: str
    fiscal_years: list[str]
    status: str  # "running" | "completed" | "completed_with_errors" | "failed"
    started_at: datetime
    completed_at: Optional[datetime] = None
    total_projects: int = 0
    success_count: int = 0
    error_count: int = 0
    new_applications: int = 0
    new_interactions: int = 0
    results: list[IngestionProjectResult] = Field(default_factory=list)


class QualityFinding(BaseModel):
    dimension: str  # "completeness" | "consistency"
    severity: str  # "info" | "warn" | "error"
    message: str


class QualityReport(BaseModel):
    task_id: str
    overall_score: float = 0.0
    project_scores: dict[str, float] = Field(default_factory=dict)
    findings: list[QualityFinding] = Field(default_factory=list)


class KpiSummary(BaseModel):
    total_apps: int = 0
    total_integrations: int = 0
    new_apps_current_fy: int = 0
    sunset_apps: int = 0


class StatusBucket(BaseModel):
    status: str
    count: int


class TrendPoint(BaseModel):
    fiscal_year: str
    new_count: int = 0
    change_count: int = 0
    sunset_count: int = 0


class HubApp(BaseModel):
    app_id: str
    name: str
    degree: int
