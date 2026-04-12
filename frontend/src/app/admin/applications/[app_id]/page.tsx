"use client";

import { useParams, redirect } from "next/navigation";

// Redirect to the unified /apps/{app_id} page.
// The admin applications detail view has been merged into the main
// app detail page which now includes CMDB fields, TCO, diagrams,
// integrations, and Confluence review pages.
export default function AdminApplicationRedirect() {
  const params = useParams();
  const appId = params.app_id as string;
  redirect(`/apps/${encodeURIComponent(appId)}`);
}
