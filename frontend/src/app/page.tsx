"use client";

/**
 * Cockpit — the NorthStar home screen.
 *
 * Post-repositioning layout: the architect's reference tool. Centered search
 * is the primary affordance. Secondary widgets show recent activity and
 * favorites so the page has content without requiring a query. The old
 * marketing-style feature cards moved out — Dashboard now lives at /dashboard.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

interface WhatsNewSummary {
  since: string;
  total: number;
  by_type: Record<string, number>;
  latest_diff_at: string | null;
}

interface KpiSummary {
  total_apps: number;
  total_integrations: number;
  new_apps_current_fy: number;
  sunset_apps: number;
}

interface RecentItem {
  kind: "app" | "project";
  id: string;
  label: string;
  ts: number;
}

export default function CockpitHome() {
  const [whatsNew, setWhatsNew] = useState<WhatsNewSummary | null>(null);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsMac(/mac/i.test(navigator.platform || navigator.userAgent));
    }
    try {
      const raw = window.localStorage.getItem("northstar.recentSearches");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecent(parsed as RecentItem[]);
      }
    } catch {
      /* ignore */
    }

    (async () => {
      try {
        const [wRes, kRes] = await Promise.all([
          fetch("/api/whats-new/summary?days=7", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/analytics/summary", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (wRes.success) setWhatsNew(wRes.data);
        if (kRes.success) setKpi(kRes.data);
      } catch {
        /* non-blocking */
      }
    })();
  }, []);

  const modifierKey = isMac ? "⌘" : "Ctrl";

  return (
    <div>
      {/* ---------------- Hero / search CTA ---------------- */}
      <div
        style={{
          textAlign: "center",
          marginTop: 40,
          marginBottom: 56,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--accent)",
            marginBottom: 16,
          }}
        >
          IT Architect Workbench
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 44,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: -0.5,
            maxWidth: 780,
            margin: "0 auto 14px",
          }}
        >
          Find any application.
          <br />
          Understand its blast radius.
        </h1>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: 15,
            maxWidth: 620,
            margin: "0 auto 32px",
            lineHeight: 1.55,
          }}
        >
          NorthStar is Lenovo&apos;s IT architecture reference tool — a queryable
          knowledge graph extracted from every draw.io review diagram across 5 fiscal
          years.
        </p>

        <SearchCta modifierKey={modifierKey} />
      </div>

      {/* ---------------- Live metrics ---------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <MetricCard
          label="Total applications"
          value={kpi ? kpi.total_apps.toLocaleString() : "—"}
          link="/applications"
          linkLabel="browse"
        />
        <MetricCard
          label="Integrations"
          value={kpi ? kpi.total_integrations.toLocaleString() : "—"}
          link="/graph"
          linkLabel="graph"
        />
        <MetricCard
          label="Changes last 7 days"
          value={whatsNew ? whatsNew.total.toLocaleString() : "—"}
          link="/whats-new"
          linkLabel="what's new"
          accent
        />
        <MetricCard
          label="Sunset apps"
          value={kpi ? kpi.sunset_apps.toLocaleString() : "—"}
        />
      </div>

      {/* ---------------- Two-column: recent + what's new ---------------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 40,
        }}
      >
        <Panel
          title="Recent searches"
          action={
            recent.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  window.localStorage.removeItem("northstar.recentSearches");
                  setRecent([]);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  fontSize: 10,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                Clear
              </button>
            ) : null
          }
        >
          {recent.length === 0 ? (
            <EmptyHint>
              Press{" "}
              <kbd style={kbdStyle}>
                {modifierKey}
                +K
              </kbd>{" "}
              or{" "}
              <kbd style={kbdStyle}>/</kbd>{" "}
              to open search. Your recent queries will appear here.
            </EmptyHint>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {recent.slice(0, 8).map((r) => (
                <li
                  key={`${r.kind}-${r.id}`}
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    fontSize: 13,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      padding: "2px 6px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text-muted)",
                      borderRadius: "var(--radius-sm)",
                      fontFamily: "var(--font-mono)",
                      textTransform: "uppercase",
                      minWidth: 38,
                      textAlign: "center",
                    }}
                  >
                    {r.kind === "app" ? "APP" : "PROJ"}
                  </span>
                  <Link
                    href={
                      r.kind === "app"
                        ? `/apps/${encodeURIComponent(r.id)}`
                        : `/projects/${encodeURIComponent(r.id)}`
                    }
                    style={{
                      color: "var(--text)",
                      textDecoration: "none",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.label}
                  </Link>
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                    }}
                  >
                    {r.id}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="What's new — last 7 days"
          action={
            <Link
              href="/whats-new"
              style={{
                color: "var(--accent)",
                textDecoration: "none",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.6,
              }}
            >
              View all →
            </Link>
          }
        >
          {whatsNew === null ? (
            <EmptyHint>loading…</EmptyHint>
          ) : whatsNew.total === 0 ? (
            <EmptyHint>
              No changes detected in the last 7 days. Run the weekly sync to refresh.
            </EmptyHint>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              <DiffLine label="New apps" count={whatsNew.by_type.app_added || 0} />
              <DiffLine
                label="Status changes"
                count={whatsNew.by_type.app_status_changed || 0}
              />
              <DiffLine
                label="Description changes"
                count={whatsNew.by_type.app_description_changed || 0}
              />
              <DiffLine
                label="Name changes"
                count={whatsNew.by_type.app_name_changed || 0}
              />
              {whatsNew.latest_diff_at && (
                <li
                  style={{
                    marginTop: 12,
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  Latest:{" "}
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {new Date(whatsNew.latest_diff_at)
                      .toISOString()
                      .slice(0, 16)
                      .replace("T", " ")}
                  </code>
                </li>
              )}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---------------- Secondary links ---------------- */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 20,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        <SecondaryLink
          href="/applications"
          tag="01"
          title="Applications"
          desc="CMDB application registry"
        />
        <SecondaryLink
          href="/projects"
          tag="02"
          title="Projects"
          desc="Architecture review projects"
        />
        <SecondaryLink
          href="/graph"
          tag="03"
          title="Asset graph"
          desc="Network visualization"
        />
        <SecondaryLink
          href="/admin"
          tag="04"
          title="Admin"
          desc="Ingestion & raw data"
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------

function SearchCta({ modifierKey }: { modifierKey: string }) {
  // This button simulates a Cmd+K press. Since CommandPalette listens
  // globally for Cmd+K, we dispatch a keyboard event to open it.
  const openPalette = () => {
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: true,
      ctrlKey: true,
      bubbles: true,
    });
    window.dispatchEvent(ev);
  };

  return (
    <button
      type="button"
      onClick={openPalette}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 16,
        padding: "14px 20px",
        minWidth: 440,
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        cursor: "pointer",
        color: "var(--text-muted)",
        fontSize: 14,
        fontFamily: "var(--font-body)",
        transition: "all var(--t-hover) var(--ease)",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "var(--accent)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
        {">"}
      </span>
      <span style={{ flex: 1, textAlign: "left" }}>
        Search applications, projects…
      </span>
      <kbd
        style={{
          padding: "3px 8px",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
          background: "var(--bg-elevated)",
        }}
      >
        {modifierKey}
        +K
      </kbd>
    </button>
  );
}

