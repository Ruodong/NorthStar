"use client";

import { useEffect, useState } from "react";

// -----------------------------------------------------------------------------
// Types — mirror backend AppBusinessCapabilitiesResponse (api.md §6)
// -----------------------------------------------------------------------------
interface BusinessCapabilityLeaf {
  bc_id: string;
  bc_name: string;
  bc_name_cn: string | null;
  bc_description: string | null;
  level: number;
  lv3_capability_group: string;
  biz_owner: string | null;
  biz_team: string | null;
  dt_owner: string | null;
  dt_team: string | null;
  data_version: string | null;
  source_updated_at: string | null;
}

interface CapabilityL2Group {
  l2_subdomain: string;
  leaves: BusinessCapabilityLeaf[];
}

interface CapabilityL1Group {
  l1_domain: string;
  count: number;
  l2_groups: CapabilityL2Group[];
}

interface AppBusinessCapabilitiesResponse {
  app_id: string;
  total_count: number;
  l1_groups: CapabilityL1Group[];
  taxonomy_versions: string[];
  last_synced_at: string | null;
  orphan_mappings: number;
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function ownerLine(leaf: BusinessCapabilityLeaf): string | null {
  const hasAny =
    leaf.biz_owner || leaf.biz_team || leaf.dt_owner || leaf.dt_team;
  if (!hasAny) return null;
  const biz = leaf.biz_owner
    ? `${leaf.biz_owner}${leaf.biz_team ? ` (${leaf.biz_team})` : ""}`
    : "—";
  const dt = leaf.dt_owner
    ? `${leaf.dt_owner}${leaf.dt_team ? ` (${leaf.dt_team})` : ""}`
    : "—";
  return `Biz: ${biz} · DT: ${dt}`;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------
export function CapabilitiesTab({ appId }: { appId: string }) {
  const [data, setData] = useState<AppBusinessCapabilitiesResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/apps/${encodeURIComponent(appId)}/business-capabilities`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (cancelled) return;
        if (!j.success) {
          setErr(j.error || "Failed to load capabilities");
          return;
        }
        setData(j.data as AppBusinessCapabilitiesResponse);
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
    return (
      <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 12 }}>
        Loading capabilities…
      </div>
    );
  }

  if (err) {
    return (
      <div
        style={{
          color: "#ff6b6b",
          fontSize: 13,
          padding: 12,
          border: "1px solid rgba(255,107,107,0.3)",
          borderRadius: 4,
        }}
      >
        Failed to load capabilities: {err}
      </div>
    );
  }

  if (!data) return null;

  const isEmpty = data.total_count === 0;
  const mixedVersions = data.taxonomy_versions.length > 1;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {isEmpty ? (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "var(--text-muted)",
            fontSize: 13,
            lineHeight: 1.6,
            border: "1px dashed var(--border-strong)",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 15, color: "var(--text)", marginBottom: 8 }}>
            No business capabilities mapped
          </div>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            This application hasn&apos;t been mapped to any business
            capability in EAM yet. Mapping is maintained in EAM by the
            Enterprise Architecture team.
          </div>
        </div>
      ) : (
        data.l1_groups.map((l1) => {
          const isCollapsed = collapsed.has(l1.l1_domain);
          return (
            <div
              key={l1.l1_domain}
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (isCollapsed) next.delete(l1.l1_domain);
                  else next.add(l1.l1_domain);
                  setCollapsed(next);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "var(--panel-raised, rgba(255,255,255,0.02))",
                  border: "none",
                  borderBottom: isCollapsed
                    ? "none"
                    : "1px solid var(--border-strong)",
                  color: "var(--text)",
                  padding: "10px 14px",
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer",
                }}
              >
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      color: "var(--text-dim)",
                      marginRight: 6,
                    }}
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  {l1.l1_domain || "(no domain)"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {l1.count}
                </span>
              </button>
              {!isCollapsed &&
                l1.l2_groups.map((l2) => (
                  <div key={l2.l2_subdomain}>
                    <div
                      style={{
                        padding: "8px 14px 4px 14px",
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        color: "var(--text-dim)",
                      }}
                    >
                      {l2.l2_subdomain || "(no subdomain)"}
                    </div>
                    {l2.leaves.map((leaf, idx) => {
                      const oline = ownerLine(leaf);
                      return (
                        <div
                          key={leaf.bc_id + idx}
                          title={leaf.bc_description || undefined}
                          style={{
                            padding: "8px 14px 10px 14px",
                            borderTop:
                              idx === 0
                                ? "none"
                                : "1px solid rgba(255,255,255,0.04)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "baseline",
                            }}
                          >
                            <code
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: 11,
                                color: "var(--text-dim)",
                                minWidth: 68,
                              }}
                            >
                              {leaf.bc_id}
                            </code>
                            <span
                              style={{
                                fontFamily: "var(--font-display)",
                                fontSize: 13,
                                color: "var(--text)",
                              }}
                            >
                              {leaf.bc_name}
                            </span>
                          </div>
                          {leaf.bc_name_cn && (
                            <div
                              style={{
                                marginLeft: 78,
                                fontStyle: "italic",
                                fontSize: 11,
                                color: "var(--text-muted)",
                                marginTop: 2,
                              }}
                            >
                              {leaf.bc_name_cn}
                            </div>
                          )}
                          {oline && (
                            <div
                              style={{
                                marginLeft: 78,
                                fontSize: 11,
                                color: "var(--text-dim)",
                                marginTop: 4,
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              {oline}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          );
        })
      )}

      {/* Footer meta */}
      <div
        style={{
          borderTop: "1px solid var(--border-strong)",
          paddingTop: 8,
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>Source: EAM</span>
        <span>Last sync: {relativeTime(data.last_synced_at)}</span>
        {data.taxonomy_versions.length > 0 && (
          <span>
            Taxonomy {data.taxonomy_versions.map((v) => `v${v}`).join("/")}
            {mixedVersions && (
              <span style={{ color: "#f6a623", marginLeft: 6 }}>
                ⚠ mixed versions
              </span>
            )}
          </span>
        )}
        {data.orphan_mappings > 0 && (
          <span style={{ color: "var(--text-muted)" }}>
            ({data.orphan_mappings} orphan mapping
            {data.orphan_mappings === 1 ? "" : "s"} filtered)
          </span>
        )}
      </div>
    </div>
  );
}
