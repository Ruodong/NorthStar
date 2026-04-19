import type { ReactNode } from "react";
import { Pill, statusToPillTone } from "@/components/Pill";
import { MetadataList, type MetadataRow } from "@/components/MetadataList";

/**
 * Above-the-fold "answer" surface for every entity detail page.
 *
 * See DESIGN.md § App Detail Redesign Extensions → Component Primitives
 * for the full spec. Layout (per mockup A2):
 *
 *   ┌ title row ────────────────────────────────────────────────┐
 *   │ A002856  OLMS  ✓ cmdb-linked  [ACTIVE] [CIO/CDTO] [INVEST] │
 *   │                                        Updated 4h ago     │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ purpose / short_description (body, 1-2 lines)              │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ ┌───────────┐ ┌───────────┐ ┌──────────────┐               │
 *   │ │ 24        │ │ 7         │ │ 6            │  KPI strip    │
 *   │ │ integr.   │ │ capabil.  │ │ investments  │               │
 *   │ └───────────┘ └───────────┘ └──────────────┘               │
 *   ├────────────────────────────────────────────────────────────┤
 *   │ Last change · Owners · Geo  (MetadataList, no card chrome) │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Edge cases:
 *   - `cmdb_linked === true`   → green "✓ cmdb-linked" indicator
 *   - `cmdb_linked === false`  → red   "✗ not in cmdb, limited info" strip
 *   - `cmdb_linked === undefined` → amber "CMDB status unknown" strip
 *   - `decommissioned_at` set  → red sunset banner at the top; status
 *                                pill becomes "SUNSET" even if CMDB says
 *                                Active (concrete timestamp beats stale
 *                                string — plan §13 PR 3 §3e + eng review
 *                                Issue 7).
 *
 * AnswerBlock receives all data via props. It makes no HTTP calls.
 * Page.tsx (RSC) fetches + passes down.
 */

export interface AnswerBlockProps {
  appId: string;
  name: string | null | undefined;
  /** CMDB long description — preferred over `description` when present. */
  shortDescription?: string | null;
  /** Neo4j-sourced short description — fallback if shortDescription missing. */
  description?: string | null;
  status: string | null | undefined;
  cmdbLinked: boolean | undefined;
  /** ISO-ish timestamp string from CMDB. Present triggers sunset mode. */
  decommissionedAt?: string | null;
  /** Classification / portfolio / ownership pills to show next to status. */
  pills?: { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }[];
  /** When the upstream data was last synced. Shown bottom-right of title row. */
  lastUpdated?: string | null;
  /** KPI counts for the anchor row. Falsy values render as `—`. */
  kpis: {
    integrations: number | null | undefined;
    capabilities: number | null | undefined;
    investments: number | null | undefined;
  };
  /** Metadata rows below the KPI strip (Last change · Owners · Geo · ...). */
  metadata: MetadataRow[];
}

/**
 * Format a "4h ago"-style relative timestamp from an ISO string.
 * Returns the original string on parse failure — never throws.
 */
