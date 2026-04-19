"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DeploymentMap } from "@/components/DeploymentMap";
import { Pill } from "@/components/Pill";
import { CapabilitiesTab } from "./CapabilitiesTab";
import {
  AppNode,
  OutboundEdge,
  InboundEdge,
  MajorApp,
  Investment,
  DiagramRef,
  ConfluencePageRef,
  TcoData,
  ReviewPage,
  AppDetailResponse,
  ImpactApp,
  ImpactBucket,
  BusinessObjectAgg,
  ImpactResponse,
  Tab,
  STATUS_COLORS,
} from "./_shared/types";
import { Panel } from "./_shared/Panel";
import { EmptyState } from "./_shared/EmptyState";
import { Kpi } from "./_shared/Kpi";
import { StatusPill } from "./_shared/StatusPill";
import { CmdbField } from "./_shared/CmdbField";
import { TabButton } from "./_shared/TabButton";
import { ConfluenceTab } from "./tabs/ConfluenceTab";
import { InvestmentsTab } from "./tabs/InvestmentsTab";

export default function AppDetailPage() {
  const params = useParams();
  const appId = decodeURIComponent(params.app_id as string);
  const [data, setData] = useState<AppDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [deployCount, setDeployCount] = useState<number | undefined>(undefined);
  const [capCount, setCapCount] = useState<number | undefined>(undefined);

  // Fetch deployment count for tab badge (non-blocking)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/masters/applications/${encodeURIComponent(appId)}/deployment`);
        const j = await r.json();
        if (j.success && j.data?.summary) {
          const s = j.data.summary;
          setDeployCount(s.servers + s.containers + s.databases + (s.object_storage || 0) + (s.nas || 0));
        }
      } catch { /* non-blocking */ }
    })();
  }, [appId]);

  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/apps/${encodeURIComponent(appId)}/business-capabilities`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        if (j.success) setCapCount(j.data.total_count);
      } catch {
        // silently ignore; badge just stays hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/graph/nodes/${encodeURIComponent(appId)}`, {
          cache: "no-store",
        });
        if (res.status === 404) {
          if (!cancelled) setErr("not-found");
          return;
        }
        if (!res.ok) throw new Error(`${res.status}`);
        const j = await res.json();
        if (!j.success) throw new Error(j.error || "API error");
        if (!cancelled) setData(j.data as AppDetailResponse);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (loading) {
    return <LoadingState appId={appId} />;
  }
  if (err === "not-found") {
    return <NotFoundState appId={appId} />;
  }
  if (err || !data) {
    return (
      <div style={{ padding: 40, color: "var(--error)" }}>
        Failed to load: {err || "unknown error"}
      </div>
    );
  }

  const { app, investments, diagrams, confluence_pages, tco, review_pages } = data;
  const reviewCount = (review_pages || []).length;

  return (
    <div>
      {/* ---------------- Header ---------------- */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--text-dim)",
            marginBottom: 8,
          }}
        >
          <Link href="/" style={{ color: "var(--text-dim)" }}>
            Home
          </Link>
          <span style={{ margin: "0 6px" }}>/</span>
          Application
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            {app.app_id}
          </code>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 600,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {app.name || "(unnamed)"}
          </h1>
          <StatusPill status={app.status} />
          {app.cmdb_linked && <Pill label="CMDB" tone="accent" size="sm" />}
          {app.app_ownership && <Pill label={app.app_ownership} tone="info" />}
          {app.portfolio_mgt && <Pill label={app.portfolio_mgt} tone="neutral" />}
        </div>
        {app.description && (
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              marginTop: 10,
              maxWidth: 760,
              lineHeight: 1.55,
            }}
          >
            {app.description.length > 280
              ? app.description.slice(0, 280) + "…"
              : app.description}
          </p>
        )}
      </div>

      {/* ---------------- Tab nav ---------------- */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderBottom: "1px solid var(--border-strong)",
          marginBottom: 20,
        }}
      >
        <TabButton current={tab} value="overview" onClick={setTab}>
          Overview
        </TabButton>
        <TabButton
          current={tab}
          value="capabilities"
          onClick={setTab}
          count={capCount}
        >
          Capabilities
        </TabButton>
        <TabButton current={tab} value="integrations" onClick={setTab}>
          Integrations
        </TabButton>
        <TabButton current={tab} value="deployment" onClick={setTab}
          count={deployCount}>
          Deployment
        </TabButton>
        <TabButton current={tab} value="impact" onClick={setTab}>
          Impact Analysis
        </TabButton>
        <TabButton current={tab} value="investments" onClick={setTab} count={investments.length}>
          Investments
        </TabButton>
        <TabButton current={tab} value="diagrams" onClick={setTab} count={diagrams.length}>
          Diagrams
        </TabButton>
        <TabButton current={tab} value="confluence" onClick={setTab} count={reviewCount}>
          Confluence
        </TabButton>
        <TabButton current={tab} value="knowledge" onClick={setTab}>
          Knowledge Base
        </TabButton>
      </div>

      {/* ---------------- Tab content ---------------- */}
      {tab === "overview" && (
        <OverviewTab
          app={app}
          investments={investments}
          confluencePages={confluence_pages}
          tco={tco}
        />
      )}
      {tab === "capabilities" && <CapabilitiesTab appId={app.app_id} />}
      {tab === "integrations" && <IntegrationsTab appId={app.app_id} />}
      {tab === "impact" && <ImpactTab appId={app.app_id} />}
      {tab === "investments" && <InvestmentsTab investments={investments} />}
      {tab === "diagrams" && <DiagramsTab diagrams={diagrams} />}
      {tab === "confluence" && <ConfluenceTab pages={review_pages || []} />}
      {tab === "deployment" && <DeploymentTab appId={app.app_id} />}
      {tab === "knowledge" && <KnowledgeBaseTab appId={app.app_id} />}
    </div>
  );
}

