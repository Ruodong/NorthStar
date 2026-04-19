"use client";

import { useMemo, useState } from "react";
import { useTabFetch } from "../_shared/useTabFetch";
import Link from "next/link";
import type {
  AppNode,
  Investment,
  ConfluencePageRef,
  TcoData,
} from "../_shared/types";
import { STATUS_COLORS } from "../_shared/types";
import { Panel } from "../_shared/Panel";
import { EmptyState } from "../_shared/EmptyState";
import { Kpi } from "../_shared/Kpi";
import { CmdbField } from "../_shared/CmdbField";
import { CITY_LABELS } from "../_shared/cities";
import { MetadataList, type MetadataRow } from "@/components/MetadataList";
import { Pill, statusToPillTone } from "@/components/Pill";

export function OverviewTab({
  app,
  investments,
  confluencePages,
  tco,
}: {
  app: AppNode;
  investments: Investment[];
  confluencePages: ConfluencePageRef[];
  tco?: TcoData | null;
}) {
  const fyList = [...new Set(investments.map((i) => i.fiscal_year).filter(Boolean))].sort();

  // Fetch deployment summary for the overview panel (non-blocking).
  interface DeployApiShape {
    summary: { servers: number; containers: number; databases: number; object_storage?: number; nas?: number };
    by_city: { city: string; total: number }[];
  }
  const { data: deployRaw } = useTabFetch<DeployApiShape>(
    `/api/masters/applications/${app.app_id}/deployment`,
    [app.app_id],
  );
  const deploySummary = useMemo(() => {
    if (!deployRaw) return null;
    return {
      ...deployRaw.summary,
      top_cities: (deployRaw.by_city || [])
        .slice(0, 3)
        .map((c) => ({ city: c.city, total: c.total })),
    };
  }, [deployRaw]);

  // ---- MetadataList rows, per DESIGN.md §App Detail Redesign →
  //      MetadataList primitive. No card chrome. Flat 2-col grid, rows
  //      with null/empty values are dropped by MetadataList automatically.
  const basicRows: MetadataRow[] = [
    { label: "App ID", value: app.app_id, mono: true },
    { label: "Full Name", value: app.app_full_name },
    {
      label: "Status",
      value: app.status ? <Pill label={app.status} tone={statusToPillTone(app.status)} /> : null,
    },
    { label: "Service Area", value: app.u_service_area },
    { label: "Classification", value: app.app_classification?.replace(/^"|"$/g, "") },
    { label: "Solution Type", value: app.app_solution_type },
    { label: "Ownership", value: app.app_ownership },
    { label: "Portfolio", value: app.portfolio_mgt },
    { label: "Description", value: app.short_description, wide: true },
  ];

  const ownersRows: MetadataRow[] = [
    { label: "Owned By", value: resolvedName(app.owned_by, app.owned_by_name), mono: true },
    { label: "IT Owner", value: resolvedName(app.app_it_owner, app.app_it_owner_name), mono: true },
    { label: "DT Owner", value: resolvedName(app.app_dt_owner, app.app_dt_owner_name), mono: true },
    { label: "Ops Owner", value: resolvedName(app.app_operation_owner, app.app_operation_owner_name), mono: true },
    { label: "Owner Tower", value: app.app_owner_tower },
    { label: "Owner Domain", value: app.app_owner_domain },
    { label: "Ops Tower", value: app.app_operation_owner_tower },
    { label: "Ops Domain", value: app.app_operation_owner_domain },
  ];

  const deploymentRows: MetadataRow[] = [
    { label: "Data Residency", value: app.data_residency_geo },
    { label: "Country", value: app.data_residency_country },
    { label: "Data Center", value: app.data_center },
    { label: "Patch Level", value: app.patch_level },
    { label: "Support", value: app.support },
    {
      label: "Decommissioned",
      value: app.decommissioned_at
        ? new Date(app.decommissioned_at).toISOString().slice(0, 10)
        : null,
      mono: true,
    },
  ];

  const tcoRows: MetadataRow[] = tco
    ? [
        { label: "Classification", value: tco.application_classification },
        { label: "Stamp (K$)", value: formatMoney(tco.stamp_k), mono: true },
        { label: "Budget (K$)", value: formatMoney(tco.budget_k), mono: true },
        { label: "Actual (K$)", value: formatMoney(tco.actual_k), mono: true },
        { label: "Alloc Stamp (K$)", value: formatMoney(tco.allocation_stamp_k), mono: true },
        { label: "Alloc Actual (K$)", value: formatMoney(tco.allocation_actual_k), mono: true },
      ]
    : [];

  const hasDeploymentData =
    deploymentRows.some((r) => r.value != null && r.value !== "") ||
    (deploySummary && (deploySummary.servers + deploySummary.containers + deploySummary.databases) > 0);

  return (
    <div style={{ display: "grid", gap: 36, maxWidth: 980 }}>
      {/* Basic — flat MetadataList, no card chrome */}
      <section aria-labelledby="overview-basic">
        <SectionHeader id="overview-basic">Basic</SectionHeader>
        <MetadataList rows={basicRows} />
      </section>

      {/* Owners */}
      <section aria-labelledby="overview-owners">
        <SectionHeader id="overview-owners">Owners</SectionHeader>
        <MetadataList rows={ownersRows} />
      </section>

      {/* Deployment */}
      <section aria-labelledby="overview-deployment">
        <SectionHeader id="overview-deployment">Deployment</SectionHeader>
        {!hasDeploymentData ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            No deployment data recorded for this application.
          </div>
        ) : (
          <>
            <MetadataList rows={deploymentRows} />
            {deploySummary && (deploySummary.servers + deploySummary.containers + deploySummary.databases) > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 8, fontFamily: "var(--font-mono)" }}>
                  Infrastructure (InfraOps)
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                  {deploySummary.servers > 0 && (
                    <DeployStat label="servers" value={deploySummary.servers} />
                  )}
                  {deploySummary.containers > 0 && (
                    <DeployStat label="containers" value={deploySummary.containers} />
                  )}
                  {deploySummary.databases > 0 && (
                    <DeployStat label="databases" value={deploySummary.databases} />
                  )}
                </div>
                {deploySummary.top_cities.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                    {deploySummary.top_cities.map((c, i) => (
                      <span key={c.city}>
                        {i > 0 && " · "}
                        {CITY_LABELS[c.city] || c.city} ({c.total})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* TCO — only when data present */}
      {tco && (
        <section aria-labelledby="overview-tco">
          <SectionHeader id="overview-tco">TCO / Financials</SectionHeader>
          <MetadataList rows={tcoRows} />
        </section>
      )}

      {/* Fiscal year presence */}
      <section aria-labelledby="overview-fiscal">
        <SectionHeader id="overview-fiscal">Fiscal year presence</SectionHeader>
        {fyList.length === 0 ? (
          <EmptyState>No project investments recorded.</EmptyState>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {fyList.map((fy) => (
              <span
                key={fy}
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  padding: "3px 10px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                }}
              >
                {fy}
              </span>
            ))}
          </div>
        )}
      </section>

      <LifeCycleChangePanel appId={app.app_id} />

      {confluencePages.length > 0 && (
        <section aria-labelledby="overview-confluence">
          <SectionHeader id="overview-confluence">Confluence pages</SectionHeader>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13 }}>
            {confluencePages.map((p) => (
              <li key={p.page_id} style={{ marginBottom: 6 }}>
                <a
                  href={p.page_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  {p.title || p.page_id} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EaStandardsPanel appId={app.app_id} />
    </div>
  );
}

// ---- Helpers (Overview-local, not worth promoting to _shared) ----

function SectionHeader({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 1.6,
        textTransform: "uppercase",
        color: "var(--text-muted)",
        margin: "0 0 12px 0",
        paddingBottom: 6,
        borderBottom: "1px solid var(--border)",
      }}
    >
      {children}
    </h2>
  );
}

function DeployStat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 18 }}>{value}</span>
      <span style={{ color: "var(--text-dim)", marginLeft: 6, fontSize: 12 }}>{label}</span>
    </div>
  );
}

function resolvedName(code: string | null | undefined, name: string | null | undefined) {
  if (!code && !name) return null;
  if (name && code) {
    return (
      <>
        {name}{" "}
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{code}</span>
      </>
    );
  }
  return name || code || null;
}

function formatMoney(v: number | null | undefined): string | null {
  return v != null ? v.toFixed(1) : null;
}

// pillToneForStatus moved to @/components/Pill as `statusToPillTone`.

/* ── EA Standards & Guidelines panel (contextual) ────────────── */
interface EaDocRef {
  page_id: string;
  title: string;
  domain: string;
  doc_type: string;
  page_url: string;
  excerpt: string | null;
}

const EA_DOMAIN_LABELS: Record<string, string> = {
  ai: "AI", aa: "App", ta: "Tech", da: "Data", dpp: "Privacy", governance: "Gov",
};
const EA_TYPE_LABELS: Record<string, string> = {
  standard: "Standard", guideline: "Guideline",
  reference_arch: "Ref Arch", template: "Template",
};

function EaStandardsPanel({ appId }: { appId: string }) {
  const { data, loading } = useTabFetch<EaDocRef[]>(
    appId ? `/api/ea-documents/for-app/${encodeURIComponent(appId)}` : null,
    [appId],
  );
  const docs = data || [];
  if (loading || docs.length === 0) return null;

  const groups: { label: string; items: EaDocRef[] }[] = [];
  const standards = docs.filter((d) => d.doc_type === "standard");
  const guidelines = docs.filter((d) => d.doc_type === "guideline");
  const others = docs.filter((d) => d.doc_type !== "standard" && d.doc_type !== "guideline");
  if (standards.length) groups.push({ label: "Standards", items: standards });
  if (guidelines.length) groups.push({ label: "Guidelines", items: guidelines });
  if (others.length) groups.push({ label: "Reference Architectures", items: others });

  return (
    <Panel title={`EA Standards & Guidelines (${docs.length})`}>
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 6 }}>
            {g.label}
          </div>
          {g.items.map((d) => (
            <div key={d.page_id} style={{ marginBottom: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontSize: 9, fontWeight: 600, padding: "1px 5px",
                  border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
                  color: "var(--text-muted)", fontFamily: "var(--font-mono)",
                }}
              >
                {EA_DOMAIN_LABELS[d.domain] || d.domain}
              </span>
              <a
                href={d.page_url}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13 }}
              >
                {d.title} ↗
              </a>
            </div>
          ))}
        </div>
      ))}
    </Panel>
  );
}

