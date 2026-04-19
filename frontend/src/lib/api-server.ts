// Server-only fetch wrappers for App Router RSC pages.
//
// `import "server-only"` makes Next refuse to bundle this module into the
// client; if any client component accidentally imports it, the build fails
// with a clear error rather than leaking server secrets at runtime.
//
// All wrappers read `process.env.BACKEND_URL`, which docker-compose sets to
// `http://host.docker.internal:8001` (frontend container reaches the host-
// network backend via the docker-bridge gateway). Local dev fallback is the
// same legacy bridge alias next.config.mjs uses for `/api/*` rewrites.

import "server-only";
import type { AppDetailResponse } from "@/app/apps/[app_id]/_shared/types";

const BACKEND_URL =
  process.env.BACKEND_URL || "http://host.docker.internal:8001";

function url(path: string): string {
  return `${BACKEND_URL.replace(/\/+$/, "")}${path}`;
}

/**
 * Fetch the full app-detail payload (graph node + CMDB enrichment +
 * investments + diagrams + confluence + tco + review_pages).
 *
 * Returns `null` when the backend reports 404 (app not found in either
 * graph or CMDB). Throws on every other error so the route's `error.tsx`
 * boundary catches it.
 *
 * Mirrors GET /api/graph/nodes/{app_id} in
 * backend/app/services/graph_query.py::get_application().
 */
export async function fetchAppDetail(
  appId: string,
): Promise<AppDetailResponse | null> {
  const res = await fetch(
    url(`/api/graph/nodes/${encodeURIComponent(appId)}`),
    {
      cache: "no-store",
      // Server-side fetch: no Next data cache or React cache. We rely on
      // backend's own response semantics for freshness.
    },
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(
      `Backend GET /api/graph/nodes/${appId} → ${res.status} ${res.statusText}`,
    );
  }

  const j = await res.json();
  if (!j.success) {
    throw new Error(
      j.error || `Backend GET /api/graph/nodes/${appId} returned success=false`,
    );
  }
  return j.data as AppDetailResponse;
}