// ---------------- Impact (Reverse Dependency) ----------------
function ImpactTab({ appId }: { appId: string }) {
  const [depth, setDepth] = useState<number>(2);
  const [data, setData] = useState<ImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/graph/nodes/${encodeURIComponent(appId)}/impact?depth=${depth}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        if (!j.success) {
          setErr(j.error || "Impact analysis failed");
          return;
        }
        setData(j.data as ImpactResponse);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, depth]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* Header + depth selector */}
      <Panel title="Reverse dependency — who calls this app">
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.55,
            marginTop: 0,
            marginBottom: 14,
            maxWidth: 720,
          }}
        >
          Traverses <code style={{ fontFamily: "var(--font-mono)" }}>INTEGRATES_WITH</code>{" "}
          edges in reverse. Use this to answer &quot;if I change or sunset this app, who
          upstream breaks?&quot;
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text-dim)",
              marginRight: 8,
            }}
          >
            Depth
          </span>
          {[1, 2, 3].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              style={{
                background: depth === d ? "var(--accent)" : "transparent",
                color: depth === d ? "#000" : "var(--text-muted)",
                border: `1px solid ${
                  depth === d ? "var(--accent)" : "var(--border-strong)"
                }`,
                padding: "5px 14px",
                borderRadius: "var(--radius-md)",
                fontSize: 12,
                fontWeight: depth === d ? 600 : 400,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              {d}-hop
            </button>
          ))}
          {loading && (
            <span style={{ marginLeft: 12, color: "var(--text-dim)", fontSize: 11 }}>
              loading…
            </span>
          )}
        </div>
      </Panel>

      {err && (
        <div
          style={{
            padding: 16,
            color: "var(--error)",
            border: "1px solid var(--error)",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
          }}
        >
          {err}
        </div>
      )}

      {data && (
        <>
          {/* Summary KPIs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            <Kpi label="Upstream callers" value={data.total_upstream} />
            <Kpi label="Distinct business objects" value={data.business_objects.length} />
            <Kpi label="Depth searched" value={`${data.depth}-hop`} />
          </div>

          {data.truncated_at_cypher_limit && (
            <div
              style={{
                padding: 10,
                background: "rgba(246,166,35,0.08)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius-md)",
                fontSize: 12,
                color: "var(--accent)",
              }}
            >
              ⚠ Result set hit the query budget. Shown upstream counts may undercount at
              higher depths. Narrow by reducing depth.
            </div>
          )}

          {/* By distance */}
          {data.by_distance.length === 0 ? (
            <Panel title="Upstream apps">
              <EmptyState>
                No upstream callers found. This app has no incoming{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>INTEGRATES_WITH</code>{" "}
                edges within {data.depth} hop{data.depth > 1 ? "s" : ""}.
              </EmptyState>
            </Panel>
          ) : (
            data.by_distance.map((bucket) => (
              <DistanceBucket key={bucket.distance} bucket={bucket} fanOutCap={data.fan_out_cap} />
            ))
          )}

          {/* Business objects */}
          {data.business_objects.length > 0 && (
            <Panel
              title={`Directly impacted business objects (top ${data.business_objects.length})`}
            >
              <p
                style={{
                  color: "var(--text-dim)",
                  fontSize: 11,
                  marginTop: 0,
                  marginBottom: 14,
                }}
              >
                Counted from the edge closest to {appId} on each upstream path.
              </p>
              <div style={{ display: "grid", gap: 4 }}>
                {data.business_objects.map((bo) => (
                  <div
                    key={bo.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 12px",
                      background: "var(--bg-elevated)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        color: bo.name === "Unlabeled" ? "var(--text-dim)" : "var(--text)",
                        fontStyle: bo.name === "Unlabeled" ? "italic" : "normal",
                      }}
                    >
                      {bo.name}
                    </span>
                    <BOBar count={bo.count} max={data.business_objects[0].count} />
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function DistanceBucket({
  bucket,
  fanOutCap,
}: {
  bucket: ImpactBucket;
  fanOutCap: number;
}) {
  const over = bucket.total > fanOutCap;
  return (
    <Panel
      title={`Distance ${bucket.distance} — ${bucket.total} app${
        bucket.total === 1 ? "" : "s"
      }${over ? ` (showing top ${fanOutCap})` : ""}`}
    >
      <div style={{ display: "grid", gap: 4 }}>
        {bucket.apps.map((a) => (
          <Link
            key={`${bucket.distance}-${a.app_id}`}
            href={`/apps/${encodeURIComponent(a.app_id)}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 12px",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              color: "var(--text)",
              borderLeft: `2px solid ${
                STATUS_COLORS[a.status] || "var(--border-strong)"
              }`,
              fontSize: 12,
            }}
          >
            <code
              style={{
                fontFamily: "var(--font-mono)",
                minWidth: 110,
                color: a.cmdb_linked ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {a.app_id}
            </code>
            <span style={{ flex: 1, minWidth: 0 }}>{a.name || "(unnamed)"}</span>
            {a.status && (
              <span
                style={{
                  fontSize: 10,
                  color: STATUS_COLORS[a.status] || "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  fontWeight: 600,
                }}
              >
                {a.status}
              </span>
            )}
          </Link>
        ))}
      </div>
      {over && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          {bucket.total - fanOutCap} more app{bucket.total - fanOutCap === 1 ? "" : "s"} at this
          distance are hidden. Use depth-1 to focus on direct callers.
        </div>
      )}
    </Panel>
  );
}

function BOBar({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 80,
          height: 4,
          background: "var(--border)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "var(--accent)",
          }}
        />
      </div>
      <code
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-muted)",
          minWidth: 24,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {count}
      </code>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// (TabButton, StatusPill, CmdbField, Panel, EmptyState moved to _shared/
//  in PR 2 step 2c — see REFACTOR-INVENTORY.md)
// -----------------------------------------------------------------------------

// ---------------- Overview ----------------
function OverviewTab({
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

// ---------------- Integrations ----------------
// Provider/Consumer split with fan-out aggregation per platform.
// Data from /api/masters/applications/{app_id}/integrations (northstar.integration_interface).

interface ConsumerEntry {
  app_id: string | null;
  app_name: string | null;
  account_name?: string | null;
  endpoint?: string | null;
  status?: string | null;
  interface_id: number;
  // Caller's specific route name for this row — differs from the provider
  // card's aggregation label (which for WSO2 is the shared target_endpoint).
  // For WSO2, each caller registers their own interface_name ("route") that
  // maps to the same backend endpoint.
  route_name?: string | null;
}

interface ProviderInterface {
  key: string;
  label: string;
  integration_platform: string;
  interface_name?: string | null;
  api_name?: string | null;
  topic_name?: string | null;
  instance?: string | null;
  location?: string | null;
  business_area?: string | null;
  interface_description?: string | null;
  api_postman_url?: string | null;
  data_mapping_file?: string | null;
  base?: string | null;
  frequency?: string | null;
  interface_owner?: string | null;
  developer?: string | null;
  endpoint?: string | null;
  authentication?: string | null;
  dc?: string | null;
  application_type?: string | null;
  account_name?: string | null;
  statuses: string[];
  consumers: ConsumerEntry[];
}

interface ConsumerRow {
  interface_id: number;
  label: string;
  integration_platform: string;
  interface_name?: string | null;
  api_name?: string | null;
  topic_name?: string | null;
  instance?: string | null;
  provider: { app_id: string | null; app_name: string | null; endpoint?: string | null };
  my_account_name?: string | null;
  my_endpoint?: string | null;
  business_area?: string | null;
  description?: string | null;
  status?: string | null;
  interface_owner?: string | null;
  frequency?: string | null;
  location?: string | null;
  api_postman_url?: string | null;
  data_mapping_file?: string | null;
  base?: string | null;
}

interface IntegrationPayload {
  app_id: string;
  app_name?: string;
  platforms: string[];
  sunset_count: number;
  include_sunset: boolean;
  as_provider: {
    total_interfaces: number;
    total_consumers: number;
    by_platform: Record<
      string,
      { total_interfaces: number; total_consumers: number; interfaces: ProviderInterface[] }
    >;
  };
  as_consumer: {
    total: number;
    by_platform: Record<string, { total: number; rows: ConsumerRow[] }>;
  };
}

const PLATFORM_COLORS: Record<string, string> = {
  WSO2: "#f6a623",
  APIH: "#6ba6e8",
  KPaaS: "#5fc58a",
  Talend: "#e8716b",
  PO: "#a8b0c0",
  "Data Service": "#e8b458",
  Axway: "#9aa4b8",
  "Axway MFT": "#9aa4b8",
  "Goanywhere-job": "#6b7488",
  "Goanywhere-web user": "#6b7488",
};

function integrationStatusColor(status?: string | null): string {
  if (!status) return "var(--text-muted)";
  const s = status.toUpperCase();
  if (s === "SUNSET") return "#6b7488";
  if (s === "MTP") return "#5fc58a";
  if (s === "INIT") return "#e8b458";
  return "var(--text-muted)";
}

function IntegrationStatusPill({ status }: { status?: string | null }) {
  if (!status) return null;
  const color = integrationStatusColor(status);
  return (
    <span
      className="status-pill"
      style={{
        fontSize: 10,
        color,
        background: `${color}26`,
        padding: "2px 8px",
      }}
    >
      {status}
    </span>
  );
}

function IntegrationsTab({ appId }: { appId: string }) {
  const [data, setData] = useState<IntegrationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [includeSunset, setIncludeSunset] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  // View mode for AS PROVIDER section — group by platform (default) or
  // flatten across platforms and sort by consumer count (interface-centric).
  const [providerView, setProviderView] =
    useState<"by_platform" | "by_interface">("by_platform");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (includeSunset) params.set("include_sunset", "true");
        const r = await fetch(
          `/api/masters/applications/${encodeURIComponent(appId)}/integrations?${params}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "Failed to load");
        setData(j.data);
        // Default: select all platforms on first load
        if (j.data.platforms.length > 0 && selectedPlatforms.size === 0) {
          setSelectedPlatforms(new Set(j.data.platforms));
        }
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, includeSunset]);

  if (loading) {
    return <div style={{ color: "var(--text-dim)", padding: 20, fontSize: 13 }}>Loading integrations…</div>;
  }
  if (err) {
    return <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>;
  }
  if (!data) return null;

  const totalProv = data.as_provider.total_interfaces;
  const totalProvConsumers = data.as_provider.total_consumers;
  const totalCons = data.as_consumer.total;

  if (totalProv === 0 && totalCons === 0) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <EmptyState>
          No integration interfaces registered on any platform.
        </EmptyState>
        {data.sunset_count > 0 && !includeSunset && (
          <button
            onClick={() => setIncludeSunset(true)}
            style={{
              alignSelf: "start",
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Show {data.sunset_count} SUNSET interface(s)
          </button>
        )}
      </div>
    );
  }

  const togglePlatform = (p: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const showAll = selectedPlatforms.size === data.platforms.length;
  const setShowAll = () => setSelectedPlatforms(new Set(data.platforms));
  const clearAll = () => setSelectedPlatforms(new Set());

  const visiblePlatforms = data.platforms.filter((p) => selectedPlatforms.has(p));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── Toolbar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          padding: "10px 14px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          PLATFORM
        </span>
        {data.platforms.map((p) => {
          const active = selectedPlatforms.has(p);
          const color = PLATFORM_COLORS[p] || "#5f6a80";
          return (
            <button
              key={p}
              onClick={() => togglePlatform(p)}
              style={{
                border: `1px solid ${active ? color : "var(--border)"}`,
                background: active ? `${color}26` : "transparent",
                color: active ? color : "var(--text-dim)",
                padding: "4px 12px",
                borderRadius: 4,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                whiteSpace: "nowrap",
              }}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={showAll ? clearAll : setShowAll}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--text-dim)",
            fontSize: 11,
            cursor: "pointer",
            padding: "4px 8px",
          }}
        >
          {showAll ? "clear all" : "select all"}
        </button>

        <div style={{ flex: 1 }} />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeSunset}
            onChange={(e) => setIncludeSunset(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          Include SUNSET
          {data.sunset_count > 0 && (
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
              ({data.sunset_count})
            </span>
          )}
        </label>

        <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          {totalProv} provider · {totalCons} consumer
        </span>
      </div>

      {/* ── Integration Landscape (overview) ── */}
      {(totalProv > 0 || totalCons > 0) && (
        <IntegrationLandscape
          appId={appId}
          data={data}
          visiblePlatforms={visiblePlatforms}
        />
      )}

      {/* ── AS PROVIDER section ── */}
      {totalProv > 0 && (
        <SectionHeader
          icon="📤"
          title="AS PROVIDER"
          subtitle={`${totalProv} interfaces · ${totalProvConsumers} consumers`}
          color="#f6a623"
          right={
            <ViewModeToggle
              value={providerView}
              onChange={setProviderView}
            />
          }
        />
      )}
      {totalProv > 0 && (
        <ProviderHotspots
          data={data}
          visiblePlatforms={visiblePlatforms}
        />
      )}
      {totalProv > 0 && providerView === "by_platform" &&
        visiblePlatforms.map((p) => {
          const bucket = data.as_provider.by_platform[p];
          if (!bucket || bucket.interfaces.length === 0) return null;
          return <ProviderPlatformBlock key={p} platform={p} bucket={bucket} />;
        })}
      {totalProv > 0 && providerView === "by_interface" && (
        <ProviderFlatList
          data={data}
          visiblePlatforms={visiblePlatforms}
        />
      )}

      {/* ── AS CONSUMER section ── */}
      {totalCons > 0 && (
        <SectionHeader
          icon="📥"
          title="AS CONSUMER"
          subtitle={`${totalCons} subscription${totalCons === 1 ? "" : "s"}`}
          color="#6ba6e8"
        />
      )}
      {totalCons > 0 &&
        visiblePlatforms.map((p) => {
          const bucket = data.as_consumer.by_platform[p];
          if (!bucket || bucket.rows.length === 0) return null;
          return <ConsumerPlatformBlock key={p} platform={p} bucket={bucket} />;
        })}
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
  color,
  right,
}: {
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0 6px",
        borderBottom: `1px solid var(--border)`,
        borderLeft: `3px solid ${color}`,
        paddingLeft: 10,
        marginBottom: 4,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          color,
          fontWeight: 600,
          letterSpacing: 0.6,
        }}
      >
        {title}
      </span>
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{subtitle}</span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

/* ── View mode toggle: By Platform | By Interface ── */
function ViewModeToggle({
  value,
  onChange,
}: {
  value: "by_platform" | "by_interface";
  onChange: (v: "by_platform" | "by_interface") => void;
}) {
  const opts: { key: "by_platform" | "by_interface"; label: string }[] = [
    { key: "by_platform", label: "By Platform" },
    { key: "by_interface", label: "By Interface" },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
      }}
    >
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              background: active ? "var(--accent-dim)" : "transparent",
              color: active ? "var(--accent)" : "var(--text-dim)",
              border: "none",
              cursor: "pointer",
              borderRight:
                o.key === "by_platform" ? "1px solid var(--border)" : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Provider Hotspots: top interfaces by fan-out (≥2 consumers) ── */
function ProviderHotspots({
  data,
  visiblePlatforms,
}: {
  data: IntegrationPayload;
  visiblePlatforms: string[];
}) {
  const HOTSPOT_COLLAPSED_N = 10;
  const [expanded, setExpanded] = useState(false);
  const visSet = new Set(visiblePlatforms);

  // Flatten all interfaces across visible platforms
  const all: Array<{
    iface: ProviderInterface;
    platform: string;
  }> = [];
  for (const platform of Object.keys(data.as_provider.by_platform)) {
    if (!visSet.has(platform)) continue;
    for (const iface of data.as_provider.by_platform[platform].interfaces) {
      all.push({ iface, platform });
    }
  }
  // Sort by consumer count DESC, then by label
  all.sort((a, b) => {
    const d = b.iface.consumers.length - a.iface.consumers.length;
    if (d !== 0) return d;
    return a.iface.label.localeCompare(b.iface.label);
  });
  // All interfaces with 2+ consumers
  const allHot = all.filter((x) => x.iface.consumers.length >= 2);
  const shown = expanded ? allHot : allHot.slice(0, HOTSPOT_COLLAPSED_N);
  const hiddenCount = allHot.length - shown.length;

  if (allHot.length === 0) return null;

  const scrollToIface = (key: string) => {
    const el = document.getElementById(`iface-${encodeURIComponent(key)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const prev = el.style.boxShadow;
    el.style.transition = "box-shadow 240ms ease";
    el.style.boxShadow = "0 0 0 2px var(--accent)";
    setTimeout(() => { el.style.boxShadow = prev; }, 900);
  };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            fontWeight: 600,
            letterSpacing: 0.6,
          }}
        >
          🔥 INTERFACE HOTSPOTS
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {expanded
            ? `all ${allHot.length} interfaces with 2+ consumers`
            : `top ${shown.length} of ${allHot.length} with 2+ consumers`}
        </span>
        {allHot.length > HOTSPOT_COLLAPSED_N && (
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{
              marginLeft: "auto",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--accent)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              padding: "2px 10px",
              borderRadius: 3,
              cursor: "pointer",
            }}
          >
            {expanded ? "show less" : `show all (${allHot.length})`}
          </button>
        )}
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
        }}
      >
        <tbody>
          {shown.map(({ iface, platform }) => {
            const color = PLATFORM_COLORS[platform] || "#5f6a80";
            const topConsumers = iface.consumers
              .filter((c) => c.app_id && c.app_id !== "__UNLINKED__")
              .slice(0, 4);
            const moreCount = iface.consumers.length - topConsumers.length;
            return (
              <tr
                key={iface.key}
                onClick={() => scrollToIface(iface.key)}
                style={{ cursor: "pointer" }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "var(--surface-hover)";
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.background =
                    "transparent";
                }}
              >
                {/* Fan-out count badge */}
                <td style={{ padding: "6px 8px", width: 48, textAlign: "center" }}>
                  <span
                    style={{
                      display: "inline-block",
                      minWidth: 28,
                      padding: "2px 8px",
                      background: "var(--accent-dim)",
                      color: "var(--accent)",
                      border: "1px solid var(--accent)",
                      borderRadius: 3,
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: 12,
                    }}
                  >
                    {iface.consumers.length}
                  </span>
                </td>
                {/* Interface name */}
                <td
                  style={{
                    padding: "6px 8px",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                    fontWeight: 500,
                  }}
                >
                  {iface.label}
                </td>
                {/* Platform pill */}
                <td style={{ padding: "6px 8px", width: 80 }}>
                  <span
                    className="status-pill"
                    style={{
                      fontSize: 10,
                      color,
                      background: `${color}26`,
                      padding: "2px 8px",
                    }}
                  >
                    {platform}
                  </span>
                </td>
                {/* Top consumers preview */}
                <td
                  style={{
                    padding: "6px 8px",
                    color: "var(--text-muted)",
                    fontSize: 11,
                  }}
                >
                  {topConsumers.map((c, i) => (
                    <span key={c.app_id}>
                      {i > 0 && ", "}
                      <code style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
                        {c.app_id}
                      </code>
                      {c.app_name && <span style={{ color: "var(--text-muted)" }}> {c.app_name}</span>}
                    </span>
                  ))}
                  {moreCount > 0 && (
                    <span style={{ color: "var(--text-dim)" }}> +{moreCount} more</span>
                  )}
                </td>
              </tr>
            );
          })}
          {!expanded && hiddenCount > 0 && (
            <tr
              onClick={() => setExpanded(true)}
              style={{ cursor: "pointer" }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "var(--surface-hover)";
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.background =
                  "transparent";
              }}
            >
              <td colSpan={4} style={{
                padding: "8px 8px",
                textAlign: "center",
                color: "var(--accent)",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                borderTop: "1px dashed var(--border)",
              }}>
                +{hiddenCount} more hotspots — click to show all
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Provider flat list: all interfaces sorted by fan-out, no platform groups ── */
function ProviderFlatList({
  data,
  visiblePlatforms,
}: {
  data: IntegrationPayload;
  visiblePlatforms: string[];
}) {
  const visSet = new Set(visiblePlatforms);
  const all: Array<{ iface: ProviderInterface; platform: string }> = [];
  for (const platform of Object.keys(data.as_provider.by_platform)) {
    if (!visSet.has(platform)) continue;
    for (const iface of data.as_provider.by_platform[platform].interfaces) {
      all.push({ iface, platform });
    }
  }
  all.sort((a, b) => {
    const d = b.iface.consumers.length - a.iface.consumers.length;
    if (d !== 0) return d;
    return a.iface.label.localeCompare(b.iface.label);
  });

  if (all.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {all.map(({ iface, platform }) => (
        <ProviderInterfaceCard
          key={iface.key}
          iface={iface}
          platform={platform}
        />
      ))}
    </div>
  );
}

// ---------------- Integration Landscape (SVG overview) ----------------
// 5-column flow: Upstream apps → consumer-side platforms → ME → provider-side platforms → Downstream apps
// Bezier curves connect nodes, stroke width ∝ interface count.
//
// Data is derived from the same IntegrationPayload — we re-index:
//   consumer side: for each consumer row, group by provider.app_id → counts by platform
//   provider side: for each provider interface, group by consumer.app_id → counts by platform
// Platforms appear once per side; the same platform (e.g., KPaaS) can appear on both sides.

const MAX_APPS_PER_SIDE = 12;   // show top N apps; rest folded into "+X more"
const MAX_STROKE_WIDTH = 6;      // clamp for very large fan-outs
const MIN_STROKE_WIDTH = 1;

interface LandscapeAppNode {
  app_id: string;            // or "__UNLINKED__" for apps without CMDB ID
  app_name: string;
  total_interfaces: number;
  by_platform: Record<string, number>;  // platform → interface count
  // Full list of interfaces for this peer, used when the user expands the
  // node (+/- toggle) to see the specific interface names.
  interfaces: Array<{
    platform: string;
    label: string;         // interface_name / api_name / topic_name
    status?: string | null;
    interface_id?: number; // for scrolling to the exact card
  }>;
}

function buildLandscapeData(
  data: IntegrationPayload,
  visiblePlatforms: string[],
): {
  upstream_apps: LandscapeAppNode[];
  downstream_apps: LandscapeAppNode[];
  upstream_platforms: string[];
  downstream_platforms: string[];
  upstream_platform_totals: Record<string, number>;
  downstream_platform_totals: Record<string, number>;
} {
  const visSet = new Set(visiblePlatforms);

  // Upstream: for each consumer row (I'm consumer, provider is source/target depending on platform)
  const upstreamMap: Record<string, LandscapeAppNode> = {};
  const upstreamPlatformTotals: Record<string, number> = {};
  const upstreamPlatforms = new Set<string>();
  for (const platform of Object.keys(data.as_consumer.by_platform)) {
    if (!visSet.has(platform)) continue;
    const bucket = data.as_consumer.by_platform[platform];
    for (const row of bucket.rows) {
      const pid = row.provider.app_id || "__UNLINKED__";
      const pname = row.provider.app_name || "(unlinked)";
      if (!upstreamMap[pid]) {
        upstreamMap[pid] = {
          app_id: pid, app_name: pname, total_interfaces: 0,
          by_platform: {}, interfaces: [],
        };
      }
      upstreamMap[pid].total_interfaces++;
      upstreamMap[pid].by_platform[platform] = (upstreamMap[pid].by_platform[platform] || 0) + 1;
      upstreamMap[pid].interfaces.push({
        platform,
        label: row.label,
        status: row.status,
        interface_id: row.interface_id,
      });
      upstreamPlatformTotals[platform] = (upstreamPlatformTotals[platform] || 0) + 1;
      upstreamPlatforms.add(platform);
    }
  }

  // Downstream: for each provider interface, each consumer
  const downstreamMap: Record<string, LandscapeAppNode> = {};
  const downstreamPlatformTotals: Record<string, number> = {};
  const downstreamPlatforms = new Set<string>();
  for (const platform of Object.keys(data.as_provider.by_platform)) {
    if (!visSet.has(platform)) continue;
    const bucket = data.as_provider.by_platform[platform];
    for (const iface of bucket.interfaces) {
      for (const c of iface.consumers) {
        const cid = c.app_id || "__UNLINKED__";
        const cname = c.app_name || "(unlinked)";
        if (!downstreamMap[cid]) {
          downstreamMap[cid] = {
            app_id: cid, app_name: cname, total_interfaces: 0,
            by_platform: {}, interfaces: [],
          };
        }
        downstreamMap[cid].total_interfaces++;
        downstreamMap[cid].by_platform[platform] = (downstreamMap[cid].by_platform[platform] || 0) + 1;
        downstreamMap[cid].interfaces.push({
          platform,
          label: iface.label,
          status: c.status ?? undefined,
          interface_id: c.interface_id,
        });
        downstreamPlatformTotals[platform] = (downstreamPlatformTotals[platform] || 0) + 1;
        downstreamPlatforms.add(platform);
      }
    }
  }

  const upstream_apps = Object.values(upstreamMap).sort(
    (a, b) => b.total_interfaces - a.total_interfaces,
  );
  const downstream_apps = Object.values(downstreamMap).sort(
    (a, b) => b.total_interfaces - a.total_interfaces,
  );

  return {
    upstream_apps,
    downstream_apps,
    upstream_platforms: [...upstreamPlatforms].sort(),
    downstream_platforms: [...downstreamPlatforms].sort(),
    upstream_platform_totals: upstreamPlatformTotals,
    downstream_platform_totals: downstreamPlatformTotals,
  };
}

function IntegrationLandscape({
  appId,
  data,
  visiblePlatforms,
}: {
  appId: string;
  data: IntegrationPayload;
  visiblePlatforms: string[];
}) {
  const landscape = buildLandscapeData(data, visiblePlatforms);

  // Expansion state: per-app (+/- toggle) + "show all" for each side
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const [showAllUpstream, setShowAllUpstream] = useState(false);
  const [showAllDownstream, setShowAllDownstream] = useState(false);

  const toggleAppExpand = (side: "up" | "down", appId: string) => {
    setExpandedApps((prev) => {
      const key = `${side}:${appId}`;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (
    landscape.upstream_apps.length === 0 &&
    landscape.downstream_apps.length === 0
  ) {
    return null;
  }

  // Slice to visible apps (show all or top N)
  const upstreamVisible = showAllUpstream
    ? landscape.upstream_apps
    : landscape.upstream_apps.slice(0, MAX_APPS_PER_SIDE);
  const upstreamHiddenCount = landscape.upstream_apps.length - upstreamVisible.length;
  const downstreamVisible = showAllDownstream
    ? landscape.downstream_apps
    : landscape.downstream_apps.slice(0, MAX_APPS_PER_SIDE);
  const downstreamHiddenCount = landscape.downstream_apps.length - downstreamVisible.length;

  // SVG layout constants
  const COL_PAD = 16;
  const APP_BOX_W = 210;          // wider to fit more of the interface name
  const APP_BASE_H = 38;          // collapsed height
  const APP_IFACE_ROW_H = 13;     // each interface name row when expanded
  const APP_EXPAND_PAD = 6;       // padding above/below the interface list
  const APP_GAP = 6;
  const PLATFORM_BOX_W = 80;
  const PLATFORM_BOX_H = 46;
  const PLATFORM_GAP = 12;
  // ME composite: center rectangle + two ports that OVERLAY the ME's left/right
  // edges (each port is centered on the edge, half inside / half outside ME).
  // Total horizontal span = ME_CENTER_W + ME_PORT_W (one port-width spread
  // across both edges combined).
  const ME_CENTER_W = 210;
  const ME_PORT_W = 32;
  const ME_PORT_H = 76;           // shorter than ME for visual contrast
  const ME_BOX_W = ME_CENTER_W + ME_PORT_W;  // total composite incl. overlaps
  const ME_BOX_H = 120;

  const cols = {
    upstream_apps: { x: 0, w: APP_BOX_W },
    upstream_platforms: { x: APP_BOX_W + COL_PAD + 30, w: PLATFORM_BOX_W },
    me: { x: APP_BOX_W + COL_PAD + 30 + PLATFORM_BOX_W + COL_PAD + 30, w: ME_BOX_W },
    downstream_platforms: {
      x: APP_BOX_W + COL_PAD + 30 + PLATFORM_BOX_W + COL_PAD + 30 + ME_BOX_W + COL_PAD + 30,
      w: PLATFORM_BOX_W,
    },
    downstream_apps: {
      x:
        APP_BOX_W + COL_PAD + 30 + PLATFORM_BOX_W + COL_PAD + 30 + ME_BOX_W + COL_PAD + 30 +
        PLATFORM_BOX_W + COL_PAD + 30,
      w: APP_BOX_W,
    },
  };
  const svgWidth = cols.downstream_apps.x + APP_BOX_W + 10;

  // Compute per-app rendered height given expansion state
  const appHeight = (node: LandscapeAppNode, expanded: boolean) =>
    expanded
      ? APP_BASE_H + node.interfaces.length * APP_IFACE_ROW_H + APP_EXPAND_PAD * 2
      : APP_BASE_H;

  // Heights for each row in the upstream/downstream app columns (including +N more placeholder)
  const upstreamHeights = upstreamVisible.map((app) =>
    appHeight(app, expandedApps.has(`up:${app.app_id}`)),
  );
  if (upstreamHiddenCount > 0) upstreamHeights.push(APP_BASE_H);

  const downstreamHeights = downstreamVisible.map((app) =>
    appHeight(app, expandedApps.has(`down:${app.app_id}`)),
  );
  if (downstreamHiddenCount > 0) downstreamHeights.push(APP_BASE_H);

  const sumH = (heights: number[]) =>
    heights.reduce((s, h) => s + h, 0) + Math.max(0, heights.length - 1) * APP_GAP;

  const upstreamColH = sumH(upstreamHeights);
  const downstreamColH = sumH(downstreamHeights);
  const upstreamPlatformsColH =
    landscape.upstream_platforms.length * (PLATFORM_BOX_H + PLATFORM_GAP);
  const downstreamPlatformsColH =
    landscape.downstream_platforms.length * (PLATFORM_BOX_H + PLATFORM_GAP);
  const contentHeight = Math.max(
    upstreamColH,
    downstreamColH,
    upstreamPlatformsColH,
    downstreamPlatformsColH,
    ME_BOX_H + 40,
    200,
  );
  const svgHeight = contentHeight + 40;
  const centerY = svgHeight / 2;

  // Position helpers that use cumulative heights
  const cumulativeYs = (heights: number[], totalH: number) => {
    const ys: number[] = [];
    let y = centerY - totalH / 2;
    for (const h of heights) {
      ys.push(y);
      y += h + APP_GAP;
    }
    return ys;
  };
  const upstreamYs = cumulativeYs(upstreamHeights, upstreamColH);
  const downstreamYs = cumulativeYs(downstreamHeights, downstreamColH);

  const posUpstreamPlatform = (idx: number) => {
    const total = landscape.upstream_platforms.length;
    const groupH = total * (PLATFORM_BOX_H + PLATFORM_GAP) - PLATFORM_GAP;
    const startY = centerY - groupH / 2;
    return { x: cols.upstream_platforms.x, y: startY + idx * (PLATFORM_BOX_H + PLATFORM_GAP) };
  };
  const posDownstreamPlatform = (idx: number) => {
    const total = landscape.downstream_platforms.length;
    const groupH = total * (PLATFORM_BOX_H + PLATFORM_GAP) - PLATFORM_GAP;
    const startY = centerY - groupH / 2;
    return { x: cols.downstream_platforms.x, y: startY + idx * (PLATFORM_BOX_H + PLATFORM_GAP) };
  };
  const mePos = { x: cols.me.x, y: centerY - ME_BOX_H / 2 };

  // Curve stroke width from count
  const strokeWidth = (count: number) => {
    return Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, count));
  };

  // Index for quick lookup
  const upstreamPlatformIdx: Record<string, number> = {};
  landscape.upstream_platforms.forEach((p, i) => { upstreamPlatformIdx[p] = i; });
  const downstreamPlatformIdx: Record<string, number> = {};
  landscape.downstream_platforms.forEach((p, i) => { downstreamPlatformIdx[p] = i; });

  // Curves anchor to the header band of each app box (near the top, not the
  // middle) so expanding a box doesn't pull the curves downward.
  const appAnchorY = (boxY: number) => boxY + 20;

  // Stagger curve endpoints on the app side when a peer uses multiple platforms,
  // so the lines don't visually collapse into one at the app box edge.
  // Each curve's y-endpoint is offset by (idx - (N-1)/2) * staggerPx.
  const STAGGER_PX = 5;
  const staggeredY = (baseY: number, idx: number, total: number) =>
    baseY + (idx - (total - 1) / 2) * STAGGER_PX;

  const upstreamCurves: React.ReactElement[] = [];
  upstreamVisible.forEach((app, i) => {
    const boxY = upstreamYs[i];
    const platforms = Object.entries(app.by_platform);
    platforms.forEach(([platform, count], pi) => {
      const pIdx = upstreamPlatformIdx[platform];
      if (pIdx === undefined) return;
      const pPos = posUpstreamPlatform(pIdx);
      const x1 = cols.upstream_apps.x + APP_BOX_W;
      const y1 = staggeredY(appAnchorY(boxY), pi, platforms.length);
      const x2 = pPos.x;
      const y2 = pPos.y + PLATFORM_BOX_H / 2;
      const midX = (x1 + x2) / 2;
      upstreamCurves.push(
        <path
          key={`uc-${app.app_id}-${platform}`}
          d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
          stroke={PLATFORM_COLORS[platform] || "#5f6a80"}
          strokeOpacity={0.4}
          strokeWidth={strokeWidth(count)}
          fill="none"
        />,
      );
    });
  });
  const meLeftY = mePos.y + ME_BOX_H / 2;
  landscape.upstream_platforms.forEach((platform, i) => {
    const pPos = posUpstreamPlatform(i);
    const total = landscape.upstream_platform_totals[platform] || 1;
    const x1 = pPos.x + PLATFORM_BOX_W;
    const y1 = pPos.y + PLATFORM_BOX_H / 2;
    const x2 = mePos.x;
    const midX = (x1 + x2) / 2;
    upstreamCurves.push(
      <path
        key={`up-me-${platform}`}
        d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${meLeftY}, ${x2} ${meLeftY}`}
        stroke={PLATFORM_COLORS[platform] || "#5f6a80"}
        strokeOpacity={0.55}
        strokeWidth={strokeWidth(total)}
        fill="none"
      />,
    );
  });

  const downstreamCurves: React.ReactElement[] = [];
  const meRightY = mePos.y + ME_BOX_H / 2;
  landscape.downstream_platforms.forEach((platform, i) => {
    const pPos = posDownstreamPlatform(i);
    const total = landscape.downstream_platform_totals[platform] || 1;
    const x1 = mePos.x + ME_BOX_W;
    const x2 = pPos.x;
    const y2 = pPos.y + PLATFORM_BOX_H / 2;
    const midX = (x1 + x2) / 2;
    downstreamCurves.push(
      <path
        key={`me-down-${platform}`}
        d={`M ${x1} ${meRightY} C ${midX} ${meRightY}, ${midX} ${y2}, ${x2} ${y2}`}
        stroke={PLATFORM_COLORS[platform] || "#5f6a80"}
        strokeOpacity={0.55}
        strokeWidth={strokeWidth(total)}
        fill="none"
      />,
    );
  });
  downstreamVisible.forEach((app, i) => {
    const boxY = downstreamYs[i];
    const platforms = Object.entries(app.by_platform);
    platforms.forEach(([platform, count], pi) => {
      const pIdx = downstreamPlatformIdx[platform];
      if (pIdx === undefined) return;
      const pPos = posDownstreamPlatform(pIdx);
      const x1 = pPos.x + PLATFORM_BOX_W;
      const y1 = pPos.y + PLATFORM_BOX_H / 2;
      const x2 = cols.downstream_apps.x;
      const y2 = staggeredY(appAnchorY(boxY), pi, platforms.length);
      const midX = (x1 + x2) / 2;
      downstreamCurves.push(
        <path
          key={`dc-${app.app_id}-${platform}`}
          d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
          stroke={PLATFORM_COLORS[platform] || "#5f6a80"}
          strokeOpacity={0.4}
          strokeWidth={strokeWidth(count)}
          fill="none"
        />,
      );
    });
  });

  const totalUpstream = landscape.upstream_apps.reduce((s, a) => s + a.total_interfaces, 0);
  const totalDownstream = landscape.downstream_apps.reduce((s, a) => s + a.total_interfaces, 0);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--surface)",
        padding: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            letterSpacing: 0.6,
            fontWeight: 600,
          }}
        >
          INTEGRATION LANDSCAPE
        </span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {landscape.upstream_apps.length} providers · {totalUpstream} interfaces ◀ me ▶ {totalDownstream} interfaces · {landscape.downstream_apps.length} consumers
        </span>
      </div>

      {/* SVG — centered horizontally when it fits; scrolls when it doesn't */}
      <div style={{ overflowX: "auto", textAlign: "center" }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ display: "inline-block", margin: "0 auto" }}
        >
          {/* Column labels */}
          <g fontFamily="var(--font-mono)" fontSize="9" fill="var(--text-dim)" style={{ letterSpacing: 0.6 }}>
            <text x={cols.upstream_apps.x} y={16}>UPSTREAM</text>
            <text x={cols.upstream_platforms.x} y={16}>via</text>
            <text x={cols.me.x + 20} y={16}>ME</text>
            <text x={cols.downstream_platforms.x} y={16}>via</text>
            <text x={cols.downstream_apps.x} y={16}>DOWNSTREAM</text>
          </g>

          {/* Curves (drawn first, under nodes) */}
          {upstreamCurves}
          {downstreamCurves}

          {/* Upstream apps */}
          {upstreamVisible.map((app, i) => (
            <LandscapeAppBox
              key={`ua-${app.app_id}`}
              x={cols.upstream_apps.x}
              y={upstreamYs[i]}
              w={APP_BOX_W}
              h={upstreamHeights[i]}
              baseH={APP_BASE_H}
              ifaceRowH={APP_IFACE_ROW_H}
              expandPad={APP_EXPAND_PAD}
              node={app}
              side="upstream"
              expanded={expandedApps.has(`up:${app.app_id}`)}
              onToggleExpand={() => toggleAppExpand("up", app.app_id)}
            />
          ))}
          {upstreamHiddenCount > 0 && (
            <MorePlaceholderBox
              x={cols.upstream_apps.x}
              y={upstreamYs[upstreamVisible.length]}
              w={APP_BOX_W}
              h={APP_BASE_H}
              count={upstreamHiddenCount}
              onClick={() => setShowAllUpstream(true)}
            />
          )}
          {showAllUpstream && landscape.upstream_apps.length > MAX_APPS_PER_SIDE && (
            <g
              transform={`translate(${cols.upstream_apps.x + APP_BOX_W - 56}, ${upstreamYs[0] - 18})`}
              style={{ cursor: "pointer" }}
              onClick={() => setShowAllUpstream(false)}
            >
              <rect width={52} height={14} rx={3} fill="var(--bg-elevated)" stroke="var(--border)" />
              <text x={26} y={10} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-muted)">
                show less
              </text>
            </g>
          )}

          {/* Upstream platforms */}
          {landscape.upstream_platforms.map((platform, i) => {
            const p = posUpstreamPlatform(i);
            const total = landscape.upstream_platform_totals[platform] || 0;
            return <LandscapePlatformBox key={`up-${platform}`} x={p.x} y={p.y} w={PLATFORM_BOX_W} h={PLATFORM_BOX_H} platform={platform} total={total} />;
          })}

          {/* ME */}
          <LandscapeMeBox
            x={mePos.x}
            y={mePos.y}
            w={ME_BOX_W}
            h={ME_BOX_H}
            portW={ME_PORT_W}
            portH={ME_PORT_H}
            centerW={ME_CENTER_W}
            appId={appId}
            appName={data.app_name || ""}
            provCount={totalDownstream}
            consCount={totalUpstream}
          />

          {/* Downstream platforms */}
          {landscape.downstream_platforms.map((platform, i) => {
            const p = posDownstreamPlatform(i);
            const total = landscape.downstream_platform_totals[platform] || 0;
            return <LandscapePlatformBox key={`dp-${platform}`} x={p.x} y={p.y} w={PLATFORM_BOX_W} h={PLATFORM_BOX_H} platform={platform} total={total} />;
          })}

          {/* Downstream apps */}
          {downstreamVisible.map((app, i) => (
            <LandscapeAppBox
              key={`da-${app.app_id}`}
              x={cols.downstream_apps.x}
              y={downstreamYs[i]}
              w={APP_BOX_W}
              h={downstreamHeights[i]}
              baseH={APP_BASE_H}
              ifaceRowH={APP_IFACE_ROW_H}
              expandPad={APP_EXPAND_PAD}
              node={app}
              side="downstream"
              expanded={expandedApps.has(`down:${app.app_id}`)}
              onToggleExpand={() => toggleAppExpand("down", app.app_id)}
            />
          ))}
          {downstreamHiddenCount > 0 && (
            <MorePlaceholderBox
              x={cols.downstream_apps.x}
              y={downstreamYs[downstreamVisible.length]}
              w={APP_BOX_W}
              h={APP_BASE_H}
              count={downstreamHiddenCount}
              onClick={() => setShowAllDownstream(true)}
            />
          )}
          {showAllDownstream && landscape.downstream_apps.length > MAX_APPS_PER_SIDE && (
            <g
              transform={`translate(${cols.downstream_apps.x + APP_BOX_W - 56}, ${downstreamYs[0] - 18})`}
              style={{ cursor: "pointer" }}
              onClick={() => setShowAllDownstream(false)}
            >
              <rect width={52} height={14} rx={3} fill="var(--bg-elevated)" stroke="var(--border)" />
              <text x={26} y={10} textAnchor="middle" fontSize="9" fontFamily="var(--font-mono)" fill="var(--text-muted)">
                show less
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

function MorePlaceholderBox({
  x, y, w, h, count, onClick,
}: {
  x: number; y: number; w: number; h: number;
  count: number;
  onClick: () => void;
}) {
  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{ cursor: "pointer" }}
      onClick={onClick}
    >
      <rect
        width={w}
        height={h}
        rx={4}
        fill="var(--bg-elevated)"
        stroke="var(--accent)"
        strokeOpacity={0.5}
        strokeDasharray="3,3"
      />
      <text
        x={w / 2}
        y={h / 2 + 4}
        textAnchor="middle"
        fill="var(--accent)"
        fontSize="11"
        fontFamily="var(--font-body)"
        style={{ fontWeight: 500 }}
      >
        +{count} more — click to show
      </text>
      <title>Click to show all {count} additional apps</title>
    </g>
  );
}

// Scroll to the first interface card that references a given peer app_id.
// Upstream app (I consume from it) → first ConsumerRowCard with
//    data-peer="{app_id}" (provider.app_id)
// Downstream app (consumer of mine) → first ProviderInterfaceCard with
//    data-peers ~= "{app_id}" (consumer appears in its list)
function scrollToPeerInterface(appId: string, side: "upstream" | "downstream") {
  if (!appId || appId === "__UNLINKED__") return;
  const selector =
    side === "upstream"
      ? `[data-peer="${CSS.escape(appId)}"]`
      : `[data-peers~="${CSS.escape(appId)}"]`;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // Brief visual flash for the landing card
  const prev = el.style.boxShadow;
  el.style.transition = "box-shadow 240ms ease";
  el.style.boxShadow = "0 0 0 2px var(--accent)";
  setTimeout(() => { el.style.boxShadow = prev; }, 900);
}

function LandscapeAppBox({
  x, y, w, h, baseH, ifaceRowH, expandPad, node, side, expanded, onToggleExpand,
}: {
  x: number; y: number; w: number; h: number;
  baseH: number;
  ifaceRowH: number;
  expandPad: number;
  node: LandscapeAppNode;
  side: "upstream" | "downstream";
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const isUnlinked = node.app_id === "__UNLINKED__";
  const canExpand = !isUnlinked && node.interfaces.length > 0;

  const scrollClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    scrollToPeerInterface(node.app_id, side);
  };
  const toggleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleExpand();
  };
  const pointerStyle = { cursor: isUnlinked ? "default" : "pointer" };

  // Sort interfaces by platform, then label, when showing the expanded list
  const sortedIfaces = expanded
    ? [...node.interfaces].sort((a, b) => {
        if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
        return a.label.localeCompare(b.label);
      })
    : [];

  return (
    <g transform={`translate(${x}, ${y})`}>
      <title>
        {isUnlinked
          ? node.app_name
          : `${node.app_id} ${node.app_name} — click ID to open detail; click count to ${expanded ? "collapse" : "show"} interfaces; click elsewhere to jump to the interface list below`}
      </title>
      {/* Background rect — click scrolls to interface list */}
      <rect
        width={w}
        height={h}
        rx={4}
        fill="var(--bg-elevated)"
        stroke={isUnlinked ? "var(--border)" : "var(--border-strong)"}
        strokeDasharray={isUnlinked ? "3,3" : undefined}
        onClick={isUnlinked ? undefined : scrollClick}
        style={pointerStyle}
      />
      {/* Platform dots — visual indicator of which platforms this peer uses.
          Multi-platform peers show multiple colored dots side-by-side. */}
      {!isUnlinked && Object.keys(node.by_platform).length > 0 && (
        <g>
          {Object.keys(node.by_platform)
            .sort()
            .map((platform, pi) => (
              <circle
                key={platform}
                cx={w - 54 - pi * 9}
                cy={9}
                r={3}
                fill={PLATFORM_COLORS[platform] || "#5f6a80"}
                stroke="var(--bg-elevated)"
                strokeWidth={1}
              >
                <title>
                  {`${platform}: ${node.by_platform[platform]} interface${node.by_platform[platform] === 1 ? "" : "s"}`}
                </title>
              </circle>
            ))}
        </g>
      )}
      {/* Name — click scrolls */}
      <text
        x={8}
        y={isUnlinked ? h / 2 - 4 : 28}
        fontFamily="var(--font-body)"
        fontSize="11"
        fill="var(--text)"
        style={{ fontWeight: 500, ...pointerStyle, userSelect: "none" }}
        onClick={isUnlinked ? undefined : scrollClick}
      >
        {node.app_name.length > 28 ? node.app_name.slice(0, 26) + "…" : node.app_name}
      </text>
      {/* Interface count — click TOGGLES expansion (shows interface names) */}
      {canExpand ? (
        <g
          style={{ cursor: "pointer" }}
          onClick={toggleClick}
        >
          {/* tiny clickable badge behind the count + [+/-] */}
          <rect
            x={w - 46}
            y={14}
            width={38}
            height={16}
            rx={3}
            fill={expanded ? "var(--accent)" : "transparent"}
            fillOpacity={expanded ? 0.15 : 0}
            stroke={expanded ? "var(--accent)" : "var(--border-strong)"}
            strokeWidth={1}
          />
          <text
            x={w - 30}
            y={26}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="11"
            fill={expanded ? "var(--accent)" : "var(--text)"}
            style={{ fontWeight: 600, userSelect: "none" }}
          >
            {node.total_interfaces}
          </text>
          <text
            x={w - 14}
            y={26}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize="12"
            fill={expanded ? "var(--accent)" : "var(--text-dim)"}
            style={{ fontWeight: 600, userSelect: "none" }}
          >
            {expanded ? "−" : "+"}
          </text>
        </g>
      ) : (
        <text
          x={w - 8}
          y={isUnlinked ? h / 2 + 12 : 28}
          textAnchor="end"
          fontFamily="var(--font-mono)"
          fontSize="10"
          fill="var(--text-dim)"
          style={{ userSelect: "none" }}
        >
          {node.total_interfaces}
        </text>
      )}
      {/* app_id — wrapped in <a> so it navigates. Only the ID is a link. */}
      {!isUnlinked && (
        <a
          href={`/apps/${encodeURIComponent(node.app_id)}`}
          onClick={(e) => e.stopPropagation()}
        >
          <text
            x={8}
            y={15}
            fontFamily="var(--font-mono)"
            fontSize="10"
            fill="var(--accent)"
            style={{ cursor: "pointer", textDecoration: "underline", userSelect: "none" }}
          >
            {node.app_id}
          </text>
        </a>
      )}

      {/* Expanded interface list */}
      {expanded && sortedIfaces.length > 0 && (
        <g transform={`translate(0, ${baseH + expandPad})`}>
          <line
            x1={6}
            x2={w - 6}
            y1={-expandPad / 2 - 1}
            y2={-expandPad / 2 - 1}
            stroke="var(--border)"
            strokeDasharray="2,3"
          />
          {sortedIfaces.map((iface, i) => {
            const color = PLATFORM_COLORS[iface.platform] || "#5f6a80";
            const isSunset = (iface.status || "").toUpperCase() === "SUNSET";
            const labelMax = 34;
            const shown =
              iface.label.length > labelMax
                ? iface.label.slice(0, labelMax - 1) + "…"
                : iface.label;
            const rowY = i * ifaceRowH + 10;
            return (
              <g key={i}>
                {/* platform tag */}
                <rect
                  x={6}
                  y={rowY - 8}
                  width={26}
                  height={10}
                  rx={2}
                  fill={`${color}20`}
                  stroke="none"
                />
                <text
                  x={19}
                  y={rowY}
                  textAnchor="middle"
                  fontFamily="var(--font-mono)"
                  fontSize="7"
                  fill={color}
                  style={{ fontWeight: 600, letterSpacing: 0.3 }}
                >
                  {iface.platform.slice(0, 5).toUpperCase()}
                </text>
                {/* interface label */}
                <text
                  x={36}
                  y={rowY}
                  fontFamily="var(--font-mono)"
                  fontSize="9"
                  fill={isSunset ? "var(--text-dim)" : "var(--text-muted)"}
                  style={{ textDecoration: isSunset ? "line-through" : undefined }}
                >
                  {shown}
                </text>
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

function LandscapePlatformBox({
  x, y, w, h, platform, total,
}: {
  x: number; y: number; w: number; h: number;
  platform: string; total: number;
}) {
  const color = PLATFORM_COLORS[platform] || "#5f6a80";
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={w}
        height={h}
        rx={4}
        fill={`${color}1a`}
        stroke={color}
        strokeWidth={1.5}
      />
      <text
        x={w / 2}
        y={h / 2 - 3}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="11"
        fill={color}
        style={{ fontWeight: 600 }}
      >
        {platform.length > 10 ? platform.slice(0, 9) + "." : platform}
      </text>
      <text
        x={w / 2}
        y={h / 2 + 14}
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="10"
        fill={color}
        style={{ opacity: 0.8 }}
      >
        {total}
      </text>
      <title>{`${platform}: ${total} interfaces`}</title>
    </g>
  );
}

// Simple word-boundary splitter for center-panel app name.
// SVG has no native wrap; we emit multiple <tspan>s split at word breaks.
function wrapAppName(name: string, maxCharsPerLine: number, maxLines: number): string[] {
  if (!name) return [];
  const words = name.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (tryLine.length <= maxCharsPerLine) {
      cur = tryLine;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
    if (lines.length >= maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If the last line is too long, truncate with ellipsis
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last.length > maxCharsPerLine) {
      lines[lines.length - 1] = last.slice(0, maxCharsPerLine - 1) + "…";
    }
  }
  return lines;
}

function LandscapeMeBox({
  x, y, w, h, appId, appName, provCount, consCount, portW, portH, centerW,
}: {
  x: number; y: number; w: number; h: number;
  appId: string;
  appName?: string;
  provCount: number;
  consCount: number;
  portW: number;     // small port width (overlays ME edge)
  portH: number;     // port height (shorter than ME)
  centerW: number;   // ME center rectangle width; total w = centerW + portW
}) {
  const AMBER = "#f6a623";
  const BLUE = "#6ba6e8";

  // ME center is positioned at x = portW/2 so each port straddles ME's edge
  // (half inside, half outside). Port height is smaller than ME so the ports
  // appear as badges clipped onto the ME edges.
  const meX = portW / 2;
  const leftPortX = 0;                        // composite origin (left port's left edge)
  const rightPortX = centerW;                 // right port straddles right edge of ME
  const portY = (h - portH) / 2;

  // App name wrapped; wider ME center now accommodates ~22 chars per line
  const nameLines = wrapAppName(appName || "", 22, 3);

  const idY = 36;
  const nameStartY = 60;
  const nameLineH = 14;

  // Small helper for port inner text (label rotated -90°, count + arrow stacked)
  const renderPort = (
    xOff: number,
    color: string,
    label: string,
  ) => (
    <g transform={`translate(${xOff}, ${portY})`}>
      <rect
        width={portW}
        height={portH}
        rx={5}
        fill="var(--bg-elevated)"      // opaque fill so it masks the ME edge
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Rotated port label — vertically + horizontally centered in the port */}
      <text
        transform={`rotate(-90, ${portW / 2}, ${portH / 2})`}
        x={portW / 2}
        y={portH / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-mono)"
        fontSize="10"
        fill={color}
        style={{ letterSpacing: "2.5px", fontWeight: 600 }}
      >
        {label}
      </text>
    </g>
  );

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* ── ME center — drawn first so ports render on top of the edges ── */}
      <g transform={`translate(${meX}, 0)`}>
        <rect
          width={centerW}
          height={h}
          rx={6}
          fill="var(--bg-elevated)"
          stroke={AMBER}
          strokeWidth={2.5}
        />
        {/* app_id */}
        <text
          x={centerW / 2}
          y={idY}
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontSize="17"
          fill={AMBER}
          style={{ fontWeight: 600, letterSpacing: 0.3 }}
        >
          {appId}
        </text>
        {/* app_name — multiline, centered */}
        {nameLines.map((line, i) => (
          <text
            key={i}
            x={centerW / 2}
            y={nameStartY + i * nameLineH}
            textAnchor="middle"
            fontFamily="var(--font-body)"
            fontSize="11"
            fill="var(--text)"
            style={{ fontWeight: 500 }}
          >
            {line}
          </text>
        ))}
      </g>

      {/* ── CONSUME port (overlaid on ME's LEFT edge) ── */}
      {renderPort(leftPortX, BLUE, "CONSUME")}

      {/* ── PROVIDE port (overlaid on ME's RIGHT edge) ── */}
      {renderPort(rightPortX, AMBER, "PROVIDE")}
    </g>
  );
}

function ProviderPlatformBlock({
  platform,
  bucket,
}: {
  platform: string;
  bucket: { total_interfaces: number; total_consumers: number; interfaces: ProviderInterface[] };
}) {
  const color = PLATFORM_COLORS[platform] || "#5f6a80";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ color, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
          {platform}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
          {bucket.total_interfaces} published · {bucket.total_consumers} consumer
          {bucket.total_consumers === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {bucket.interfaces.map((iface) => (
          <ProviderInterfaceCard key={iface.key} iface={iface} platform={platform} />
        ))}
      </div>
    </div>
  );
}

function ProviderInterfaceCard({
  iface,
  platform,
}: {
  iface: ProviderInterface;
  platform: string;
}) {
  const hasSunset = iface.statuses.some((s) => s.toUpperCase() === "SUNSET");
  const primaryStatus = iface.statuses.find((s) => s.toUpperCase() !== "SUNSET") || iface.statuses[0];

  // Platform-specific detail rows
  const details: [string, string | null | undefined][] = [];
  if (iface.instance) details.push(["Instance", iface.instance]);
  if (iface.account_name) details.push(["Account", iface.account_name]);
  if (iface.endpoint) details.push(["Endpoint", iface.endpoint]);
  if (iface.authentication) details.push(["Auth", iface.authentication]);
  if (iface.api_postman_url) details.push(["Postman URL", iface.api_postman_url]);
  if (iface.dc) details.push(["DC", iface.dc]);
  if (iface.business_area) details.push(["Business area", iface.business_area]);
  if (iface.frequency) details.push(["Frequency", iface.frequency]);
  if (iface.data_mapping_file) details.push(["Mapping file", iface.data_mapping_file]);
  if (iface.base) details.push(["Base path", iface.base]);
  if (iface.interface_description) details.push(["Description", iface.interface_description]);

  // data-peers: space-separated list of consumer app IDs, used by Landscape
  // "click on downstream app box" → scrollIntoView on the first card that lists
  // that consumer. Empty string if all consumers are unlinked.
  const peerIds = iface.consumers
    .map((c) => c.app_id)
    .filter((id): id is string => !!id && id !== "__UNLINKED__")
    .join(" ");

  return (
    <div
      data-peers={peerIds}
      data-iface-key={iface.key}
      id={`iface-${encodeURIComponent(iface.key)}`}
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "12px 14px",
        background: hasSunset ? "var(--bg-elevated)" : "var(--surface)",
        opacity: hasSunset ? 0.7 : 1,
        scrollMarginTop: 80,
      }}
    >
      {/* Header — interface name + status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--text)",
            fontWeight: 600,
            wordBreak: "break-all",
          }}
        >
          {iface.label}
        </span>
        <div style={{ flex: 1 }} />
        <IntegrationStatusPill status={primaryStatus} />
      </div>

      {/* Details grid */}
      {details.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "4px 16px",
            fontSize: 11,
            color: "var(--text-muted)",
            marginBottom: 10,
          }}
        >
          {details.map(([label, val]) => (
            <div key={label} style={{ display: "flex", gap: 8, minWidth: 0 }}>
              <span style={{ color: "var(--text-dim)", minWidth: 90, flexShrink: 0 }}>
                {label}
              </span>
              <span
                style={{
                  color: "var(--text)",
                  wordBreak: "break-all",
                  fontFamily:
                    label === "Endpoint" ||
                    label === "Postman URL" ||
                    label === "Mapping file" ||
                    label === "Base path"
                      ? "var(--font-mono)"
                      : "inherit",
                  fontSize: label === "Endpoint" || label === "Postman URL" ? 10 : 11,
                }}
              >
                {val}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Consumers list */}
      <div
        style={{
          borderTop: "1px dashed var(--border)",
          paddingTop: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            letterSpacing: 0.6,
            marginBottom: 6,
          }}
        >
          {platform === "KPaaS"
            ? `SUBSCRIBERS (${iface.consumers.length})`
            : `CONSUMERS (${iface.consumers.length})`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {iface.consumers.map((c) => (
            <div
              key={c.interface_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12,
                opacity: c.status?.toUpperCase() === "SUNSET" ? 0.5 : 1,
              }}
            >
              <span style={{ color: "var(--text-dim)", fontSize: 12 }}>→</span>
              {c.app_id ? (
                <Link
                  href={`/apps/${encodeURIComponent(c.app_id)}`}
                  style={{
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    minWidth: 80,
                  }}
                >
                  {c.app_id}
                </Link>
              ) : (
                <span style={{ color: "var(--text-dim)", fontSize: 12, minWidth: 80 }}>
                  (unlinked)
                </span>
              )}
              {c.app_name && (
                <span style={{ color: "var(--text)", fontSize: 12 }}>{c.app_name}</span>
              )}
              {c.account_name && (
                <span
                  style={{
                    color: "var(--text-dim)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  ({c.account_name})
                </span>
              )}
              {/* Caller route name — shown when it differs from the card's
                  aggregation label (primarily WSO2, where each caller has
                  its own interface_name routing to the same target_endpoint). */}
              {c.route_name && c.route_name !== iface.label && (
                <span
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  route: {c.route_name}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <IntegrationStatusPill status={c.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConsumerPlatformBlock({
  platform,
  bucket,
}: {
  platform: string;
  bucket: { total: number; rows: ConsumerRow[] };
}) {
  const color = PLATFORM_COLORS[platform] || "#5f6a80";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ color, fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)" }}>
          {platform}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
          {bucket.total} subscription{bucket.total === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {bucket.rows.map((row) => (
          <ConsumerRowCard key={row.interface_id} row={row} />
        ))}
      </div>
    </div>
  );
}

function ConsumerRowCard({ row }: { row: ConsumerRow }) {
  const isSunset = row.status?.toUpperCase() === "SUNSET";
  const details: [string, string | null | undefined][] = [];
  if (row.my_account_name) details.push(["My account", row.my_account_name]);
  if (row.instance) details.push(["Provider instance", row.instance]);
  if (row.provider.endpoint) details.push(["Provider endpoint", row.provider.endpoint]);
  if (row.my_endpoint) details.push(["My endpoint", row.my_endpoint]);
  if (row.business_area) details.push(["Business area", row.business_area]);
  if (row.api_postman_url) details.push(["Postman URL", row.api_postman_url]);
  if (row.data_mapping_file) details.push(["Mapping file", row.data_mapping_file]);
  if (row.base) details.push(["Base path", row.base]);
  if (row.description) details.push(["Description", row.description]);

  // data-peer: provider's app_id; used by Landscape "click on upstream app box"
  // → scrollIntoView on the first consumer card where this app is the provider
  const peerId = row.provider.app_id && row.provider.app_id !== "__UNLINKED__"
    ? row.provider.app_id : "";

  return (
    <div
      data-peer={peerId}
      style={{
        scrollMarginTop: 80,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "10px 14px",
        background: isSunset ? "var(--bg-elevated)" : "var(--surface)",
        opacity: isSunset ? 0.7 : 1,
      }}
    >
      {/* Header — interface label + provider + status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: details.length > 0 ? 8 : 0,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text)",
            fontWeight: 500,
            wordBreak: "break-all",
          }}
        >
          {row.label}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 11 }}>by</span>
        {row.provider.app_id ? (
          <Link
            href={`/apps/${encodeURIComponent(row.provider.app_id)}`}
            style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            {row.provider.app_id}
          </Link>
        ) : (
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>(unlinked)</span>
        )}
        {row.provider.app_name && (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            {row.provider.app_name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <IntegrationStatusPill status={row.status} />
      </div>

      {/* Details */}
      {details.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "4px 16px",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          {details.map(([label, val]) => (
            <div key={label} style={{ display: "flex", gap: 8, minWidth: 0 }}>
              <span style={{ color: "var(--text-dim)", minWidth: 110, flexShrink: 0 }}>
                {label}
              </span>
              <span
                style={{
                  color: "var(--text)",
                  wordBreak: "break-all",
                  fontFamily:
                    label === "Provider endpoint" ||
                    label === "My endpoint" ||
                    label === "Postman URL" ||
                    label === "Mapping file" ||
                    label === "Base path"
                      ? "var(--font-mono)"
                      : "inherit",
                  fontSize: 11,
                }}
              >
                {val}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// (InvestmentsTab moved to ./tabs/InvestmentsTab.tsx in PR 2 step 2d)
// ---------------- Diagrams ----------------
function DiagramsTab({ diagrams }: { diagrams: DiagramRef[] }) {
  const [view, setView] = useState<"grid" | "list">("grid");
  if (diagrams.length === 0) {
    return (
      <Panel title="Diagrams describing this app">
        <EmptyState>No diagrams found for this application.</EmptyState>
      </Panel>
    );
  }
  const hasAnyThumbnail = diagrams.some((d) => d.attachment_id);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
      }}
    >
      {/* Header with view toggle */}
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="panel-title" style={{ margin: 0 }}>
          Diagrams ({diagrams.length})
        </div>
        {hasAnyThumbnail && (
          <div style={{ display: "flex", gap: 2 }}>
            <button
              onClick={() => setView("grid")}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                background: view === "grid" ? "var(--accent)" : "transparent",
                color: view === "grid" ? "var(--bg)" : "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              ▦ Grid
            </button>
            <button
              onClick={() => setView("list")}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                background: view === "list" ? "var(--accent)" : "transparent",
                color: view === "list" ? "var(--bg)" : "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
                cursor: "pointer",
              }}
            >
              ☰ List
            </button>
          </div>
        )}
      </div>

      {/* Group diagrams by project */}
      {(() => {
        const groups: { key: string; label: string; items: DiagramRef[] }[] = [];
        const byProject = new Map<string, DiagramRef[]>();
        for (const d of diagrams) {
          const k = d.project_id || "_none";
          if (!byProject.has(k)) byProject.set(k, []);
          byProject.get(k)!.push(d);
        }
        // Named projects first, "Other Diagrams" last
        for (const [k, items] of byProject) {
          if (k === "_none") continue;
          const first = items[0];
          const label = `${first.project_id}${first.project_name ? " — " + first.project_name : ""}`;
          groups.push({ key: k, label, items });
        }
        const noProject = byProject.get("_none");
        if (noProject) {
          groups.push({ key: "_none", label: "Other Diagrams", items: noProject });
        }
        return groups.map((g) => (
          <div key={g.key}>
            {groups.length > 1 && (
              <div
                style={{
                  padding: "10px 20px 6px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--accent)",
                  fontFamily: "var(--font-mono)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {g.label}
                <span style={{ color: "var(--text-dim)", fontWeight: 400, marginLeft: 8 }}>
                  ({g.items.length})
                </span>
              </div>
            )}
            {view === "grid" && hasAnyThumbnail ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 1,
                  background: "var(--border)",
                }}
              >
                {g.items.map((d, idx) => (
                  <DiagramCard key={d.diagram_id || d.attachment_id || idx} d={d} />
                ))}
              </div>
            ) : (
              <DiagramList diagrams={g.items} />
            )}
          </div>
        ));
      })()}
    </div>
  );
}

function DiagramCard({ d }: { d: DiagramRef }) {
  const [imgErr, setImgErr] = useState(false);
  const thumbSrc = d.attachment_id
    ? `/api/admin/confluence/attachments/${d.attachment_id}/thumbnail`
    : null;
  const linkTarget = d.page_id ? `/admin/confluence/${d.page_id}` : null;

  const card = (
    <div
      style={{
        background: "var(--surface)",
        padding: 0,
        display: "flex",
        flexDirection: "column",
        cursor: linkTarget ? "pointer" : "default",
        transition: "background var(--t-hover) var(--ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface)";
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          height: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {thumbSrc && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={d.file_name || "diagram"}
            loading="lazy"
            onError={() => setImgErr(true)}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {d.diagram_type || d.file_kind || "DRAWIO"}
          </span>
        )}
      </div>

      {/* Info area */}
      <div style={{ padding: "10px 14px" }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={d.file_name || ""}
        >
          {d.file_name || "(unnamed)"}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 6,
            alignItems: "center",
          }}
        >
          {d.fiscal_year && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                color: "var(--accent)",
                fontFamily: "var(--font-mono)",
                background: "rgba(246,166,35,0.08)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {d.fiscal_year}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
            }}
          >
            {d.diagram_type || d.file_kind || "drawio"}
          </span>
        </div>
        {d.page_title && (
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={d.page_title}
          >
            {d.page_title}
          </div>
        )}
      </div>
    </div>
  );

  if (linkTarget) {
    return (
      <Link href={linkTarget} style={{ textDecoration: "none", color: "inherit" }}>
        {card}
      </Link>
    );
  }
  return card;
}

function DiagramList({ diagrams }: { diagrams: DiagramRef[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {diagrams.map((d, idx) => (
        <li
          key={d.diagram_id || d.attachment_id || idx}
          style={{
            padding: "10px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{
            fontSize: 10, padding: "2px 8px",
            background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)", color: "var(--text-muted)",
            fontFamily: "var(--font-mono)", textTransform: "uppercase",
          }}>
            {d.diagram_type || d.file_kind || "drawio"}
          </span>
          {d.fiscal_year && (
            <span style={{ fontSize: 10, padding: "2px 8px", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              {d.fiscal_year}
            </span>
          )}
          {d.page_id ? (
            <Link
              href={`/admin/confluence/${d.page_id}`}
              style={{ flex: 1, fontSize: 13, color: "var(--text)" }}
              title={d.page_title || ""}
            >
              {d.file_name || "(unnamed)"}
            </Link>
          ) : (
            <span style={{ flex: 1, fontSize: 13 }}>{d.file_name || "(unnamed)"}</span>
          )}
          {d.page_title && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{d.page_title}</span>
          )}
          {d.source_systems && d.source_systems.length > 0 && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {d.source_systems.join("+")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------- Error states ----------------
function LoadingState({ appId }: { appId: string }) {
  return (
    <div style={{ padding: 40, color: "var(--text-dim)", fontSize: 13 }}>
      Loading {appId}…
    </div>
  );
}

function NotFoundState({ appId }: { appId: string }) {
  return (
    <div
      style={{
        padding: 40,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          marginBottom: 6,
        }}
      >
        App not found
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        No application with id <code style={{ fontFamily: "var(--font-mono)" }}>{appId}</code> exists in
        the graph.
      </div>
      <Link
        href="/"
        style={{
          display: "inline-block",
          background: "var(--accent)",
          color: "#000",
          padding: "8px 16px",
          borderRadius: "var(--radius-md)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        Back to home
      </Link>
    </div>
  );
}

// ---------------- Confluence Review Pages ----------------
// (ConfluenceTab moved to ./tabs/ConfluenceTab.tsx in PR 2 step 2d)

// ---------------- Knowledge Base (Cross-Space CQL) ----------------
interface KBPage {
  page_id: string;
  title: string;
  excerpt: string;
  last_modified: string;
  updater: string;
  page_url: string;
}

interface KBSpace {
  space_key: string;
  space_name: string;
  page_count: number;
  pages: KBPage[];
}

interface KBResponse {
  total: number;
  app_name: string;
  spaces: KBSpace[];
}

function KnowledgeBaseTab({ appId }: { appId: string }) {
  const [data, setData] = useState<KBResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/graph/nodes/${encodeURIComponent(appId)}/knowledge`,
          { cache: "no-store", signal: controller.signal }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const j = await res.json();
        if (!j.success) throw new Error(j.error || "API error");
        const kb = j.data as KBResponse;
        if (!cancelled) {
          setData(kb);
          // Auto-expand top 2 spaces
          const topKeys = kb.spaces.slice(0, 2).map((s) => s.space_key);
          setExpanded(new Set(topKeys));
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof DOMException && e.name === "AbortError"
            ? "Confluence search timed out — the server may be unreachable."
            : e instanceof Error ? e.message : String(e);
          setErr(msg);
        }
      } finally {
        clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [appId]);

  if (loading) {
    return (
      <Panel title="Knowledge Base">
        <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 20, textAlign: "center" }}>
          Searching Confluence...
        </div>
      </Panel>
    );
  }
  if (err) {
    return (
      <Panel title="Knowledge Base">
        <div style={{ color: "var(--error)", fontSize: 13 }}>Failed: {err}</div>
      </Panel>
    );
  }
  if (!data || data.total === 0) {
    return (
      <Panel title="Knowledge Base — Cross-Space References">
        <EmptyState>No pages found mentioning this application in other Confluence spaces.</EmptyState>
      </Panel>
    );
  }

  const lowerFilter = filter.toLowerCase();
  const filtered = data.spaces
    .map((s) => ({
      ...s,
      pages: s.pages.filter(
        (p) =>
          !lowerFilter ||
          p.title.toLowerCase().includes(lowerFilter) ||
          p.updater.toLowerCase().includes(lowerFilter)
      ),
    }))
    .filter((s) => s.pages.length > 0);

  const INITIAL_SPACES = 5;
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_SPACES);
  const remaining = filtered.length - INITIAL_SPACES;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalSpaces = data.spaces.length;

  return (
    <Panel
      title={`Knowledge Base — ${data.total} pages across ${totalSpaces} spaces mention "${data.app_name}"`}
    >
      {/* Filter bar */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Filter by title or author..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            maxWidth: 360,
            padding: "6px 12px",
            fontSize: 12,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {filtered.reduce((a, s) => a + s.pages.length, 0)} results
        </span>
      </div>

      {/* Space groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((space) => {
          const isOpen = expanded.has(space.space_key);
          return (
            <div
              key={space.space_key}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
              }}
            >
              {/* Space header — clickable */}
              <div
                onClick={() => toggle(space.space_key)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "var(--bg-elevated)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", width: 12 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {space.space_name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-dim)",
                      padding: "1px 6px",
                      background: "var(--surface)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {space.space_key}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {space.pages.length} {space.pages.length === 1 ? "page" : "pages"}
                </span>
              </div>

              {/* Pages list */}
              {isOpen && (
                <div>
                  {space.pages.map((pg) => (
                    <div
                      key={pg.page_id}
                      style={{
                        padding: "8px 14px 8px 34px",
                        borderTop: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <a
                          href={pg.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--accent)",
                            textDecoration: "none",
                            flex: 1,
                            marginRight: 16,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={pg.title}
                        >
                          {pg.title}
                          <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.5 }}>↗</span>
                        </a>
                        <div
                          style={{
                            display: "flex",
                            gap: 16,
                            flexShrink: 0,
                            color: "var(--text-dim)",
                            fontSize: 11,
                          }}
                        >
                          <span style={{ fontFamily: "var(--font-mono)", width: 80 }}>
                            {pg.last_modified}
                          </span>
                          <span
                            style={{
                              width: 120,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={pg.updater}
                          >
                            {pg.updater}
                          </span>
                        </div>
                      </div>
                      {pg.excerpt && (
                        <div style={{
                          marginTop: 4,
                          fontSize: 11,
                          lineHeight: 1.5,
                          color: "var(--text-dim)",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical" as const,
                        }}>
                          {pg.excerpt}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load more */}
      {!showAll && remaining > 0 && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              padding: "8px 24px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Load more spaces ({remaining} remaining)
          </button>
        </div>
      )}
    </Panel>
  );
}


// ---------------------------------------------------------------------------
// Deployment Tab — servers, containers, databases from infraops
// ---------------------------------------------------------------------------

interface DeploymentData {
  summary: { servers: number; containers: number; databases: number; object_storage?: number; nas?: number };
  by_city: { city: string; servers: number; containers: number; databases: number; total: number }[];
  by_city_env: { city: string; env: string; pm: number; vm: number; k8s: number; db: number; oss: number; nas: number; total: number }[];
  servers: Record<string, string | null>[];
  containers: Record<string, string | null>[];
  databases: Record<string, string | null>[];
  object_storage?: Record<string, string | null>[];
  nas?: Record<string, string | null>[];
}

const CITY_LABELS: Record<string, string> = {
  SY: "沈阳 Shenyang",
  NM: "内蒙 Hohhot",
  BJ: "北京 Beijing",
  SH: "上海 Shanghai",
  SZ: "深圳 Shenzhen",
  TJ: "天津 Tianjin",
  WH: "武汉 Wuhan",
  HK: "香港 Hong Kong",
  NA: "North America",
  "US-Reston": "US Reston",
  "US-Chicago": "US Chicago",
  "US-Ral": "US Raleigh",
  Frankfurt: "Frankfurt",
};

function cityLabel(code: string | null): string {
  if (!code) return "Unknown";
  return CITY_LABELS[code] || code;
}

function DeploymentTab({ appId }: { appId: string }) {
  const [data, setData] = useState<DeploymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deployView, setDeployView] = useState<"table" | "map">("map");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/masters/applications/${appId}/deployment`);
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "API error");
        if (!cancelled) setData(j.data);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [appId]);

  if (loading) return <div className="empty" style={{ padding: 40 }}>Loading deployment data…</div>;
  if (err) return <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>;
  if (!data) return null;

  const { summary, by_city, servers, containers, databases } = data;
  const total = summary.servers + summary.containers + summary.databases + (summary.object_storage || 0) + (summary.nas || 0);
  const oss = data.object_storage || [];
  const nas = data.nas || [];

  if (total === 0) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        No deployment data found for this application in InfraOps.
      </div>
    );
  }

  return (
    <div>
      {/* Summary KPIs with Prod/Non-Prod breakdown */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <DeployKpi label="Servers (VM/PM)" value={summary.servers}
          prod={servers.filter(s => s.env === "Production").length}
          nonProd={servers.filter(s => s.env === "Non-Production").length} />
        <DeployKpi label="Containers" value={summary.containers}
          prod={containers.filter(c => c.env === "Production").length}
          nonProd={containers.filter(c => c.env === "Non-Production").length} />
        <DeployKpi label="Databases" value={summary.databases}
          prod={databases.filter(d => d.env === "Production").length}
          nonProd={databases.filter(d => d.env === "Non-Production").length} />
        <DeployKpi label="Object Storage" value={summary.object_storage || 0}
          prod={oss.filter(o => o.env === "Production").length}
          nonProd={oss.filter(o => o.env === "Non-Production").length} />
        <DeployKpi label="NAS" value={summary.nas || 0}
          prod={nas.filter(n => n.env === "Production").length}
          nonProd={nas.filter(n => n.env === "Non-Production").length} />
        <DeployKpi label="Total" value={total} accent />
      </div>

      {/* BY ENVIRONMENT bar chart */}
      {total > 0 && (() => {
        const prodTotal = servers.filter(s => s.env === "Production").length
          + containers.filter(c => c.env === "Production").length
          + databases.filter(d => d.env === "Production").length
          + oss.filter(o => o.env === "Production").length
          + nas.filter(n => n.env === "Production").length;
        const npTotal = servers.filter(s => s.env === "Non-Production").length
          + containers.filter(c => c.env === "Non-Production").length
          + databases.filter(d => d.env === "Non-Production").length
          + oss.filter(o => o.env === "Non-Production").length
          + nas.filter(n => n.env === "Non-Production").length;
        const unkTotal = total - prodTotal - npTotal;
        const maxBar = Math.max(prodTotal, npTotal, unkTotal, 1);
        return (
          <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-dim)", marginBottom: 10, fontWeight: 600 }}>By Environment</div>
            {[
              { label: "Production", value: prodTotal, color: "var(--accent)" },
              { label: "Non-Production", value: npTotal, color: "#6ba6e8" },
              ...(unkTotal > 0 ? [{ label: "Unknown", value: unkTotal, color: "var(--text-dim)" }] : []),
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                <div style={{ width: 100, fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>{row.label}</div>
                <div style={{ flex: 1, height: 18, background: "var(--bg)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${(row.value / maxBar) * 100}%`, height: "100%", background: row.color, borderRadius: 2, minWidth: row.value > 0 ? 4 : 0 }} />
                </div>
                <div style={{ width: 40, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: row.color, textAlign: "right" }}>{row.value}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Table / Map toggle */}
      {(data.by_city_env || []).length > 0 && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            <button
              onClick={() => setDeployView("table")}
              style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", cursor: "pointer",
                background: deployView === "table" ? "var(--accent)" : "var(--bg-elevated)",
                color: deployView === "table" ? "#000" : "var(--text-muted)",
              }}
            >
              Table View
            </button>
            <button
              onClick={() => setDeployView("map")}
              style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", cursor: "pointer",
                background: deployView === "map" ? "var(--accent)" : "var(--bg-elevated)",
                color: deployView === "map" ? "#000" : "var(--text-muted)",
              }}
            >
              Map View
            </button>
          </div>

          {deployView === "map" && <DeploymentMap data={data.by_city_env} />}

          {deployView === "table" && (
            <Panel title="Deployment by City / Environment">
              <table>
                <thead>
                  <tr>
                    <th>City</th>
                    <th>Environment</th>
                    <th style={{ textAlign: "right" }}>Physical</th>
                    <th style={{ textAlign: "right" }}>Virtual</th>
                    <th style={{ textAlign: "right" }}>Container</th>
                    <th style={{ textAlign: "right" }}>DB</th>
                    <th style={{ textAlign: "right" }}>OSS</th>
                    <th style={{ textAlign: "right" }}>NAS</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.by_city_env || []).map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{cityLabel(c.city)}</td>
                      <td><EnvBadge env={c.env} /></td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.pm || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.vm || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.k8s || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.db || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.oss || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>{c.nas || "—"}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>{c.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}

      {/* Servers table */}
      {servers.length > 0 && (
        <Panel title={`Servers · VM/PM (${servers.length})`}>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>IP</th>
                  <th>Type</th>
                  <th>Env</th>
                  <th>Zone</th>
                  <th>OS</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>City</th>
                  <th>DC</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {servers.slice(0, 200).map((s, i) => (
                  <tr key={i}>
                    <td><code style={{ fontSize: 11 }}>{s.name || "—"}</code></td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{s.ip_address || "—"}</td>
                    <td style={{ fontSize: 12 }}>{s.is_virtualized || s.device_type || "—"}</td>
                    <td><EnvBadge env={s.env} /></td>
                    <td><ZoneBadge zone={s.is_dmz} /></td>
                    <td style={{ fontSize: 12 }}>{s.os_type || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{s.cpu_count || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{s.ram ? Number(s.ram).toLocaleString() : "—"}</td>
                    <td style={{ fontSize: 12 }}>{cityLabel(s.city)}</td>
                    <td><code style={{ fontSize: 10, color: "var(--text-dim)" }}>{s.location || "—"}</code></td>
                    <td><DeployStatusPill status={s.operational_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {servers.length > 200 && (
              <div style={{ padding: 12, fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
                Showing 200 of {servers.length} servers
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Containers table */}
      {containers.length > 0 && (
        <Panel title={`Containers (${containers.length})`}>
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Cluster</th>
                <th>Env</th>
                <th>CPU Limit</th>
                <th>MEM Limit</th>
                <th>City</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{c.project_name || "—"}</td>
                  <td><code style={{ fontSize: 10 }}>{c.cluster_name || "—"}</code></td>
                  <td><EnvBadge env={c.env} /></td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{c.limit_cpu || "—"}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{c.limit_mem ? Number(c.limit_mem).toLocaleString() : "—"}</td>
                  <td style={{ fontSize: 12 }}>{cityLabel(c.city)}</td>
                  <td><DeployStatusPill status={c.operational_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Databases table */}
      {databases.length > 0 && (
        <Panel title={`Databases (${databases.length})`}>
          <table>
            <thead>
              <tr>
                <th>Instance</th>
                <th>Type</th>
                <th>Env</th>
                <th>Host</th>
                <th>Size (MB)</th>
                <th>City</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {databases.map((d, i) => (
                <tr key={i}>
                  <td><code style={{ fontSize: 11 }}>{d.db_instance_name || d.name || "—"}</code></td>
                  <td style={{ fontSize: 12 }}>{d.db_type || "—"}</td>
                  <td><EnvBadge env={d.env} /></td>
                  <td><code style={{ fontSize: 10, color: "var(--text-dim)" }}>{d.host_name || "—"}</code></td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{d.db_size_mb ? Number(d.db_size_mb).toLocaleString() : "—"}</td>
                  <td style={{ fontSize: 12 }}>{cityLabel(d.city)}</td>
                  <td><DeployStatusPill status={d.operational_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* Object Storage table */}
      {oss.length > 0 && (
        <Panel title={`Object Storage (${oss.length})`}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Env</th>
                <th>Max Size</th>
                <th>Max Buckets</th>
                <th>Endpoint</th>
                <th>City</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {oss.map((o, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{o.name || "—"}</td>
                  <td><EnvBadge env={o.env} /></td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{o.max_size ? `${o.max_size} GB` : "—"}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{o.max_buckets || "—"}</td>
                  <td><code style={{ fontSize: 10, color: "var(--text-dim)" }}>{o.endpoint || "—"}</code></td>
                  <td style={{ fontSize: 12 }}>{cityLabel(o.city)}</td>
                  <td><DeployStatusPill status={o.operational_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* NAS Storage table */}
      {nas.length > 0 && (
        <Panel title={`NAS Storage (${nas.length})`}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Env</th>
                <th>Type</th>
                <th>Capacity</th>
                <th>Path</th>
                <th>City</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {nas.map((n, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{n.name || "—"}</td>
                  <td><EnvBadge env={n.env} /></td>
                  <td style={{ fontSize: 12 }}>{n.type || "—"}</td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{n.capacity ? `${n.capacity} GB` : "—"}</td>
                  <td><code style={{ fontSize: 10, color: "var(--text-dim)" }}>{n.path || "—"}</code></td>
                  <td style={{ fontSize: 12 }}>{cityLabel(n.city)}</td>
                  <td><DeployStatusPill status={n.operational_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function DeployKpi({ label, value, accent, prod, nonProd }: {
  label: string; value: number; accent?: boolean; prod?: number; nonProd?: number;
}) {
  return (
    <div
      style={{
        padding: "12px 20px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)",
        color: accent ? "var(--accent)" : "var(--text)",
      }}>
        {value.toLocaleString()}
      </div>
      {prod !== undefined && value > 0 && (
        <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", marginTop: 4, color: "var(--text-dim)" }}>
          <span style={{ color: "var(--accent)" }}>{prod}P</span>
          {" "}
          <span style={{ color: "#6ba6e8" }}>{nonProd || 0}NP</span>
        </div>
      )}
    </div>
  );
}

function EnvBadge({ env }: { env: string | null | undefined }) {
  const e = (env || "").toLowerCase();
  const isProd = e === "production";
  const color = isProd ? "#f6a623" : e === "non-production" ? "#6ba6e8" : "var(--text-dim)";
  return (
    <span style={{
      fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
      padding: "2px 6px", borderRadius: "var(--radius-sm)",
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap",
    }}>
      {isProd ? "PROD" : e === "non-production" ? "NON-PROD" : env || "—"}
    </span>
  );
}

const ZONE_COLORS: Record<string, string> = {
  intranet: "#6ba6e8",
  dmz: "#e8716b",
  vpc: "#a78bfa",
};

function ZoneBadge({ zone }: { zone: string | null | undefined }) {
  const raw = (zone || "").trim();
  const key = raw.toLowerCase();
  // Normalize: YES/Dmz → DMZ, NO → Intranet
  const label = key === "yes" || key === "dmz" ? "DMZ"
    : key === "no" || key === "intranet" ? "Intranet"
    : key === "vpc" ? "VPC"
    : raw || "—";
  const colorKey = key === "yes" ? "dmz" : key === "no" ? "intranet" : key;
  const color = ZONE_COLORS[colorKey] || "var(--text-dim)";
  if (!raw) return <span style={{ color: "var(--text-dim)", fontSize: 12 }}>—</span>;
  return (
    <span style={{
      fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
      padding: "2px 6px", borderRadius: "var(--radius-sm)",
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function DeployStatusPill({ status }: { status: string | null }) {
  const s = (status || "").toLowerCase();
  const color = s === "operational" ? "#4ade80"
    : s === "power off" || s === "decommissioned" ? "#ef4444"
    : "var(--text-dim)";
  return (
    <span style={{
      fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
      textTransform: "uppercase", color,
    }}>
      {status || "—"}
    </span>
  );
}