// (Kpi moved to _shared/Kpi.tsx in PR 2 step 2c)

// ---------------- Life Cycle Change ----------------
// Spec: .specify/features/lifecycle-change/spec.md
// Lists every project where the app is Change / New / Sunset (a "major app"
// for that project), sorted by go-live date DESC, NULL last.

interface LifecycleEntry {
  project_id: string;
  project_name: string | null;
  go_live_date: string | null;
  fiscal_year: string | null;
  status: "Change" | "New" | "Sunset";
  change_description: string | null;
}

const LIFECYCLE_INITIAL_LIMIT = 6;
const LIFECYCLE_COLLAPSE_THRESHOLD = 10;

function LifeCycleChangePanel({ appId }: { appId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data, err } = useTabFetch<{ entries: LifecycleEntry[] }>(
    appId
      ? `/api/masters/applications/${encodeURIComponent(appId)}/lifecycle`
      : null,
    [appId],
  );
  const entries: LifecycleEntry[] | null = data ? data.entries || [] : null;

  if (err) {
    return (
      <Panel title="Life cycle change">
        <EmptyState>Failed to load: {err}</EmptyState>
      </Panel>
    );
  }
  if (entries === null) {
    return (
      <Panel title="Life cycle change">
        <EmptyState>Loading…</EmptyState>
      </Panel>
    );
  }
  if (entries.length === 0) {
    return (
      <Panel title="Life cycle change">
        <EmptyState>
          This application has no project-driven life-cycle changes on record.
        </EmptyState>
      </Panel>
    );
  }

  const shouldCollapse = entries.length > LIFECYCLE_COLLAPSE_THRESHOLD;
  const visible = !shouldCollapse || expanded
    ? entries
    : entries.slice(0, LIFECYCLE_INITIAL_LIMIT);

  // Group by go-live-date YEAR (string "2026" / "2025" / "Unscheduled").
  // Dates that aren't ISO-parseable (e.g. "Q2 FY26") also fall into Unscheduled.
  const groups: { label: string; items: LifecycleEntry[] }[] = [];
  const byYear = new Map<string, LifecycleEntry[]>();
  for (const e of visible) {
    const year = yearOfGoLive(e.go_live_date);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(e);
  }
  const yearsDesc = [...byYear.keys()]
    .filter((y) => y !== "Unscheduled")
    .sort((a, b) => b.localeCompare(a));
  for (const y of yearsDesc) groups.push({ label: y, items: byYear.get(y)! });
  if (byYear.has("Unscheduled")) {
    groups.push({ label: "Unscheduled", items: byYear.get("Unscheduled")! });
  }

  return (
    <Panel title="Life cycle change">
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {groups.map((g) => (
          <div key={g.label}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--text-dim)",
                marginBottom: 10,
                fontFamily: "var(--font-mono)",
              }}
            >
              {g.label}
            </div>
            <div style={{ position: "relative", paddingLeft: 20 }}>
              {/* vertical timeline rail */}
              <div
                style={{
                  position: "absolute",
                  left: 5,
                  top: 6,
                  bottom: 6,
                  width: 1,
                  background: "var(--border)",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {g.items.map((e, idx) => (
                  <LifecycleRow
                    key={`${e.project_id}-${e.status}-${idx}`}
                    entry={e}
                    dated={Boolean(e.go_live_date)}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}

        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              alignSelf: "flex-start",
              background: "transparent",
              border: "none",
              padding: "4px 0",
              cursor: "pointer",
              color: "var(--accent)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              textDecoration: "underline",
            }}
          >
            {expanded
              ? `Show only the latest ${LIFECYCLE_INITIAL_LIMIT}`
              : `Show all ${entries.length} changes`}
          </button>
        )}
      </div>
    </Panel>
  );
}

