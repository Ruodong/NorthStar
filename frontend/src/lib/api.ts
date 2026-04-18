// API client — all calls go through Next.js rewrite to backend.

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error || "API error");
  return body.data as T;
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error || "API error");
  return body.data as T;
}

async function put<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  if (!body.success) throw new Error(body.error || "API error");
  return body.data as T;
}

export interface KpiSummary {
  total_apps: number;
  total_integrations: number;
  new_apps_current_fy: number;
  sunset_apps: number;
}

export interface StatusBucket {
  status: string;
  count: number;
}

export interface TrendPoint {
  fiscal_year: string;
  new_count: number;
  change_count: number;
  sunset_count: number;
}

export interface HubApp {
  app_id: string;
  name: string;
  degree: number;
}

// Ontology-fix: Application no longer carries source_project_id /
// source_fiscal_year. Project→App ownership is expressed via
// (:Project)-[:INVESTS_IN]->(:Application) edges with fiscal_year on the edge.
// Query /api/graph/nodes/{app_id} for the full investments[] list.
export interface ApplicationNode {
  app_id: string;
  name: string;
  status: string;
  description?: string;
  cmdb_linked?: boolean;
  last_updated?: string;
}

export interface ProjectAppInvestment {
  project_id: string;
  name?: string;
  fiscal_year?: string;
  review_status?: string;
}

export interface IntegrationEdge {
  source_app_id: string;
  target_app_id: string;
  interaction_type: string;
  business_object: string;
  status: string;
  direction?: string;
  protocol: string;
}

export interface GraphFull {
  nodes: ApplicationNode[];
  edges: IntegrationEdge[];
}

export interface IngestionTask {
  task_id: string;
  fiscal_years: string[];
  status: string;
  started_at: string;
  completed_at?: string;
  total_projects: number;
  success_count: number;
  error_count: number;
  new_applications: number;
  new_interactions: number;
  results: Array<{
    project_id: string;
    project_name: string;
    fiscal_year: string;
    status: string;
    applications_loaded: number;
    interactions_loaded: number;
    quality_score?: number;
    error?: string;
  }>;
}

// ── Architecture Template Settings ───────────────────────────────
export interface ArchitectureTemplateSource {
  layer: "business" | "application" | "technical";
  title: string;
  confluence_url: string;
  confluence_page_id: string | null;
  last_synced_at: string | null;
  last_sync_status: "syncing" | "ok" | "error" | null;
  last_sync_error: string | null;
  notes: string | null;
  updated_at: string | null;
  diagram_count: number;
}

export interface ArchitectureTemplateDiagram {
  attachment_id: string;
  file_name: string;
  media_type: string;
  file_size: number | null;
  page_id: string;
  page_title: string;
  page_url: string;
  synced_at: string | null;
  thumbnail_url: string;
  raw_url: string;
  preview_url: string;
}

export interface ArchitectureTemplateDiagramList {
  total: number;
  items: ArchitectureTemplateDiagram[];
}

export interface ArchitectureTemplateSourceUpdate {
  title?: string;
  confluence_url?: string;
  notes?: string;
}

export const api = {
  summary: () => get<KpiSummary>("/api/analytics/summary"),
  statusDistribution: () => get<StatusBucket[]>("/api/analytics/status-distribution"),
  trend: () => get<TrendPoint[]>("/api/analytics/trend"),
  hubs: (limit = 10) => get<HubApp[]>(`/api/analytics/hubs?limit=${limit}`),
  qualityScores: () =>
    get<{ distribution: { bucket: string; count: number }[]; average: number }>(
      "/api/analytics/quality-scores"
    ),
  fullGraph: (params: { fiscal_year?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.fiscal_year) q.set("fiscal_year", params.fiscal_year);
    if (params.status) q.set("status", params.status);
    const qs = q.toString();
    return get<GraphFull>(`/api/graph/full${qs ? "?" + qs : ""}`);
  },
  listTasks: () => get<IngestionTask[]>("/api/ingestion/tasks"),
  runIngestion: (fiscal_years: string[]) =>
    post<IngestionTask>("/api/ingestion/run", { fiscal_years }),
  getTask: (taskId: string) => get<IngestionTask>(`/api/ingestion/tasks/${taskId}`),

  // Architecture Template Settings (Phase 1)
  listArchitectureTemplates: () =>
    get<ArchitectureTemplateSource[]>("/api/settings/architecture-templates"),
  updateArchitectureTemplate: (
    layer: "business" | "application" | "technical",
    update: ArchitectureTemplateSourceUpdate,
  ) =>
    put<ArchitectureTemplateSource>(
      `/api/settings/architecture-templates/${layer}`,
      update,
    ),
  syncArchitectureTemplate: (layer: "business" | "application" | "technical") =>
    post<{ layer: string; status: string }>(
      `/api/settings/architecture-templates/${layer}/sync`,
      {},
    ),
  listArchitectureTemplateDiagrams: (
    layer: "business" | "application" | "technical",
    params: { limit?: number; offset?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<ArchitectureTemplateDiagramList>(
      `/api/settings/architecture-templates/${layer}/diagrams${qs ? "?" + qs : ""}`,
    );
  },
};
