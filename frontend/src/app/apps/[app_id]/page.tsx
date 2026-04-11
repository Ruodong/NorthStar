"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

interface Investment {
  project_id: string;
  name: string;
  fiscal_year: string;
  review_status: string;
}

interface DiagramRef {
  diagram_id: string;
  diagram_type: string;
  file_kind: string;
  file_name: string;
  source_systems: string[];
  has_graph_data: boolean;
}

interface ConfluencePageRef {
  page_id: string;
  title: string;
  page_url: string;
}

interface AppDetailResponse {
  app: AppNode;
  outbound: OutboundEdge[];
  inbound: InboundEdge[];
  investments: Investment[];
  diagrams: DiagramRef[];
  confluence_pages: ConfluencePageRef[];
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

type Tab = "overview" | "integrations" | "investments" | "diagrams" | "impact";

const STATUS_COLORS: Record<string, string> = {
  Keep: "var(--status-keep)",
  Change: "var(--status-change)",
  New: "var(--status-new)",
  Sunset: "var(--status-sunset)",
  "3rd Party": "var(--status-third)",
  Active: "var(--success)",
};

export default function AppDetailPage({ params }: { params: { app_id: string } }) {
  const appId = decodeURIComponent(params.app_id);
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

  const { app, outbound, inbound, investments, diagrams, confluence_pages } = data;
  const totalIntegrations = outbound.length + inbound.length;

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
        />
      )}
      {tab === "integrations" && <IntegrationsTab outbound={outbound} inbound={inbound} />}
      {tab === "impact" && <ImpactTab appId={app.app_id} />}
      {tab === "investments" && <InvestmentsTab investments={investments} />}
      {tab === "diagrams" && <DiagramsTab diagrams={diagrams} />}
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
}: {
  app: AppNode;
  investments: Investment[];
  outbound: OutboundEdge[];
  inbound: InboundEdge[];
  diagrams: DiagramRef[];
  confluencePages: ConfluencePageRef[];
}) {
  const fyList = [...new Set(investments.map((i) => i.fiscal_year).filter(Boolean))].sort();

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
      <Panel title="Basic">
        <dl style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <dt style={{ color: "var(--text-dim)", minWidth: 110 }}>App ID</dt>
            <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{app.app_id}</dd>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <dt style={{ color: "var(--text-dim)", minWidth: 110 }}>Name</dt>
            <dd style={{ margin: 0 }}>{app.name}</dd>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <dt style={{ color: "var(--text-dim)", minWidth: 110 }}>Status</dt>
            <dd style={{ margin: 0 }}>
              <StatusPill status={app.status} />
            </dd>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <dt style={{ color: "var(--text-dim)", minWidth: 110 }}>CMDB linked</dt>
            <dd style={{ margin: 0, color: app.cmdb_linked ? "var(--success)" : "var(--text-dim)" }}>
              {app.cmdb_linked ? "yes" : "no"}
            </dd>
          </div>
          {app.last_updated && (
            <div style={{ display: "flex", gap: 12 }}>
              <dt style={{ color: "var(--text-dim)", minWidth: 110 }}>Last updated</dt>
              <dd style={{ margin: 0, color: "var(--text-muted)", fontSize: 12 }}>
                {new Date(app.last_updated).toISOString().slice(0, 10)}
              </dd>
            </div>
          )}
        </dl>
      </Panel>

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

  const sorted = [...investments].sort((a, b) => (b.fiscal_year || "").localeCompare(a.fiscal_year || ""));

  return (
    <Panel title={`Projects that invested in this app (${investments.length})`}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: 10 }}>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              Project
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              Fiscal Year
            </th>
            <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              Review
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv) => (
            <tr key={inv.project_id}>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {inv.project_id}
                <span style={{ marginLeft: 10, color: "var(--text-muted)", fontFamily: "var(--font-body)" }}>
                  {inv.name}
                </span>
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
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {inv.review_status || "—"}
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
        <EmptyState>
          No diagrams linked yet. Diagrams are attached via DESCRIBED_BY edges from the loader.
        </EmptyState>
      </Panel>
    );
  }
  return (
    <Panel title={`Diagrams describing this app (${diagrams.length})`}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {diagrams.map((d) => (
          <li
            key={d.diagram_id}
            style={{
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              gap: 14,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 10,
                padding: "2px 8px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                textTransform: "uppercase",
              }}
            >
              {d.diagram_type}
            </span>
            <span
              style={{
                fontSize: 10,
                padding: "2px 8px",
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {d.file_kind}
            </span>
            <span style={{ flex: 1, fontSize: 13 }}>{d.file_name || "(unnamed)"}</span>
            {d.source_systems && d.source_systems.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {d.source_systems.join("+")}
              </span>
            )}
            {!d.has_graph_data && (
              <span
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                no graph data
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
