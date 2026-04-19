"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  ImpactApp,
  ImpactBucket,
  BusinessObjectAgg,
  ImpactResponse,
} from "../_shared/types";
import { STATUS_COLORS } from "../_shared/types";
import { Panel } from "../_shared/Panel";
import { EmptyState } from "../_shared/EmptyState";
import { Kpi } from "../_shared/Kpi";

export function ImpactTab({ appId }: { appId: string }) {
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