function LifecycleRow({ entry, dated }: { entry: LifecycleEntry; dated: boolean }) {
  const color = STATUS_COLORS[entry.status] || "var(--text-muted)";
  return (
    <div style={{ position: "relative" }}>
      {/* timeline dot — filled when dated, hollow otherwise */}
      <div
        style={{
          position: "absolute",
          left: -19,
          top: 4,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: dated ? color : "transparent",
          border: `1.5px solid ${color}`,
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            padding: "2px 8px",
            border: `1px solid ${color}`,
            color,
            background: "transparent",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {entry.status}
        </span>
        <span
          style={{
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: dated ? "var(--text)" : "var(--text-dim)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {entry.go_live_date || "No go-live date"}
        </span>
        {entry.fiscal_year && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              padding: "2px 6px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
            }}
          >
            {entry.fiscal_year}
          </span>
        )}
      </div>
      <div style={{ marginTop: 4, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <Link
          href={`/projects/${encodeURIComponent(entry.project_id)}`}
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          {entry.project_name || entry.project_id}
        </Link>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          {entry.project_id}
        </span>
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 12,
          lineHeight: 1.5,
          color: entry.change_description ? "var(--text-muted)" : "var(--text-dim)",
          fontStyle: entry.change_description ? "normal" : "italic",
          whiteSpace: "pre-wrap",
        }}
      >
        {entry.change_description || "No explicit change notes captured."}
      </div>
    </div>
  );
}

function yearOfGoLive(raw: string | null): string {
  if (!raw) return "Unscheduled";
  const m = raw.match(/^(\d{4})-\d{2}-\d{2}/);
  if (m) return m[1];
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  return "Unscheduled";
}

