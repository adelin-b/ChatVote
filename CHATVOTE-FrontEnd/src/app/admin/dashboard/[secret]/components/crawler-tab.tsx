"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Activity,
} from "lucide-react";
import { Button } from "@components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrawlerTabProps {
  secret: string;
  apiUrl: string;
  active?: boolean;
}

interface FailedJob {
  id: number;
  state: string;
  errors: { attempt: number; error: string; run_at?: string }[];
  url: string;
}

interface ExecutingJob {
  id: number;
  url: string;
  attempted_at: string;
}

interface CompletedJob {
  id: number;
  url: string;
  attempted_at: string;
  completed_at: string;
}

interface StateCounts {
  completed?: number;
  executing?: number;
  retryable?: number;
  [key: string]: number | undefined;
}

interface CrawlerStatus {
  ok: boolean;
  queue: string;
  failed: FailedJob[];
  executing: ExecutingJob[];
  recent_completed: CompletedJob[];
  state_counts: StateCounts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(startTs: string, endTs?: string): string {
  const start = new Date(startTs).getTime();
  const end = endTs ? new Date(endTs).getTime() : Date.now();
  const diff = end - start;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function truncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + "…";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  color,
  icon,
  animated,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  animated?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-border-subtle bg-card p-4 flex items-center gap-3`}>
      <div className={`rounded-lg p-2 ${color}`}>
        <span className={animated ? "animate-pulse inline-flex" : "inline-flex"}>
          {icon}
        </span>
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="rounded-xl border border-border-subtle bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-surface-elevated transition-colors"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="ml-1 rounded-full bg-surface-elevated px-2 py-0.5 text-xs text-muted-foreground">
          {count}
        </span>
      </button>

      {open && <div className="border-t border-border-subtle">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crawler Tab
// ---------------------------------------------------------------------------

export default function CrawlerTab({ secret, apiUrl, active }: CrawlerTabProps) {
  const [status, setStatus] = useState<CrawlerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef<() => void>(() => {});

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/crawler/status`, {
        headers: { "X-Admin-Secret": secret },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: CrawlerStatus = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to fetch crawler status");
    } finally {
      setLoading(false);
    }
  }, [secret, apiUrl]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  fetchRef.current = fetchStatus;

  useEffect(() => {
    if (!active) return;
    pollRef.current = setInterval(() => fetchRef.current(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [active]);

  // Derived counts
  const counts = status?.state_counts ?? {};
  const completed = counts.completed ?? 0;
  const executing = counts.executing ?? 0;
  const retryable = (counts.retryable ?? 0) + (counts.discarded ?? 0);
  const total = Object.values(counts).reduce((a, b) => (a ?? 0) + (b ?? 0), 0) ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Crawler Status</h2>
        <div className="flex items-center gap-2">
          {loading && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            Auto-refresh every 10s
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchStatus}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {status && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Completed"
              value={completed}
              color="bg-green-500/10 text-green-400"
              icon={<CheckCircle2 className="size-5" />}
            />
            <SummaryCard
              label="Executing"
              value={executing}
              color="bg-blue-500/10 text-blue-400"
              icon={<Zap className="size-5" />}
              animated
            />
            <SummaryCard
              label="Failed / Discarded"
              value={retryable}
              color="bg-red-500/10 text-red-400"
              icon={<AlertTriangle className="size-5" />}
            />
            <SummaryCard
              label="Total Jobs"
              value={total}
              color="bg-surface-elevated text-muted-foreground"
              icon={<Activity className="size-5" />}
            />
          </div>

          {/* Progress bar */}
          <div className="rounded-xl border border-border-subtle bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span className="tabular-nums font-medium text-foreground">
                {completed} / {total} ({progressPct}%)
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-surface-elevated overflow-hidden">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Executing section */}
          <Section
            title="Currently Executing"
            count={status.executing.length}
            defaultOpen
          >
            {status.executing.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No jobs currently executing.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle bg-background">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground w-16">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        URL
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                        Started
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {status.executing.map((job) => (
                      <tr key={job.id} className="hover:bg-surface-elevated transition-colors">
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                          {job.id}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-xs">
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline truncate block"
                            title={job.url}
                          >
                            {truncateUrl(job.url)}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelative(job.attempted_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDuration(job.attempted_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Recently Completed section */}
          <Section
            title="Recently Completed"
            count={status.recent_completed.length}
          >
            {status.recent_completed.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No recently completed jobs.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle bg-background">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground w-16">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        URL
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                        Completed
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {status.recent_completed.map((job) => (
                      <tr key={job.id} className="hover:bg-surface-elevated transition-colors">
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                          {job.id}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-xs">
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:underline truncate block"
                            title={job.url}
                          >
                            {truncateUrl(job.url)}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatRelative(job.completed_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                          {formatDuration(job.attempted_at, job.completed_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Failed / Retryable section */}
          <Section
            title="Failed / Retryable"
            count={status.failed.length}
          >
            {status.failed.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No failed jobs.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle bg-background">
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground w-16">
                        ID
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        URL
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground text-center w-20">
                        Attempts
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Last Error
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground w-24">
                        State
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {status.failed.map((job) => {
                      const lastError =
                        job.errors.length > 0
                          ? job.errors[job.errors.length - 1].error
                          : null;
                      return (
                        <tr key={job.id} className="hover:bg-surface-elevated transition-colors">
                          <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                            {job.id}
                          </td>
                          <td className="px-4 py-3 text-xs max-w-xs">
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline truncate block"
                              title={job.url}
                            >
                              {truncateUrl(job.url)}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground text-center tabular-nums">
                            {job.errors.length}
                          </td>
                          <td className="px-4 py-3 text-xs text-red-400 max-w-sm">
                            <span
                              className="truncate block"
                              title={lastError ?? ""}
                            >
                              {lastError
                                ? lastError.length > 80
                                  ? lastError.slice(0, 80) + "…"
                                  : lastError
                                : "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-400">
                              {job.state}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {!loading && !status && !error && (
        <div className="rounded-xl border border-border-subtle bg-card py-16 text-center text-sm text-muted-foreground">
          No crawler data available.
        </div>
      )}
    </div>
  );
}
