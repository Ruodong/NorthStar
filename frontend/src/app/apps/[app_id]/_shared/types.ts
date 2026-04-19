// -----------------------------------------------------------------------------
// App Detail — shared types
// -----------------------------------------------------------------------------
// Shape mirrors backend/app/services/graph_query.py::get_application
// Single source of truth for AppDetailClient.tsx + every tab module under
// apps/[app_id]/tabs/. Also re-exported from lib/api-server.ts so the RSC
// fetch wrapper has the same return type.
//
// Backend uses snake_case JSON; these interfaces follow snake_case to match.
// Do NOT introduce camelCase aliases here.
// -----------------------------------------------------------------------------

export interface AppNode {
  app_id: string;
  name: string;
  status: string;
  description?: string;
  cmdb_linked?: boolean;
  last_updated?: string;
  // CMDB enrichment (from ref_application via Postgres)
  short_description?: string;
  app_full_name?: string;
  u_service_area?: string;
  app_classification?: string;
  app_ownership?: string;
  app_solution_type?: string;
  portfolio_mgt?: string;
  owned_by?: string;
  owned_by_name?: string;
  app_it_owner?: string;
  app_it_owner_name?: string;
  app_dt_owner?: string;
  app_dt_owner_name?: string;
  app_operation_owner?: string;
  app_operation_owner_name?: string;
  app_owner_tower?: string;
  app_owner_domain?: string;
  app_operation_owner_tower?: string;
  app_operation_owner_domain?: string;
  patch_level?: string;
  decommissioned_at?: string;
  data_residency_geo?: string;
  data_residency_country?: string;
  data_center?: string;
  support?: string;
  source_system?: string;
}

export interface OutboundEdge {
  target: string;
  target_name: string;
  type: string;
  business_object: string;
  protocol: string;
}

export interface InboundEdge {
  source: string;
  source_name: string;
  type: string;
  business_object: string;
  protocol: string;
}

export interface MajorApp {
  app_id: string;
  app_name: string;
  status: string;
}

export interface Investment {
  project_id: string;
  project_name: string;
  fiscal_year: string;
  root_page_id: string | null;
  major_apps: MajorApp[];
}

export interface DiagramRef {
  // Neo4j diagram (DESCRIBED_BY edge)
  diagram_id?: string;
  diagram_type?: string;
  file_kind?: string;
  file_name?: string;
  source_systems?: string[];
  has_graph_data?: boolean;
  // Postgres drawio reference (confluence_diagram_app)
  attachment_id?: string;
  page_id?: string;
  page_title?: string;
  page_url?: string;
  fiscal_year?: string;
  project_id?: string;
  project_name?: string;
  // Paired PNG preview attachment (for thumbnail generation)
  preview_attachment_id?: string;
}

export interface ConfluencePageRef {
  page_id: string;
  title: string;
  page_url: string;
}

export interface TcoData {
  application_classification?: string;
  stamp_k?: number;
  budget_k?: number;
  actual_k?: number;
  allocation_stamp_k?: number;
  allocation_actual_k?: number;
}

export interface ReviewPage {
  page_id: string;
  fiscal_year: string;
  title: string;
  page_url: string;
  body_size_chars?: number;
  q_pm?: string;
  q_it_lead?: string;
  q_dt_lead?: string;
  questionnaire_sections?:
    | { title: string; rows: { label: string; value: string }[] }[]
    | null;
}

export interface AppDetailResponse {
  app: AppNode;
  outbound: OutboundEdge[];
  inbound: InboundEdge[];
  investments: Investment[];
  diagrams: DiagramRef[];
  confluence_pages: ConfluencePageRef[];
  tco?: TcoData | null;
  review_pages?: ReviewPage[];
}

// ---- Impact (reverse dependency) types ----
export interface ImpactApp {
  app_id: string;
  name: string;
  status: string;
  cmdb_linked: boolean;
}

export interface ImpactBucket {
  distance: number;
  total: number;
  shown: number;
  apps: ImpactApp[];
}

export interface BusinessObjectAgg {
  name: string;
  count: number;
}

export interface ImpactResponse {
  root: { app_id: string; name: string; status: string };
  depth: number;
  total_upstream: number;
  by_distance: ImpactBucket[];
  business_objects: BusinessObjectAgg[];
  truncated_at_cypher_limit: boolean;
  fan_out_cap: number;
}

// ---- Tab identity ----
export type Tab =
  | "overview"
  | "capabilities"
  | "integrations"
  | "investments"
  | "diagrams"
  | "impact"
  | "confluence"
  | "knowledge"
  | "deployment";

// ---- Status color mapping (consumed by StatusPill) ----
export const STATUS_COLORS: Record<string, string> = {
  Keep: "var(--status-keep)",
  Change: "var(--status-change)",
  New: "var(--status-new)",
  Sunset: "var(--status-sunset)",
  "3rd Party": "var(--status-third)",
  Active: "var(--success)",
};
