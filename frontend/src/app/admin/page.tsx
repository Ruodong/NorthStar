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
      <h1>Master Data Overview</h1>
      <p className="subtitle">
        Raw master data mirrored from EGM and Confluence. Sourced from{" "}
        <code>egm-postgres</code> and <code>km.xpaas.lenovo.com</code>.
      </p>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      <div className="kpi-grid">
        <Stat label="Applications" value={summary?.applications} href="/admin/applications" />
        <Stat label="Projects (MSPO)" value={summary?.projects} href="/admin/projects" />
        <Stat label="Employees" value={summary?.employees} />
        <Stat
          label="Parsed diagrams (EGM)"
          value={summary?.diagram_apps}
          sublabel={`${summary?.diagram_interactions ?? "—"} integrations`}
        />
      </div>

      <div className="panel-grid">
        <SourcePanel
          title="EGM Master Data"
          desc="Synced from egm-postgres via scripts/sync_from_egm.py — 6 tables, updated on demand."
          items={[
            ["ref_application", "CMDB application registry", "3,168 rows"],
            ["ref_employee", "Full employee directory + manager chain", "79,703 rows"],
            ["ref_project", "MSPO project master (PM / DT / IT Lead)", "2,356 rows"],
            ["ref_request", "Governance review requests", "4,172 rows"],
            ["ref_diagram", "EGM parsed drawio (with XML)", "28 rows"],
            ["ref_diagram_app / ref_diagram_interaction", "Per-diagram extracted apps & edges", "297 / 241"],
          ]}
        />
        <SourcePanel
          title="Confluence Raw"
          desc="Scanned from Architecture & Solution Review space (ARD). Run scripts/scan_confluence.py to refresh."
          items={[
            ["FY2122 → FY2627 Projects", "Parent pages per fiscal year", "6 FYs"],
            ["Project pages", "Review pages with attachments", "2000+"],
            ["Attachments", "drawio / png / pdf / pptx raw files", "—"],
          ]}
        />
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

function SourcePanel({
  title,
  desc,
  items,
}: {
  title: string;
  desc: string;
  items: [string, string, string][];
}) {
  return (
    <div className="panel">
      <div className="panel-title">{title}</div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 0, marginBottom: 18 }}>
        {desc}
      </p>
      <table>
        <thead>
          <tr>
            <th>Table</th>
            <th>Description</th>
            <th style={{ textAlign: "right" }}>Size</th>
          </tr>
        </thead>
        <tbody>
          {items.map(([t, d, s]) => (
            <tr key={t}>
              <td>
                <code>{t}</code>
              </td>
              <td style={{ color: "var(--text-muted)" }}>{d}</td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-dim)",
                }}
              >
                {s}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
