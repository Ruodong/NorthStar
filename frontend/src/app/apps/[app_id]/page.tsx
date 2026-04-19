// Server Component (no "use client" — runs on the Next server).
//
// Fetches the App Detail payload server-side via fetchAppDetail() so the
// initial HTML the user sees already contains the title row, KPI counts,
// CMDB pills, and the Overview tab content. No client-side loading flash.
//
// Falls through to:
//   - not-found.tsx  when fetchAppDetail() returns null (404 from backend)
//   - error.tsx      when fetchAppDetail() throws (backend 5xx / network)
//
// Two non-blocking secondary fetches (capCount + deployCount for tab
// badges) still happen client-side inside AppDetailClient.

import { notFound } from "next/navigation";
import { fetchAppDetail } from "@/lib/api-server";
import AppDetailClient from "./AppDetailClient";

export default async function Page({
  params,
}: {
  params: { app_id: string };
}) {
  const appId = decodeURIComponent(params.app_id);
  const data = await fetchAppDetail(appId);
  if (!data) notFound();
  return <AppDetailClient initialData={data} appId={appId} />;
}
