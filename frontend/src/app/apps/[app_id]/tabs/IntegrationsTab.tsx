"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pill } from "@/components/Pill";
import { StatusPill } from "../_shared/StatusPill";
import { EmptyState } from "../_shared/EmptyState";

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

export function IntegrationsTab({ appId }: { appId: string }) {
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
          {/* Column labels — centered over each column's visible geometry */}
          <g
            fontFamily="var(--font-mono)"
            fontSize="9"
            fill="var(--text-dim)"
            textAnchor="middle"
            style={{ letterSpacing: 0.6 }}
          >
            <text x={cols.upstream_apps.x + APP_BOX_W / 2} y={16}>UPSTREAM</text>
            <text x={cols.upstream_platforms.x + PLATFORM_BOX_W / 2} y={16}>via</text>
            <text x={cols.me.x + ME_BOX_W / 2} y={16}>ME</text>
            <text x={cols.downstream_platforms.x + PLATFORM_BOX_W / 2} y={16}>via</text>
            <text x={cols.downstream_apps.x + APP_BOX_W / 2} y={16}>DOWNSTREAM</text>
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
// (DiagramsTab, DiagramCard, DiagramList moved to ./tabs/DiagramsTab.tsx in PR 2 step 2d)
