// types.ts — shared interfaces for the Confluence page detail view
// Split from page.tsx for maintainability.

export interface QRow {
  key: string;
  value: string;
}

export interface QSection {
  heading: string;
  level: number;
  rows: QRow[];
}

export interface QExpandPanel {
  title: string;
  content_text: string;
}

export interface Questionnaire {
  sections: QSection[];
  expand_panels: QExpandPanel[];
  stats: { tables?: number; headings?: number; chars?: number };
}

export interface Page {
  page_id: string;
  fiscal_year: string;
  title: string;
  project_id: string | null;
  page_url: string;
  parent_id: string | null;
  depth: number | null;
  has_body: boolean;
  body_size_chars: number | null;
  questionnaire: Questionnaire | null;
  q_project_id: string | null;
  q_project_name: string | null;
  q_pm: string | null;
  q_pm_name: string | null;
  q_it_lead: string | null;
  q_it_lead_name: string | null;
  q_dt_lead: string | null;
  q_dt_lead_name: string | null;
}

// source_kind identifies where this attachment actually lives:
//   "own"        → physically on this page
//   "descendant" → on a child/grandchild page (source_page_* set)
//   "referenced" → on an external source page reached via a drawio macro
//                  reference (inc-drawio or templateUrl). Carries
//                  diagram_name + macro_kind + via_page_* (which of this
//                  folder's children the macro actually lives on).
export interface Attachment {
  attachment_id: string;
  title: string;
  media_type: string;
  file_kind: string; // drawio|image|pdf|office|xml|other
  file_size: number | null;
  version: number | null;
  download_path: string;
  local_path: string | null;
  source_kind: "own" | "descendant" | "referenced";
  source_page_id: string | null;
  source_page_title: string | null;
  diagram_name: string | null;
  via_page_id?: string | null;
  via_page_title?: string | null;
  macro_kind?: string | null;
}

export interface ParentPage {
  page_id: string;
  title: string;
  depth: number | null;
}

export interface ChildPage {
  page_id: string;
  title: string;
  depth: number | null;
  page_url: string;
  page_type: string | null;
  own_attachments: number;
  own_drawio: number;
  ref_drawio: number;
}

export interface Detail {
  page: Page;
  attachments: Attachment[];
  parent: ParentPage | null;
  children: ChildPage[];
}

// ---------------------------------------------------------------------------
// Extracted Apps / Interactions — populated by scripts/parse_confluence_drawios.py
// See backend route GET /api/admin/confluence/pages/{id}/extracted
// ---------------------------------------------------------------------------
export interface ExtractedApp {
  attachment_id: string;
  attachment_title: string;
  source_page_id: string;
  source_page_title: string;
  source_kind: "own" | "descendant" | "referenced";
  cell_id: string;
  app_name: string;
  standard_id: string | null;
  id_is_standard: boolean;
  application_status: string | null;
  functions: string | null;
  fill_color: string | null;
  cmdb_name: string | null;
  // Name-id reconciliation fields (spec: drawio-name-id-reconciliation)
  resolved_app_id: string | null;
  match_type:
    | "direct"
    | "typo_tolerated"
    | "auto_corrected"
    | "auto_corrected_missing_id"
    | "fuzzy_by_name"
    | "mismatch_unresolved"
    | "no_cmdb"
    | null;
  name_similarity: number | null;
  cmdb_name_for_drawio_id: string | null;
  cmdb_name_for_resolved: string | null;
}

export interface ExtractedInteraction {
  attachment_id: string;
  attachment_title: string;
  source_page_id: string;
  source_page_title: string;
  source_kind: "own" | "descendant" | "referenced";
  edge_cell_id: string;
  source_cell_id: string | null;
  target_cell_id: string | null;
  interaction_type: string | null;
  direction: string | null;
  interaction_status: string | null;
  business_object: string | null;
  source_app_name: string | null;
  source_standard_id: string | null;
  source_resolved_id: string | null;
  source_match_type: string | null;
  source_cmdb_name_resolved: string | null;
  source_cmdb_name_orig: string | null;
  target_app_name: string | null;
  target_standard_id: string | null;
  target_resolved_id: string | null;
  target_match_type: string | null;
  target_cmdb_name_resolved: string | null;
  target_cmdb_name_orig: string | null;
}

export interface ExtractedByAttachment {
  attachment_id: string;
  attachment_title: string;
  source_page_title: string;
  source_kind: "own" | "descendant" | "referenced";
  app_count: number;
  app_with_std_id_count: number;
  interaction_count: number;
}

export interface ExtractedMajorApp {
  app_id: string;
  drawio_name: string | null;
  application_status: "New" | "Change" | "Sunset";
  occurrence_count: number;
  attachment_titles: string[] | null;
  cmdb_name: string | null;
}

export interface ExtractedData {
  apps: ExtractedApp[];
  interactions: ExtractedInteraction[];
  by_attachment: ExtractedByAttachment[];
  major_apps: ExtractedMajorApp[];
  vision_apps?: ExtractedApp[];
  vision_interactions?: ExtractedInteraction[];
  vision_by_attachment?: ExtractedByAttachment[];
}

// Image vision extract (Phase 1 PoC) — the `/vision-extract` endpoint
// returns this shape. Architects click a per-image button to trigger
// the call. Spec: .specify/features/image-vision-extract/spec.md FR-16
export interface VisionExtractResponse {
  diagram_type: "app_arch" | "tech_arch" | "unknown";
  applications: {
    app_id: string;
    id_is_standard: boolean;
    standard_id: string;
    name: string;
    functions: string[];
    application_status: string;
    source: "vision";
  }[];
  interactions: {
    source_app_id: string;
    target_app_id: string;
    interaction_type: string;
    direction: string;
    business_object: string;
    interface_status: string;
    status_inferred_from_endpoints: boolean;
    source: "vision";
  }[];
  tech_components: {
    name: string;
    component_type: string;
    layer: string;
    deploy_mode: string;
    runtime: string;
    source: "vision";
  }[];
  meta: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    wall_ms: number;
  };
}

export type Tab = "attachments" | "extracted" | "hierarchy" | "questionnaire" | "raw";

export type OfficeMode = "pdf" | "xlsx" | "unsupported";
