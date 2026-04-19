"use client";

import { useState } from "react";
import { DeploymentMap } from "@/components/DeploymentMap";
import { Panel } from "../_shared/Panel";
import { Kpi } from "../_shared/Kpi";
import { CITY_LABELS, cityLabel } from "../_shared/cities";
import { useTabFetch } from "../_shared/useTabFetch";

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

export function DeploymentTab({ appId }: { appId: string }) {
  const { data, loading, err } = useTabFetch<DeploymentData>(
    appId ? `/api/masters/applications/${appId}/deployment` : null,
    [appId],
  );
  const [deployView, setDeployView] = useState<"table" | "map">("map");

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
