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
    """An application in the IT architecture graph.

    Note: source_project_id and source_fiscal_year are intentionally absent.
    Applications are long-lived entities; the relationship to a project (and
    the fiscal year in which that project invested in the app) is expressed
    via (:Project)-[:INVESTS_IN]->(:Application) edges.
    """

    app_id: str
    name: str
    status: str = "Keep"
    description: str = ""
    cmdb_linked: bool = False
    last_updated: Optional[datetime] = None


class IntegrationEdge(BaseModel):
    source_app_id: str
    target_app_id: str
    interaction_type: str = ""
    business_object: str = ""
    status: str = "Keep"
    direction: str = "outbound"
    protocol: str = ""


class ProjectNode(BaseModel):
    project_id: str
    name: str
    fiscal_year: str = ""
    pm: str = ""
    pm_itcode: str = ""
    it_lead: str = ""
    it_lead_itcode: str = ""
    dt_lead: str = ""
    dt_lead_itcode: str = ""
    review_status: str = ""


class ProjectAppInvestment(BaseModel):
    """A single (Project)-[:INVESTS_IN]->(Application) relationship."""

    project_id: str
    project_name: str = ""
    app_id: str
    fiscal_year: str = ""
    review_status: str = ""
    source_diagram_id: Optional[str] = None
    last_seen_at: Optional[datetime] = None


class DiagramNode(BaseModel):
    """A unified :Diagram node, sourced from EGM and/or Confluence."""

    diagram_id: str
    diagram_type: str = "Unknown"  # App_Arch | Tech_Arch | Unknown
    file_kind: str = "drawio"  # drawio | image | pdf
    file_name: str = ""
    source_systems: list[str] = Field(default_factory=list)  # ['egm','confluence']
    egm_diagram_id: Optional[str] = None
    confluence_attachment_id: Optional[str] = None
    confluence_page_id: Optional[str] = None
    download_path: Optional[str] = None
    local_path: Optional[str] = None
    has_graph_data: bool = False
    last_updated: Optional[datetime] = None


class ConfluencePageNode(BaseModel):
    """A :ConfluencePage node (application page or project review page)."""

    page_id: str
    title: str = ""
    page_type: str = "other"  # application | project | other
    page_url: str = ""
    fiscal_year: str = ""
    last_updated: Optional[datetime] = None


class GraphFull(BaseModel):
    nodes: list[ApplicationNode] = Field(default_factory=list)
    edges: list[IntegrationEdge] = Field(default_factory=list)


class IngestionRunRequest(BaseModel):
    fiscal_years: list[str] = Field(default_factory=list)
    limit: Optional[int] = None  # optional per-FY project cap (for testing)


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


class PendingMergeCandidate(BaseModel):
    id: int
    norm_key: str
    candidate_ids: list[str]
    raw_names: list[str]
    projects: list[str]
    created_at: datetime
    reviewed_at: Optional[datetime] = None
    decision: Optional[str] = None  # "merge" | "keep_separate" | None
    decided_by: Optional[str] = None
    canonical_id: Optional[str] = None
    note: Optional[str] = None


class MergeDecisionRequest(BaseModel):
    decision: str  # "merge" | "keep_separate"
    canonical_id: Optional[str] = None  # required when decision == "merge"
    decided_by: str = "unknown"
    note: Optional[str] = None


class ManualAppAlias(BaseModel):
    alias_id: str
    canonical_id: str
    decided_at: Optional[datetime] = None
    decided_by: Optional[str] = None
    note: Optional[str] = None


# ── Architecture Template Settings (Phase 1) ───────────────────────
# See .specify/features/architecture-template-settings/spec.md.

class ArchitectureTemplateSource(BaseModel):
    """One row of northstar.ref_architecture_template_source.

    The table holds exactly three rows, keyed by `layer` ∈ {business,
    application, technical}. Each row points at a Confluence page whose
    subtree contains the EA-authored template diagrams for that layer.
    """
    layer: str
    title: str = ""
    confluence_url: str = ""
    confluence_page_id: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None  # None|'syncing'|'ok'|'error'
    last_sync_error: Optional[str] = None
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None
    diagram_count: int = 0


class ArchitectureTemplateSourceUpdate(BaseModel):
    """PUT body — only supplied fields update."""
    title: Optional[str] = None
    confluence_url: Optional[str] = None
    notes: Optional[str] = None


class ArchitectureTemplateDiagram(BaseModel):
    """A drawio attachment found under an architecture template subtree."""
    attachment_id: str
    file_name: str
    media_type: str = ""
    file_size: Optional[int] = None
    page_id: str
    page_title: str = ""
    page_url: str = ""
    synced_at: Optional[datetime] = None
    thumbnail_url: str
    raw_url: str
    preview_url: str
    active: bool = True


class ArchitectureTemplateDiagramList(BaseModel):
    total: int
    items: list[ArchitectureTemplateDiagram] = Field(default_factory=list)


# ── Business Capabilities (App Detail → Capabilities tab) ──────────
# See .specify/features/business-capabilities/spec.md + api.md.

class BusinessCapabilityLeaf(BaseModel):
    """One L3 Business Capability mapped to the application."""
    bc_id: str
    bc_name: str
    bc_name_cn: Optional[str] = None
    bc_description: Optional[str] = None
    level: int = 3
    lv3_capability_group: str = ""
    biz_owner: Optional[str] = None
    biz_team: Optional[str] = None
    dt_owner: Optional[str] = None
    dt_team: Optional[str] = None
    data_version: Optional[str] = None
    source_updated_at: Optional[datetime] = None


class CapabilityL2Group(BaseModel):
    l2_subdomain: str
    leaves: list[BusinessCapabilityLeaf] = Field(default_factory=list)


class CapabilityL1Group(BaseModel):
    l1_domain: str
    count: int
    l2_groups: list[CapabilityL2Group] = Field(default_factory=list)


class AppBusinessCapabilitiesResponse(BaseModel):
    app_id: str
    total_count: int = 0
    l1_groups: list[CapabilityL1Group] = Field(default_factory=list)
    taxonomy_versions: list[str] = Field(default_factory=list)
    last_synced_at: Optional[datetime] = None
    orphan_mappings: int = 0
