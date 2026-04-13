"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

// -----------------------------------------------------------------------------
// Types — match backend/app/services/graph_query.py::get_application
// -----------------------------------------------------------------------------
interface AppNode {
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

interface OutboundEdge {
  target: string;
  target_name: string;
  type: string;
  business_object: string;
  protocol: string;
}

interface InboundEdge {
  source: string;
  source_name: string;
  type: string;
  business_object: string;
  protocol: string;
}

interface MajorApp {
  app_id: string;
  app_name: string;
  status: string;
}

interface Investment {
  project_id: string;
  project_name: string;
  fiscal_year: string;
  root_page_id: string | null;
  major_apps: MajorApp[];
}

interface DiagramRef {
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
}

interface ConfluencePageRef {
  page_id: string;
  title: string;
  page_url: string;
}

interface TcoData {
  application_classification?: string;
  stamp_k?: number;
  budget_k?: number;
  actual_k?: number;
  allocation_stamp_k?: number;
  allocation_actual_k?: number;
}

interface ReviewPage {
  page_id: string;
  fiscal_year: string;
  title: string;
  page_url: string;
  body_size_chars?: number;
  q_pm?: string;
  q_it_lead?: string;
  q_dt_lead?: string;
  questionnaire_sections?: { title: string; rows: { label: string; value: string }[] }[] | null;
}

interface AppDetailResponse {
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
interface ImpactApp {
  app_id: string;
  name: string;
  status: string;
  cmdb_linked: boolean;
}

interface ImpactBucket {
  distance: number;
  total: number;
  shown: number;
  apps: ImpactApp[];
}

interface BusinessObjectAgg {
  name: string;
  count: number;
}

interface ImpactResponse {
  root: { app_id: string; name: string; status: string };
  depth: number;
  total_upstream: number;
  by_distance: ImpactBucket[];
  business_objects: BusinessObjectAgg[];
  truncated_at_cypher_limit: boolean;
  fan_out_cap: number;
}

type Tab = "overview" | "integrations" | "investments" | "diagrams" | "impact" | "confluence" | "knowledge" | "deployment";

const STATUS_COLORS: Record<string, string> = {
  Keep: "var(--status-keep)",
  Change: "var(--status-change)",
  New: "var(--status-new)",
  Sunset: "var(--status-sunset)",
  "3rd Party": "var(--status-third)",
  Active: "var(--success)",
};

export default function AppDetailPage() {
  const params = useParams();
  const appId = decodeURIComponent(params.app_id as string);
  const [data, setData] = useState<AppDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

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

  const { app, outbound, inbound, investments, diagrams, confluence_pages, tco, review_pages } = data;
  const totalIntegrations = outbound.length + inbound.length;
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
          {app.cmdb_linked && (
            <span
              style={{
                fontSize: 10,
                padding: "2px 8px",
                background: "rgba(246,166,35,0.12)",
                color: "var(--accent)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius-sm)",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                fontWeight: 600,
              }}
            >
              CMDB
            </span>
          )}
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
        <TabButton current={tab} value="integrations" onClick={setTab} count={totalIntegrations}>
          Integrations
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
        <TabButton current={tab} value="deployment" onClick={setTab}>
          Deployment
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
          outbound={outbound}
          inbound={inbound}
          diagrams={diagrams}
          confluencePages={confluence_pages}
          tco={tco}
        />
      )}
      {tab === "integrations" && <IntegrationsTab outbound={outbound} inbound={inbound} />}
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
// -----------------------------------------------------------------------------
function TabButton({
  current,
  value,
  onClick,
  count,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  count?: number;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      style={{
        background: "transparent",
        border: "none",
        color: active ? "var(--text)" : "var(--text-muted)",
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {children}
      {count != null && (
        <span
          style={{
            marginLeft: 6,
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "var(--text-dim)";
  return (
    <span
      style={{
        fontSize: 11,
        padding: "3px 10px",
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid ${color}`,
        borderRadius: "var(--radius-sm)",
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 600,
      }}
    >
      {status || "Unknown"}
    </span>
  );
}

function CmdbField({
  label, value, resolvedName, mono, pill, wide,
}: {
  label: string;
  value?: string | null;
  resolvedName?: string | null;
  mono?: boolean;
  pill?: boolean;
  wide?: boolean;
}) {
  if (!value && !pill) return null;
  return (
    <div style={{
      display: wide ? "block" : "flex",
      gap: 12,
      fontSize: 13,
      lineHeight: 1.8,
    }}>
      <dt style={{ color: "var(--text-dim)", minWidth: 130, flexShrink: 0 }}>{label}</dt>
      <dd style={{
        margin: 0,
        fontFamily: mono ? "var(--font-mono)" : undefined,
        fontSize: mono ? 12 : undefined,
        ...(wide ? { marginTop: 2, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 } : {}),
      }}>
        {pill ? <StatusPill status={value || "Unknown"} /> : (
          <>
            {resolvedName ? (
              <>{resolvedName} <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{value}</span></>
            ) : (
              Array.isArray(value) ? (value as string[]).join(", ") : value
            )}
          </>
        )}
      </dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "8px 0" }}>{children}</div>;
}

// ---------------- Overview ----------------
function OverviewTab({
  app,
  investments,
  outbound,
  inbound,
  diagrams,
  confluencePages,
  tco,
}: {
  app: AppNode;
  investments: Investment[];
  outbound: OutboundEdge[];
  inbound: InboundEdge[];
  diagrams: DiagramRef[];
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
        <CmdbField label="Classification" value={app.app_classification} />
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

      <Panel title="At a glance">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
          }}
        >
          <Kpi label="Investments" value={investments.length} />
          <Kpi label="Outgoing" value={outbound.length} />
          <Kpi label="Incoming" value={inbound.length} />
          <Kpi label="Diagrams" value={diagrams.length} />
          <Kpi label="Conf. pages" value={confluencePages.length} />
        </div>
      </Panel>

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
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------- Integrations ----------------
function IntegrationsTab({
  outbound,
  inbound,
}: {
  outbound: OutboundEdge[];
  inbound: InboundEdge[];
}) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Panel title={`Outgoing — calls these (${outbound.length})`}>
        {outbound.length === 0 ? (
          <EmptyState>No outgoing integrations.</EmptyState>
        ) : (
          <IntegrationTable
            rows={outbound.map((e) => ({
              peer_id: e.target,
              peer_name: e.target_name,
              type: e.type,
              business_object: e.business_object,
              protocol: e.protocol,
            }))}
          />
        )}
      </Panel>

      <Panel title={`Incoming — called by these (${inbound.length})`}>
        {inbound.length === 0 ? (
          <EmptyState>No incoming integrations.</EmptyState>
        ) : (
          <IntegrationTable
            rows={inbound.map((e) => ({
              peer_id: e.source,
              peer_name: e.source_name,
              type: e.type,
              business_object: e.business_object,
              protocol: e.protocol,
            }))}
          />
        )}
      </Panel>
    </div>
  );
}

interface IntegRow {
  peer_id: string;
  peer_name: string;
  type: string;
  business_object: string;
  protocol: string;
}

function IntegrationTable({ rows }: { rows: IntegRow[] }) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 12,
      }}
    >
      <thead>
        <tr style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: 10 }}>
          <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            App
          </th>
          <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            Type
          </th>
          <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            Business object
          </th>
          <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
            Protocol
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.peer_id}-${idx}`}>
            <td
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <Link href={`/apps/${encodeURIComponent(r.peer_id)}`} style={{ color: "var(--accent)" }}>
                {r.peer_id}
              </Link>
              <span style={{ marginLeft: 10, color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>
                {r.peer_name}
              </span>
            </td>
            <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
              {r.type || "—"}
            </td>
            <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
              {r.business_object || "—"}
            </td>
            <td
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {r.protocol || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------- Investments ----------------
function InvestmentsTab({ investments }: { investments: Investment[] }) {
  if (investments.length === 0) {
    return (
      <Panel title="Projects that invested in this app">
        <EmptyState>No projects recorded for this application.</EmptyState>
      </Panel>
    );
  }

  // Already sorted by fiscal_year DESC from backend, but re-sort just in case
  const sorted = [...investments].sort((a, b) => (b.fiscal_year || "").localeCompare(a.fiscal_year || ""));

  return (
    <Panel title={`Projects that invested in this app (${investments.length})`}>
      {/* Legend */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginBottom: 10 }}>
        {(["Change", "New", "Sunset"] as const).map((s) => (
          <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: STATUS_COLORS[s] || "var(--border)",
                opacity: 0.85,
              }}
            />
            <span style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
              {s}
            </span>
          </span>
        ))}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: 10 }}>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)", width: 110 }}>
              Project ID
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              Project Name
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              Major Applications
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)", width: 80 }}>
              FY
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv, idx) => (
            <tr key={`${inv.project_id}-${idx}`}>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {inv.project_id ? (
                  <Link
                    href={`/admin/projects/${encodeURIComponent(inv.project_id)}`}
                    style={{ color: "var(--accent)", textDecoration: "none" }}
                  >
                    {inv.project_id}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                {inv.root_page_id ? (
                  <Link
                    href={`/admin/confluence/${inv.root_page_id}?tab=extracted`}
                    style={{ color: "var(--accent)", textDecoration: "none" }}
                  >
                    {inv.project_name || inv.project_id}
                  </Link>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>
                    {inv.project_name || "—"}
                  </span>
                )}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  lineHeight: 1.8,
                }}
              >
                {inv.major_apps && inv.major_apps.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {inv.major_apps.map((ma, mi) => (
                      <Link
                        key={`${ma.app_id}-${mi}`}
                        href={`/apps/${ma.app_id}`}
                        style={{
                          display: "inline-block",
                          padding: "1px 8px",
                          borderRadius: "var(--radius-sm)",
                          border: `1px solid ${STATUS_COLORS[ma.status] || "var(--border)"}`,
                          color: STATUS_COLORS[ma.status] || "var(--text-muted)",
                          textDecoration: "none",
                          fontSize: 10,
                          whiteSpace: "nowrap",
                        }}
                        title={`${ma.app_id} — ${ma.app_name} (${ma.status})`}
                      >
                        {ma.app_name}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>—</span>
                )}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {inv.fiscal_year || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

// ---------------- Diagrams ----------------
function DiagramsTab({ diagrams }: { diagrams: DiagramRef[] }) {
  if (diagrams.length === 0) {
    return (
      <Panel title="Diagrams describing this app">
        <EmptyState>No diagrams found for this application.</EmptyState>
      </Panel>
    );
  }
  return (
    <Panel title={`Diagrams (${diagrams.length})`}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {diagrams.map((d, idx) => (
          <li
            key={d.diagram_id || d.attachment_id || idx}
            style={{
              padding: "10px 0",
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
    </Panel>
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
function ConfluenceTab({ pages }: { pages: ReviewPage[] }) {
  if (pages.length === 0) {
    return (
      <Panel title="Confluence Review Pages">
        <EmptyState>No review pages found for this application.</EmptyState>
      </Panel>
    );
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {pages.map((p) => (
        <Panel key={p.page_id} title={`${p.fiscal_year} — ${p.title}`}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
            {p.q_pm && <span>PM: <strong style={{ color: "var(--text-muted)" }}>{p.q_pm}</strong></span>}
            {p.q_it_lead && <span>IT Lead: <strong style={{ color: "var(--text-muted)" }}>{p.q_it_lead}</strong></span>}
            {p.q_dt_lead && <span>DT Lead: <strong style={{ color: "var(--text-muted)" }}>{p.q_dt_lead}</strong></span>}
            {p.body_size_chars != null && <span>{p.body_size_chars.toLocaleString()} chars</span>}
            <a href={p.page_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 11 }}>
              Open in Confluence ↗
            </a>
          </div>
          {p.questionnaire_sections && p.questionnaire_sections.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {p.questionnaire_sections.map((sec, si) => (
                <div key={si}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 4,
                  }}>
                    {sec.title}
                  </div>
                  <dl style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>
                    {sec.rows.map((row, ri) => (
                      <div key={ri} style={{ display: "flex", gap: 12, borderBottom: "1px solid var(--border)", padding: "3px 0" }}>
                        <dt style={{ color: "var(--text-dim)", minWidth: 200, flexShrink: 0 }}>{row.label}</dt>
                        <dd style={{ margin: 0, color: "var(--text-muted)", wordBreak: "break-word" }}>{row.value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

// ---------------- Knowledge Base (Cross-Space CQL) ----------------
interface KBPage {
  page_id: string;
  title: string;
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
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/graph/nodes/${encodeURIComponent(appId)}/knowledge`,
          { cache: "no-store" }
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
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
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
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 14px 8px 34px",
                        borderTop: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    >
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
  by_city_env: { city: string; env: string; servers: number; containers: number; databases: number; object_storage: number; nas: number; total: number }[];
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
      {/* Summary KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <DeployKpi label="Servers (VM/PM)" value={summary.servers} />
        <DeployKpi label="Containers" value={summary.containers} />
        <DeployKpi label="Databases" value={summary.databases} />
        <DeployKpi label="Object Storage" value={summary.object_storage || 0} />
        <DeployKpi label="NAS" value={summary.nas || 0} />
        <DeployKpi label="Total" value={total} accent />
      </div>

      {/* City × Env distribution */}
      {(data.by_city_env || by_city).length > 0 && (
        <Panel title="Deployment by City / Environment">
          <table>
            <thead>
              <tr>
                <th>City</th>
                <th>Environment</th>
                <th style={{ textAlign: "right" }}>Servers</th>
                <th style={{ textAlign: "right" }}>Containers</th>
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
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {c.servers || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {c.containers || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {c.databases || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {c.object_storage || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {c.nas || "—"}
                  </td>
                  <td style={{
                    textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12,
                    fontWeight: 600, color: "var(--accent)",
                  }}>
                    {c.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
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
                    <td style={{ fontSize: 12 }}>{s.os_type || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{s.cpu_count || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{s.ram || "—"}</td>
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
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{c.limit_mem || "—"}</td>
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
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "right" }}>{d.db_size_mb || "—"}</td>
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

function DeployKpi({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
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
