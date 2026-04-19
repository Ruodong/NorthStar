"use client";

import { useEffect, useState } from "react";
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

  // Fetch deployment summary for the overview panel
  const [deploySummary, setDeploySummary] = useState<{
    servers: number; containers: number; databases: number;
    top_cities: { city: string; total: number }[];
  } | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/masters/applications/${app.app_id}/deployment`);
        const j = await r.json();
        if (j.success && j.data) {
          const s = j.data.summary;
          const cities = (j.data.by_city || []).slice(0, 3).map((c: { city: string; total: number }) => ({
            city: c.city, total: c.total,
          }));
          setDeploySummary({ ...s, top_cities: cities });
        }
      } catch { /* non-blocking */ }
    })();
  }, [app.app_id]);

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      <Panel title="Basic">
        <CmdbField label="App ID" value={app.app_id} mono />
        <CmdbField label="Name" value={app.name} />
        <CmdbField label="Full Name" value={app.app_full_name} />
        <CmdbField label="Status" value={app.status} pill />
        <CmdbField label="Description" value={app.short_description} wide />
        <CmdbField label="Service Area" value={app.u_service_area} />
        <CmdbField label="Classification" value={app.app_classification?.replace(/^"|"$/g, "")} />
        <CmdbField label="Solution Type" value={app.app_solution_type} />
        <CmdbField label="Ownership" value={app.app_ownership} />
        <CmdbField label="Portfolio" value={app.portfolio_mgt} />
      </Panel>

      <Panel title="Owners">
        <CmdbField label="Owned By" value={app.owned_by} resolvedName={app.owned_by_name} mono />
        <CmdbField label="IT Owner" value={app.app_it_owner} resolvedName={app.app_it_owner_name} mono />
        <CmdbField label="DT Owner" value={app.app_dt_owner} resolvedName={app.app_dt_owner_name} mono />
        <CmdbField label="Ops Owner" value={app.app_operation_owner} resolvedName={app.app_operation_owner_name} mono />
        <CmdbField label="Owner Tower" value={app.app_owner_tower} />
        <CmdbField label="Owner Domain" value={app.app_owner_domain} />
        <CmdbField label="Ops Tower" value={app.app_operation_owner_tower} />
        <CmdbField label="Ops Domain" value={app.app_operation_owner_domain} />
      </Panel>

      <Panel title="Deployment">
        {!(app.data_residency_geo || app.data_residency_country || app.data_center || app.patch_level || app.support || app.decommissioned_at) &&
          !(deploySummary && (deploySummary.servers + deploySummary.containers + deploySummary.databases) > 0) && (
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            No deployment data recorded for this application.
          </div>
        )}
        <CmdbField label="Data Residency" value={app.data_residency_geo} />
        <CmdbField label="Country" value={app.data_residency_country} />
        <CmdbField label="Data Center" value={app.data_center} />
        <CmdbField label="Patch Level" value={app.patch_level} />
        <CmdbField label="Support" value={app.support} />
        {app.decommissioned_at && <CmdbField label="Decommissioned" value={new Date(app.decommissioned_at).toISOString().slice(0, 10)} />}
        {deploySummary && (deploySummary.servers + deploySummary.containers + deploySummary.databases) > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 8 }}>
              Infrastructure (InfraOps)
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {deploySummary.servers > 0 && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 16 }}>{deploySummary.servers}</span>
                  <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>servers</span>
                </div>
              )}
              {deploySummary.containers > 0 && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 16 }}>{deploySummary.containers}</span>
                  <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>containers</span>
                </div>
              )}
              {deploySummary.databases > 0 && (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 16 }}>{deploySummary.databases}</span>
                  <span style={{ color: "var(--text-dim)", marginLeft: 4 }}>databases</span>
                </div>
              )}
            </div>
            {deploySummary.top_cities.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
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
      </Panel>

      {tco && (
        <Panel title="TCO / Financials">
          <CmdbField label="Classification" value={tco.application_classification} />
          <CmdbField label="Stamp (K$)" value={tco.stamp_k != null ? tco.stamp_k.toFixed(1) : null} mono />
          <CmdbField label="Budget (K$)" value={tco.budget_k != null ? tco.budget_k.toFixed(1) : null} mono />
          <CmdbField label="Actual (K$)" value={tco.actual_k != null ? tco.actual_k.toFixed(1) : null} mono />
          <CmdbField label="Alloc Stamp (K$)" value={tco.allocation_stamp_k != null ? tco.allocation_stamp_k.toFixed(1) : null} mono />
          <CmdbField label="Alloc Actual (K$)" value={tco.allocation_actual_k != null ? tco.allocation_actual_k.toFixed(1) : null} mono />
        </Panel>
      )}

      <Panel title="Fiscal year presence">
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
      </Panel>

      <div style={{ gridColumn: "1 / -1" }}>
        <LifeCycleChangePanel appId={app.app_id} />
      </div>

      {confluencePages.length > 0 && (
        <Panel title="Confluence pages">
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
        </Panel>
      )}

      <EaStandardsPanel appId={app.app_id} />
    </div>
  );
}

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
  const [docs, setDocs] = useState<EaDocRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/ea-documents/for-app/${encodeURIComponent(appId)}`);
        const j = await r.json();
        if (!cancelled && j.success) setDocs(j.data || []);
      } catch {
        /* non-critical — hide panel */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [appId]);

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
  const [entries, setEntries] = useState<LifecycleEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setEntries(null);
      setErr(null);
      try {
        const r = await fetch(
          `/api/masters/applications/${encodeURIComponent(appId)}/lifecycle`,
        );
        const j = await r.json();
        if (cancelled) return;
        if (!j.success) {
          setErr(j.error || "API error");
          return;
        }
        setEntries(j.data?.entries || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [appId]);

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