function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function AnswerBlock({
  appId,
  name,
  shortDescription,
  description,
  status,
  cmdbLinked,
  decommissionedAt,
  pills = [],
  lastUpdated,
  kpis,
  metadata,
}: AnswerBlockProps) {
  // ---- Sunset detection (plan §13 PR 3 §3e) ----
  const sunsetDate = formatDate(decommissionedAt);
  const isSunset = sunsetDate != null;
  // When CMDB says Active but a decommissioned_at exists, trust the
  // concrete timestamp. Reflect this in the status pill + banner copy.
  const statusMismatch =
    isSunset && (status || "").toLowerCase() === "active";
  const effectiveStatus = isSunset ? "SUNSET" : (status || "Unknown");

  // ---- Purpose line ----
  const rawPurpose = (shortDescription || description || "").trim();
  const purpose =
    rawPurpose.length > 280 ? rawPurpose.slice(0, 280) + "…" : rawPurpose;

  // ---- KPI cell formatter ----
  const cell = (v: number | null | undefined) =>
    v == null ? "—" : v.toLocaleString();

  return (
    <section aria-labelledby="answer-block-name" style={{ marginBottom: 26 }}>
      {/* Sunset banner — first element when applicable */}
      {isSunset && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "color-mix(in srgb, var(--error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 40%, transparent)",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            color: "var(--error)",
          }}
        >
          <strong style={{ fontWeight: 600 }}>Sunset</strong>
          {" — decommissioned "}
          <span style={{ fontFamily: "var(--font-mono)" }}>{sunsetDate}</span>
          {". Data shown for reference only."}
          {statusMismatch && (
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              Status mismatch detected — CMDB lists {status} but
              decommissioned {sunsetDate}. Treating as sunset.
            </div>
          )}
        </div>
      )}

      {/* Non-CMDB / partial-CMDB notice */}
      {cmdbLinked === false && !isSunset && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            background: "color-mix(in srgb, var(--error) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            color: "var(--error)",
            fontFamily: "var(--font-mono)",
          }}
        >
          <strong>✗ not in CMDB</strong> — found in graph data only. Owners,
          classification, and deployment details unavailable.
        </div>
      )}
      {cmdbLinked === undefined && !isSunset && (
        <div
          role="status"
          style={{
            marginBottom: 16,
            padding: "8px 12px",
            background: "color-mix(in srgb, var(--accent) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
            borderRadius: "var(--radius-md)",
            fontSize: 12,
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
          }}
        >
          CMDB status unknown — some details may be unavailable.
        </div>
      )}

      {/* Title row */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--text-dim)",
          }}
        >
          {appId}
        </span>
        <h1
          id="answer-block-name"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            margin: 0,
            lineHeight: 1.2,
            color: "var(--text)",
          }}
        >
          {name || "(unnamed)"}
        </h1>
        {cmdbLinked === true && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--success)",
              letterSpacing: 0.4,
            }}
            aria-label="Linked in CMDB"
          >
            <span aria-hidden="true" style={{ marginRight: 4 }}>
              ✓
            </span>
            cmdb-linked
          </span>
        )}
        <Pill
          label={effectiveStatus}
          tone={isSunset ? "red" : statusToPillTone(status)}
        />
        {pills.map((p, i) => (
          <Pill key={`${p.label}-${i}`} label={p.label} tone={p.tone} />
        ))}
        <span style={{ flex: 1 }} />
        {lastUpdated && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
            title={lastUpdated}
          >
            Updated {relativeTime(lastUpdated)}
          </span>
        )}
      </div>

      {/* Purpose */}
      {purpose ? (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 500,
            fontSize: 16,
            color: "var(--text)",
            lineHeight: 1.55,
            maxWidth: 980,
            margin: "0 0 24px 0",
          }}
        >
          {purpose}
        </p>
      ) : (
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--text-dim)",
            margin: "0 0 24px 0",
          }}
        >
          (no description)
        </p>
      )}

      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1px 1fr 1px 1fr",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          background: "var(--surface)",
          padding: "18px 0",
          marginBottom: 22,
        }}
        aria-label="Summary counts"
      >
        <KpiCell label="integrations" value={cell(kpis.integrations)} />
        <div style={{ background: "var(--border)" }} />
        <KpiCell label="capabilities" value={cell(kpis.capabilities)} />
        <div style={{ background: "var(--border)" }} />
        <KpiCell label="investments" value={cell(kpis.investments)} />
      </div>

      {/* Metadata rows */}
      <MetadataList rows={metadata} />
    </section>
  );
}

function KpiCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: 60,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-dim)",
          letterSpacing: 1.4,
          textTransform: "uppercase",
          marginTop: 6,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// pillToneForStatus moved to @/components/Pill as `statusToPillTone`
// (shared with OverviewTab + future entity detail pages).
