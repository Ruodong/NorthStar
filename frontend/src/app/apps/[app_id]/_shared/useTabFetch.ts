"use client";

import { useEffect, useState } from "react";

/**
 * Tab-local data-fetching hook with consistent abort + optional timeout.
 *
 * Every lazy-loaded tab on the App Detail page has the same pattern:
 *   - run a fetch when the tab becomes active or its dependency changes
 *   - track loading / error / data state
 *   - abort the in-flight request when the tab unmounts or deps change
 *   - optionally cap the request with a timeout
 *
 * Before this hook existed each tab duplicated that pattern inline with
 * subtle variants (some had `cancelled` flags, some had AbortController,
 * one had a 15s timeout). That duplication is where bugs like "badge
 * flashes 0 for a split second after switching apps" came from.
 *
 * Behavior locked in:
 *   - `AbortController`-based: new fetch aborts the previous one.
 *   - `timeoutMs` (default: none) aborts the request after the given ms.
 *   - `404` → `{ data: null, loading: false, err: null }` (not an error).
 *   - Non-200 non-404 → `{ err: "<status>", data: null }`.
 *   - JSON must be `{ success: true, data: ... }` (ApiResponse shape). A
 *     `success: false` response sets err to the backend-reported error.
 *   - Unmount / deps-change while in-flight → silent, no setState on
 *     stale closure.
 *
 * Used by all tab modules under apps/[app_id]/tabs/. The
 * KnowledgeBaseTab's 15-second timeout is preserved by passing
 * `{ timeoutMs: 15_000 }`.
 */
export interface TabFetchState<T> {
  data: T | null;
  loading: boolean;
  err: string | null;
}

export interface UseTabFetchOptions {
  /** Abort the request if it hasn't resolved after this many ms. */
  timeoutMs?: number;
  /**
   * Skip the fetch entirely if false (useful when the tab hasn't been
   * selected yet). Defaults to true — tabs that lazy-mount only create
   * the hook when active.
   */
  enabled?: boolean;
}

export function useTabFetch<T>(
  url: string | null,
  deps: React.DependencyList,
  opts: UseTabFetchOptions = {},
): TabFetchState<T> {
  const { timeoutMs, enabled = true } = opts;
  const [state, setState] = useState<TabFetchState<T>>({
    data: null,
    loading: enabled && !!url,
    err: null,
  });

  useEffect(() => {
    if (!enabled || !url) {
      setState({ data: null, loading: false, err: null });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timer =
      timeoutMs != null
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    setState((s) => ({ ...s, loading: true, err: null }));

    (async () => {
      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelled) return;

        if (res.status === 404) {
          setState({ data: null, loading: false, err: null });
          return;
        }
        if (!res.ok) {
          setState({ data: null, loading: false, err: `${res.status}` });
          return;
        }

        const j = await res.json();
        if (cancelled) return;

        if (!j.success) {
          setState({
            data: null,
            loading: false,
            err: j.error || "API error",
          });
          return;
        }
        setState({ data: j.data as T, loading: false, err: null });
      } catch (e: unknown) {
        if (cancelled) return;
        // AbortError is the "caller-aborted" signal — not a user-facing error.
        if (
          e instanceof DOMException &&
          (e.name === "AbortError" || e.name === "TimeoutError")
        ) {
          return;
        }
        setState({
          data: null,
          loading: false,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
