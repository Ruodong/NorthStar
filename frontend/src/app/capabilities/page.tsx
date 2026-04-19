"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface BCLeafApp {
  app_id: string;
  name: string;
  portfolio: string | null;
}

interface BCNode {
  bc_id: string;
  bc_name: string;
  bc_name_cn: string | null;
  bc_description?: string | null;
  description?: string | null;
  level: number;
  app_count: number;
  children: BCNode[];
  apps?: BCLeafApp[];
}

const PORTFOLIO_COLORS: Record<string, string> = {
  Invest: "#5fc58a",
  Migrate: "#6ba6e8",
  Tolerate: "#e8b458",
  Retire: "#e8716b",
};

interface BCResponse {
  total_bcs: number;
  total_mapped_apps: number;
  tree: BCNode[];
}

// ---------------------------------------------------------------------------
// Color palette for L1 domains — 12 distinct muted colors
// ---------------------------------------------------------------------------
const DOMAIN_COLORS = [
  "#3b82a0", "#5f8a5e", "#a07c3b", "#8b5e8b",
  "#5e7f8b", "#8b6e5e", "#5e6e8b", "#7f8b5e",
  "#8b5e6e", "#5e8b7f", "#6e5e8b", "#8b7f5e",
];

function getDomainColor(index: number): string {
  return DOMAIN_COLORS[index % DOMAIN_COLORS.length];
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function CapabilitiesPage() {
  const [data, setData] = useState<BCResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expandedL1, setExpandedL1] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/business-capabilities", { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "API error");
        setData(j.data);
        // Auto-expand L1s with mapped apps
        const withApps = new Set(
          (j.data.tree as BCNode[])
            .filter((l1) => l1.app_count > 0)
            .map((l1) => l1.bc_id)
        );
        setExpandedL1(withApps);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleL1 = (id: string) => {
    setExpandedL1((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  if (loading) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Loading...</div>;
  if (err) return <div style={{ padding: 40, color: "var(--error)" }}>Error: {err}</div>;
  if (!data) return null;

  const lowerFilter = filter.toLowerCase();

  // Filter tree: keep L1s that have matching L3 leaves
  const filtered = data.tree
    .map((l1, l1i) => {
      const filteredChildren = l1.children
        .map((l2) => ({
          ...l2,
          children: l2.children.filter(
            (l3) =>
              l3.app_count > 0 &&
              (!lowerFilter ||
              l3.bc_name.toLowerCase().includes(lowerFilter) ||
              (l3.bc_name_cn || "").toLowerCase().includes(lowerFilter) ||
              l3.bc_id.toLowerCase().includes(lowerFilter))
          ),
        }))
        .filter((l2) => l2.children.length > 0);
      return { ...l1, children: filteredChildren, _colorIdx: l1i };
    })
    .filter((l1) => l1.children.length > 0);

  return (
    <div>
      {/* Header */}
      <h1 style={{ marginBottom: 4 }}>Business Capability Map</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 20 }}>
        {data.total_bcs} capabilities across {data.tree.length} domains, {data.total_mapped_apps} applications mapped.
        Source: EAM.
      </p>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        <KpiCard label="Domains (L1)" value={data.tree.length} />
        <KpiCard label="Capabilities" value={data.total_bcs} />
        <KpiCard label="Mapped Apps" value={data.total_mapped_apps} color="var(--accent)" />
        <KpiCard
          label="Coverage"
          value={`${data.total_bcs > 0 ? Math.round((data.tree.filter((l1) => l1.app_count > 0).reduce((a, l1) => a + l1.children.reduce((b, l2) => b + l2.children.filter((l3) => l3.app_count > 0).length, 0), 0) / data.total_bcs) * 100) : 0}%`}
        />
      </div>

      {/* Portfolio Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16, padding: "10px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
        <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginRight: 4 }}>Portfolio</span>
        {Object.entries(PORTFOLIO_COLORS).map(([label, color]) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: color, border: `1px solid ${color}88`, opacity: 0.9 }} />
            <span style={{ color: "var(--text-muted)" }}>{label}</span>
          </span>
        ))}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: "#5f6a80", border: "1px solid #5f6a8088", opacity: 0.9 }} />
          <span style={{ color: "var(--text-muted)" }}>N/A</span>
        </span>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Filter capabilities by name or ID..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            width: "100%",
            maxWidth: 400,
            padding: "8px 14px",
            fontSize: 13,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            outline: "none",
          }}
        />
      </div>

      {/* Capability map */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {filtered.map((l1) => {
          const isOpen = expandedL1.has(l1.bc_id);
          const domainColor = getDomainColor(l1._colorIdx);
          return (
            <div
              key={l1.bc_id}
              style={{
                border: `1px solid ${domainColor}44`,
                borderRadius: "var(--radius-lg)",
                overflow: "hidden",
                background: "var(--surface)",
              }}
            >
              {/* L1 Domain header */}
              <div
                onClick={() => toggleL1(l1.bc_id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 20px",
                  background: `${domainColor}18`,
                  borderBottom: isOpen ? `1px solid ${domainColor}33` : "none",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", width: 14 }}>
                    {isOpen ? "\u25be" : "\u25b8"}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: domainColor }}>
                    {l1.bc_name}
                  </span>
                  {l1.bc_name_cn && (
                    <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      {l1.bc_name_cn}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-dim)" }}>
                  <span>{l1.children.length} sub-domains</span>
                  {l1.app_count > 0 && (
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                      {l1.app_count} apps
                    </span>
                  )}
                </div>
              </div>

              {/* L2 → L3 content */}
              {isOpen && (
                <div style={{ padding: 16 }}>
                  {l1.children.map((l2) => (
                    <div key={l2.bc_id} style={{ marginBottom: 16 }}>
                      {/* L2 Sub-domain header */}
                      <div style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        color: "var(--text-muted)",
                        marginBottom: 8,
                        paddingBottom: 4,
                        borderBottom: "1px solid var(--border)",
                        display: "flex",
                        justifyContent: "space-between",
                      }}>
                        <span>{l2.bc_name}</span>
                        {l2.app_count > 0 && (
                          <span style={{ color: "var(--accent)" }}>{l2.app_count} apps</span>
                        )}
                      </div>

                      {/* L3 Capability cards */}
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                        gap: 8,
                      }}>
                        {l2.children.map((l3) => (
                          <div
                            key={l3.bc_id}
                            style={{
                              padding: "8px 12px",
                              borderRadius: "var(--radius-sm)",
                              border: `1px solid ${l3.app_count > 0 ? `${domainColor}55` : "var(--border)"}`,
                              background: l3.app_count > 0 ? `${domainColor}0d` : "transparent",
                            }}
                            title={l3.bc_description || l3.description || l3.bc_name}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: l3.apps?.length ? 6 : 0 }}>
                              <div>
                                <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}>{l3.bc_name}</div>
                                {l3.bc_name_cn && (
                                  <div style={{ fontSize: 10, color: "var(--text-dim)", fontStyle: "italic" }}>{l3.bc_name_cn}</div>
                                )}
                              </div>
                              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)", flexShrink: 0, marginLeft: 8 }}>
                                {l3.bc_id}
                              </span>
                            </div>
                            {/* App tags inline */}
                            {l3.apps && l3.apps.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {l3.apps.map((app) => {
                                  const pColor = PORTFOLIO_COLORS[app.portfolio || ""] || "#5f6a80";
                                  return (
                                    <Link
                                      key={app.app_id}
                                      href={`/apps/${app.app_id}`}
                                      style={{
                                        display: "inline-block",
                                        padding: "1px 7px",
                                        borderRadius: "var(--radius-sm)",
                                        border: `1px solid ${pColor}88`,
                                        color: pColor,
                                        background: `${pColor}15`,
                                        fontSize: 10,
                                        textDecoration: "none",
                                        whiteSpace: "nowrap",
                                      }}
                                      title={`${app.app_id} — ${app.name}${app.portfolio ? ` (${app.portfolio})` : ""}`}
                                    >
                                      {app.name}
                                    </Link>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{
      padding: 14,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-dim)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-display)",
        fontSize: 28,
        fontWeight: 600,
        color: color || "var(--text)",
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}
