import Link from "next/link";

export default function Home() {
  return (
    <div>
      <h1>NorthStar</h1>
      <p className="subtitle">
        IT Operational Command System — a queryable, navigable knowledge graph of IT architecture
        assets, inspired by Palantir&apos;s Ontology concept.
      </p>

      <div className="panel-grid">
        <div className="panel">
          <h2>Management Dashboard</h2>
          <p className="subtitle">
            KPIs, status distribution, per-FY trends, integration hubs, AI quality scores.
          </p>
          <Link href="/dashboard" className="btn">
            Open dashboard →
          </Link>
        </div>
        <div className="panel">
          <h2>Asset Graph</h2>
          <p className="subtitle">
            Force-directed graph of applications and their integrations. Search, filter, and drill in.
          </p>
          <Link href="/graph" className="btn">
            Open graph →
          </Link>
        </div>
        <div className="panel full">
          <h2>Ingestion Console</h2>
          <p className="subtitle">
            Run Confluence draw.io ingestion, review task history and AI quality evaluation results.
          </p>
          <Link href="/ingestion" className="btn">
            Open ingestion →
          </Link>
        </div>
      </div>
    </div>
  );
}
