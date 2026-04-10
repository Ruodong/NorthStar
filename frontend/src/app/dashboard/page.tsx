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
  Keep: "#6bb6ff",
  Change: "#f4c571",
  New: "#f4857c",
  Sunset: "#808a9e",
  "3rd Party": "#e6e9ef",
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
                  label
                >
                  {statusDist.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status] || "#6bb6ff"} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
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
                <CartesianGrid stroke="#1f2430" strokeDasharray="3 3" />
                <XAxis dataKey="fiscal_year" stroke="#8892a6" />
                <YAxis stroke="#8892a6" />
                <Tooltip contentStyle={{ background: "#141923", border: "1px solid #2a3142" }} />
                <Legend />
                <Line type="monotone" dataKey="new_count" stroke="#f4857c" />
                <Line type="monotone" dataKey="change_count" stroke="#f4c571" />
                <Line type="monotone" dataKey="sunset_count" stroke="#808a9e" />
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
                <CartesianGrid stroke="#1f2430" strokeDasharray="3 3" />
                <XAxis type="number" stroke="#8892a6" />
                <YAxis type="category" dataKey="name" stroke="#8892a6" width={140} />
                <Tooltip contentStyle={{ background: "#141923", border: "1px solid #2a3142" }} />
                <Bar dataKey="degree" fill="#6bb6ff" />
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
                <CartesianGrid stroke="#1f2430" strokeDasharray="3 3" />
                <XAxis dataKey="bucket" stroke="#8892a6" />
                <YAxis stroke="#8892a6" />
                <Tooltip contentStyle={{ background: "#141923", border: "1px solid #2a3142" }} />
                <Bar dataKey="count" fill="#7cd99b" />
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
