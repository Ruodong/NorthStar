"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, HubApp, KpiSummary, StatusBucket, TrendPoint } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  Keep: "#6ba6e8",
  Change: "#e8b458",
  New: "#e8716b",
  Sunset: "#6b7488",
  "3rd Party": "#a8b0c0",
};
const CHART_GRID = "#1c2230";
const CHART_AXIS = "#5f6a80";
const TOOLTIP_STYLE = {
  background: "#0c1017",
  border: "1px solid #2a3142",
  borderRadius: 4,
  fontFamily: "Geist, sans-serif",
  fontSize: 12,
};

interface MastersSummary {
  applications: number;
  projects: number;
  employees: number;
  diagram_apps: number;
  diagram_interactions: number;
}

interface ConfluenceSummary {
  totals?: { total_pages?: number; total_attachments?: number; downloaded?: number };
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [statusDist, setStatusDist] = useState<StatusBucket[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [hubs, setHubs] = useState<HubApp[]>([]);
  const [quality, setQuality] = useState<{ bucket: string; count: number }[]>([]);
  const [masters, setMasters] = useState<MastersSummary | null>(null);
  const [cfl, setCfl] = useState<ConfluenceSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, sd, t, h, q, mRes, cflRes] = await Promise.all([
          api.summary(),
          api.statusDistribution(),
          api.trend(),
          api.hubs(10),
          api.qualityScores(),
          fetch("/api/masters/summary", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/admin/confluence/summary", { cache: "no-store" }).then((r) => r.json()),
        ]);
        setSummary(s);
        setStatusDist(sd);
        setTrend(t);
        setHubs(h);
        setQuality(q.distribution);
        if (mRes.success) setMasters(mRes.data);
        if (cflRes.success) setCfl(cflRes.data);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  return (
    <div>
      <h1>Management Dashboard</h1>
      <p className="subtitle">Architecture KPIs, trends, and AI quality scores</p>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      {/* Row 1: Architecture Graph — sourced from Neo4j (Confluence drawio → parsed) */}
      <SectionLabel source="Architecture Graph · Neo4j · parsed from Confluence drawio" />
      <div className="kpi-grid">
        <Kpi
          label="Apps in graph"
          value={summary?.total_apps ?? 0}
          href="/graph"
          hint="Unique Application nodes"
        />
        <Kpi
          label="Integrations"
          value={summary?.total_integrations ?? 0}
          href="/graph"
          hint="INTEGRATES_WITH edges"
        />
        <Kpi
          label="New apps (current FY)"
          value={summary?.new_apps_current_fy ?? 0}
          href="/graph?status=New"
          hint="from drawio fillColor"
        />
        <Kpi
          label="Sunset apps"
          value={summary?.sunset_apps ?? 0}
          href="/graph?status=Sunset"
          hint="from drawio fillColor"
        />
      </div>

      {/* Row 2: Master Data — sourced from PG ref_* (EGM sync) */}
      <SectionLabel source="Master Data · Postgres · synced from EGM" />
      <div className="kpi-grid">
        <Kpi
          label="Active apps (TCO)"
          value={masters?.applications ?? 0}
          href="/admin/applications"
          hint="ref_application_tco"
        />
        <Kpi
          label="MSPO projects"
          value={masters?.projects ?? 0}
          href="/admin/projects"
          hint="ref_project"
        />
        <Kpi
          label="Confluence pages"
          value={cfl?.totals?.total_pages ?? 0}
          href="/admin/confluence"
          hint="scanned from ARD space"
        />
        <Kpi
          label="Attachments downloaded"
          value={cfl?.totals?.downloaded ?? 0}
          href="/admin/confluence"
          hint="drawio + image + pdf + office"
        />
      </div>

      <div className="panel-grid">
        <div className="panel">
          <div className="panel-title">Status Distribution</div>
          {statusDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={statusDist}
                  dataKey="count"
                  nameKey="status"
                  outerRadius={90}
                  stroke="#07090d"
                  strokeWidth={2}
                  label={{ fill: "#e7eaf0", fontSize: 11, fontFamily: "Geist" }}
                >
                  {statusDist.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status] || "#6ba6e8"} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "Geist" }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty">No data. Run an ingestion task first.</div>
          )}
        </div>
        <div className="panel">
          <div className="panel-title">Fiscal-Year Change Trend</div>
          {trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trend}>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis dataKey="fiscal_year" stroke={CHART_AXIS} fontSize={11} />
                <YAxis stroke={CHART_AXIS} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="new_count" stroke={STATUS_COLORS.New} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="change_count" stroke={STATUS_COLORS.Change} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sunset_count" stroke={STATUS_COLORS.Sunset} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty">No data.</div>
          )}
        </div>
        <div className="panel">
          <div className="panel-title">Top Integration Hubs</div>
          {hubs.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hubs} layout="vertical">
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke={CHART_AXIS} fontSize={11} />
                <YAxis type="category" dataKey="name" stroke={CHART_AXIS} fontSize={11} width={150} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(246,166,35,0.08)" }} />
                <Bar dataKey="degree" fill="#f6a623" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty">No data.</div>
          )}
        </div>
        <div className="panel">
          <div className="panel-title">Architecture Quality Scores</div>
          {quality.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={quality}>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="bucket" stroke={CHART_AXIS} fontSize={11} />
                <YAxis stroke={CHART_AXIS} fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(246,166,35,0.08)" }} />
                <Bar dataKey="count" fill="#5fc58a" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty">No quality data yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value.toLocaleString()}</div>
      {hint && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-dim)",
            marginTop: 6,
          }}
        >
          {hint}
        </div>
      )}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="kpi-card"
        style={{ textDecoration: "none", cursor: "pointer" }}
      >
        {body}
      </Link>
    );
  }
  return <div className="kpi-card">{body}</div>;
}

function SectionLabel({ source }: { source: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.7,
        color: "var(--accent)",
        marginBottom: 10,
        marginTop: 8,
      }}
    >
      {source}
    </div>
  );
}
