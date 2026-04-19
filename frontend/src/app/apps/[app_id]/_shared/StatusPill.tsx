import { Pill } from "@/components/Pill";
import { STATUS_COLORS } from "./types";

// App-Detail-shared StatusPill — wraps the app-wide-shared Pill with
// status-specific color mapping.
// NOTE: a separate independent definition exists at
// admin/confluence/[page_id]/components/ExtractedView.tsx:58. Cross-page
// reconciliation deferred (T14).

export function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "var(--text-dim)";
  return <Pill label={status || "Unknown"} tone={color} />;
}
