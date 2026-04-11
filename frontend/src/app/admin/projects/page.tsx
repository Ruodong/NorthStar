"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pager } from "@/components/Pager";

interface ProjectRow {
  project_id: string;
  project_name: string | null;
  type: string | null;
  status: string | null;
  pm: string | null;
  it_lead: string | null;
  dt_lead: string | null;
  start_date: string | null;
  go_live_date: string | null;
  end_date: string | null;
  source: string | null;
}

interface ListResult {
  total: number;
  rows: ProjectRow[];
}

const PAGE_SIZE = 50;

interface StatusCount {
  status: string;
  count: number;
}

export default function AdminProjects() {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [statuses, setStatuses] = useState<StatusCount[]>([]);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/masters/projects/statuses", { cache: "no-store" });
        const j = await r.json();
        if (j.success) setStatuses(j.data);
      } catch {
        // non-blocking
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (qDebounced) params.set("q", qDebounced);
        if (status) params.set("status", status);
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        const r = await fetch(`/api/masters/projects?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        if (!cancelled) setData(j.data);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qDebounced, status, page]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div>
      <h1>Projects (MSPO)</h1>
      <p className="subtitle">
        MSPO project master data, synced via EGM. 2,356 rows. Each project tracks PM, DT
        Lead, IT Lead with itcodes, plus lifecycle dates.
      </p>

      <div className="toolbar">
        <input
          placeholder="Search by name or project ID (e.g. LI2500073)…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.status || "__EMPTY__"} value={s.status || "__EMPTY__"}>
              {s.status || "(empty)"} ({s.count.toLocaleString()})
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          {loading ? "loading…" : `${total.toLocaleString()} results`}
        </div>
      </div>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 130 }}>Project ID</th>
              <th>Name</th>
              <th style={{ width: 110 }}>Status</th>
              <th>PM</th>
              <th>IT Lead</th>
              <th>DT Lead</th>
              <th style={{ width: 110 }}>Go-live</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.project_id}>
                <td>
                  <Link
                    href={`/admin/projects/${encodeURIComponent(r.project_id)}`}
                    style={{ color: "var(--accent)" }}
                  >
                    <code>{r.project_id}</code>
                  </Link>
                </td>
                <td>
                  <Link
                    href={`/admin/projects/${encodeURIComponent(r.project_id)}`}
                    style={{ color: "var(--text)" }}
                  >
                    {r.project_name || "—"}
                  </Link>
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {r.status || "—"}
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{r.pm || "—"}</td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {r.it_lead || "—"}
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  {r.dt_lead || "—"}
                </td>
                <td
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-dim)",
                  }}
                >
                  {r.go_live_date || "—"}
                </td>
              </tr>
            ))}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty" style={{ padding: 40 }}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        maxPage={maxPage}
        total={total}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  );
}
