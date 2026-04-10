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

export interface ApplicationNode {
  app_id: string;
  name: string;
  status: string;
  description?: string;
  source_project_id?: string;
  source_fiscal_year?: string;
}

export interface IntegrationEdge {
  source_app_id: string;
  target_app_id: string;
  interaction_type: string;
  business_object: string;
  status: string;
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
};
