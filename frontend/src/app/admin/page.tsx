"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface MastersSummary {
  applications: number;
  employees: number;
  projects: number;
  diagram_apps: number;
  diagram_interactions: number;
}

export default function AdminOverview() {
  const [summary, setSummary] = useState<MastersSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/masters/summary", { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setSummary(j.data);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  return (
    <div>
      <h1>Reference Data Overview</h1>
      <p className="subtitle">
        Reference data from Confluence ARD, CMDB, and MSPO. Click a card to drill into
        the table, or jump to Confluence Raw to inspect the source files.
      </p>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <Stat label="Applications" value={summary?.applications} href="/admin/applications" />
        <Stat label="Projects (MSPO)" value={summary?.projects} href="/admin/projects" />
        <Stat
          label="Parsed diagrams (EGM)"
          value={summary?.diagram_apps}
          sublabel={`${summary?.diagram_interactions ?? "—"} integrations`}
        />
      </div>

      <div className="panel">
        <div className="panel-title">Confluence Raw Data</div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 18 }}>
          Scanned from the Architecture &amp; Solution Review space (ARD). Run{" "}
          <code>scripts/scan_confluence.py</code> to refresh. Every project page and
          attachment (drawio, png, pdf, pptx) is indexed with the original URL and a local
          copy, so you can review any raw file inline from the Confluence Raw tab.
        </p>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Description</th>
              <th style={{ textAlign: "right" }}>Size</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>FY2122 → FY2627 Projects</code>
              </td>
              <td style={{ color: "var(--text-muted)" }}>Parent pages per fiscal year</td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dim)",
                }}
              >
                6 FYs
              </td>
            </tr>
            <tr>
              <td>
                <code>Project pages</code>
              </td>
              <td style={{ color: "var(--text-muted)" }}>Review pages with attachments</td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dim)",
                }}
              >
                2000+
              </td>
            </tr>
            <tr>
              <td>
                <code>Attachments</code>
              </td>
              <td style={{ color: "var(--text-muted)" }}>
                drawio / png / pdf / pptx raw files
              </td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dim)",
                }}
              >
                —
              </td>
            </tr>
          </tbody>
        </table>
        <div style={{ marginTop: 16 }}>
          <Link href="/admin/confluence" className="btn">
            Open Confluence Raw →
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  href,
  sublabel,
}: {
  label: string;
  value?: number;
  href?: string;
  sublabel?: string;
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value === undefined ? "—" : value.toLocaleString()}
      </div>
      {sublabel && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            marginTop: 6,
          }}
        >
          {sublabel}
        </div>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="kpi-card" style={{ textDecoration: "none" }}>
        {body}
      </Link>
    );
  }
  return <div className="kpi-card">{body}</div>;
}
