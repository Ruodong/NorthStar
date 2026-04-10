"use client";

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

export default function DashboardPage() {
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [statusDist, setStatusDist] = useState<StatusBucket[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [hubs, setHubs] = useState<HubApp[]>([]);
  const [quality, setQuality] = useState<{ bucket: string; count: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, sd, t, h, q] = await Promise.all([
          api.summary(),
          api.statusDistribution(),
          api.trend(),
          api.hubs(10),
          api.qualityScores(),
        ]);
        setSummary(s);
        setStatusDist(sd);
        setTrend(t);
        setHubs(h);
        setQuality(q.distribution);
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

      <div className="kpi-grid">
        <Kpi label="Total Apps" value={summary?.total_apps ?? 0} />
        <Kpi label="Total Integrations" value={summary?.total_integrations ?? 0} />
        <Kpi label="New Apps (current FY)" value={summary?.new_apps_current_fy ?? 0} />
        <Kpi label="Sunset Apps" value={summary?.sunset_apps ?? 0} />
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

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
