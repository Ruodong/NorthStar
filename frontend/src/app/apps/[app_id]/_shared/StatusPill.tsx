import { Pill } from "@/components/Pill";
import { STATUS_COLORS } from "./types";

// App-Detail-shared StatusPill — wraps the app-wide-shared Pill with
// status-specific color mapping.
//
// T14 resolution (2026-04-19): a second StatusPill lives at
// `admin/confluence/[page_id]/components/ExtractedView.tsx`. It's
// intentionally different — 9px mono on rgba-03 background, for dense
// admin-table rows where the full Pill would dominate. Kept separate.
// Each file documents the other so new contributors don't rewrite
// either one.

export function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "var(--text-dim)";
  return <Pill label={status || "Unknown"} tone={color} />;
}
