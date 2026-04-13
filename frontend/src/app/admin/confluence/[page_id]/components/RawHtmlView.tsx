// RawHtmlView.tsx — sandboxed iframe display of raw Confluence HTML body
// Split from page.tsx for maintainability.

"use client";

import { useEffect, useState } from "react";

export function RawHtmlView({ pageId }: { pageId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/admin/confluence/pages/${pageId}/body`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setHtml(j.data.html);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [pageId]);

  if (err) return <div className="panel empty">Error: {err}</div>;
  if (html === null) return <div className="panel empty">Loading raw HTML…</div>;

  // Sandbox the HTML in an iframe with allow-same-origin=false so any scripts
  // or remote resources can't leak anything. We write into a blank srcdoc.
  const wrapped = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
             background: #fff; color: #172b4d; margin: 24px; max-width: 960px; }
      table { border-collapse: collapse; margin: 8px 0; width: 100%; }
      th, td { border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; vertical-align: top; }
      th { background: #f4f5f7; }
      h1, h2, h3 { color: #172b4d; }
      img { max-width: 100%; }
      code { background: #f4f5f7; padding: 2px 4px; border-radius: 3px; }
      a { color: #0052cc; }
    </style></head><body>${html}</body></html>`;

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <iframe
        sandbox=""
        srcDoc={wrapped}
        title="raw confluence body"
        style={{ width: "100%", height: 800, border: 0, background: "#fff" }}
      />
    </div>
  );
}