function MetricCard({
  label,
  value,
  link,
  linkLabel,
  accent,
}: {
  label: string;
  value: string;
  link?: string;
  linkLabel?: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: accent ? "2px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 32,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: accent ? "var(--accent)" : "var(--text)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {link && (
        <Link
          href={link}
          style={{
            marginTop: 8,
            display: "inline-block",
            fontSize: 10,
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            textDecoration: "none",
          }}
        >
          {linkLabel || "view"} →
        </Link>
      )}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
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
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--text-muted)",
          }}
        >
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: "var(--text-dim)",
        fontSize: 12,
        padding: "12px 0",
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

function DiffLine({ label, count }: { label: string; count: number }) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        fontSize: 13,
        color: count > 0 ? "var(--text)" : "var(--text-dim)",
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
          color: count > 0 ? "var(--accent)" : "var(--text-dim)",
          fontWeight: 600,
        }}
      >
        {count}
      </span>
    </li>
  );
}

function SecondaryLink({
  href,
  tag,
  title,
  desc,
}: {
  href: string;
  tag: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        textDecoration: "none",
        transition: "border-color var(--t-hover) var(--ease)",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "var(--border-strong)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--accent)",
          marginBottom: 4,
        }}
      >
        {tag}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text)",
          marginBottom: 2,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted)",
        }}
      >
        {desc}
      </div>
    </Link>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: "1px 6px",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--text-muted)",
  background: "var(--bg-elevated)",
};
