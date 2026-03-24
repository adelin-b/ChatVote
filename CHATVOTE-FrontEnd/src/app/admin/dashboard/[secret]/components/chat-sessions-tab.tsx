"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  ThumbsDown,
} from "lucide-react";

import ChatDetailPanel from "./chat-detail-panel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatSessionsTabProps {
  secret: string;
  apiUrl: string;
  timeRange: number;
  active?: boolean;
}

interface ChatSession {
  session_id: string;
  municipality_code?: string;
  municipality_name?: string;
  created_at?: string;
  updated_at?: string;
  question_count?: number;
  has_negative_feedback?: boolean;
  debug?: {
    response_time_ms?: number;
    source_count?: number;
    model_used?: string;
    status?: "success" | "error" | "partial";
    error_messages?: string[];
    total_tokens?: number;
  };
}

interface SessionsResponse {
  sessions: ChatSession[];
  total: number;
  has_more: boolean;
  next_cursor?: string;
  limit: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;
const PAGE_SIZE = 50;

type StatusFilter = "all" | "success" | "error" | "partial" | "flagged";

function shouldFlagRow(session: ChatSession): boolean {
  return (
    session.debug?.status === "error" ||
    session.debug?.source_count === 0 ||
    session.has_negative_feedback === true
  );
}

function StatusDot({ status }: { status?: string }) {
  if (status === "success")
    return <span className="size-2.5 shrink-0 rounded-full bg-green-500" />;
  if (status === "error")
    return <span className="size-2.5 shrink-0 rounded-full bg-red-500/100" />;
  if (status === "partial")
    return (
      <span className="size-2.5 shrink-0 rounded-full bg-yellow-500/100" />
    );
  return <span className="size-2.5 shrink-0 rounded-full bg-gray-300" />;
}

function formatTime(ts?: string): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMs(ms?: number): string {
  if (ms === undefined || ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Chat Sessions Tab
// ---------------------------------------------------------------------------

export default function ChatSessionsTab({
  secret,
  apiUrl,
  timeRange,
  active,
}: ChatSessionsTabProps) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef<() => void>(() => {});

  const fetchSessions = useCallback(
    async (reset = false) => {
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          order: "desc",
          sort_by: "updated_at",
        });
        if (!reset && nextCursor) params.set("cursor_after", nextCursor);
        if (statusFilter !== "all" && statusFilter !== "flagged")
          params.set("status", statusFilter);
        if (timeRange > 0) {
          const since = new Date(
            Date.now() - timeRange * 60 * 60 * 1000,
          ).toISOString();
          params.set("since", since);
        }

        const res = await fetch(
          `${apiUrl}/api/v1/admin/chat-sessions?${params}`,
          {
            headers: { "X-Admin-Secret": secret },
            cache: "no-store",
          },
        );
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data: SessionsResponse = await res.json();

        if (reset) {
          setSessions(data.sessions);
        } else {
          setSessions((prev) => [...prev, ...data.sessions]);
        }
        setHasMore(data.has_more);
        setNextCursor(data.next_cursor ?? null);
        setError(null);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch sessions",
        );
      } finally {
        setLoading(false);
      }
    },
    [secret, apiUrl, statusFilter, timeRange, nextCursor],
  );

  // Initial load + filter/timeRange changes
  useEffect(() => {
    setLoading(true);
    setSessions([]);
    setNextCursor(null);
    fetchSessions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, timeRange, secret, apiUrl]);

  // Polling
  fetchRef.current = () => fetchSessions(true);

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

  function loadMore() {
    fetchSessions(false);
  }

  function toggleExpand(sessionId: string) {
    setExpandedSession((prev) => (prev === sessionId ? null : sessionId));
  }

  const displayedSessions =
    statusFilter === "flagged" ? sessions.filter(shouldFlagRow) : sessions;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <label
            htmlFor="status-filter"
            className="text-muted-foreground text-xs font-medium"
          >
            Status:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="border-border-subtle bg-card text-foreground focus:ring-ring rounded border px-2.5 py-1.5 text-xs focus:ring-1 focus:outline-none"
          >
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="partial">Partial</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loading && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
          <span className="text-muted-foreground text-xs">
            {displayedSessions.length} session
            {displayedSessions.length !== 1 ? "s" : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchSessions(true)}
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

      {/* Table */}
      {!loading && displayedSessions.length === 0 && !error && (
        <div className="border-border-subtle bg-card text-muted-foreground rounded-xl border py-16 text-center text-sm">
          No chat sessions found.
        </div>
      )}

      {displayedSessions.length > 0 && (
        <div className="border-border-subtle bg-card overflow-hidden rounded-xl border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border-subtle bg-background border-b text-left">
                  <th className="text-muted-foreground w-8 px-4 py-3 text-xs font-semibold tracking-wider uppercase" />
                  <th className="text-muted-foreground px-4 py-3 text-xs font-semibold tracking-wider uppercase">
                    Timestamp
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-xs font-semibold tracking-wider uppercase">
                    Session ID
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-xs font-semibold tracking-wider uppercase">
                    Commune
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-right text-xs font-semibold tracking-wider uppercase">
                    Sources
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-center text-xs font-semibold tracking-wider uppercase">
                    Status
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-right text-xs font-semibold tracking-wider uppercase">
                    Resp. time
                  </th>
                  <th className="text-muted-foreground px-4 py-3 text-xs font-semibold tracking-wider uppercase">
                    Model
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border-subtle divide-y">
                {displayedSessions.map((session) => (
                  <Fragment key={session.session_id}>
                    <tr
                      className={`cursor-pointer transition-colors ${
                        shouldFlagRow(session)
                          ? "bg-red-500/10 hover:bg-red-500/15"
                          : "hover:bg-surface-elevated"
                      }`}
                      onClick={() => toggleExpand(session.session_id)}
                    >
                      <td className="text-muted-foreground px-4 py-3">
                        {expandedSession === session.session_id ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs whitespace-nowrap">
                        {formatTime(session.updated_at ?? session.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-muted-foreground font-mono text-xs">
                          {session.session_id.slice(0, 12)}…
                        </span>
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {session.municipality_name ?? "—"}
                        {session.municipality_code && (
                          <span className="text-muted-foreground ml-1 font-mono text-[10px]">
                            {session.municipality_code}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right text-xs tabular-nums">
                        {session.debug?.source_count ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          <StatusDot status={session.debug?.status} />
                          <span className="text-muted-foreground text-xs">
                            {session.debug?.status ?? "—"}
                          </span>
                          {session.debug?.source_count === 0 && (
                            <span className="rounded bg-red-500/15 px-1 py-0.5 text-[10px] font-medium text-red-400">
                              0 src
                            </span>
                          )}
                          {session.has_negative_feedback && (
                            <span className="flex items-center gap-0.5 rounded bg-red-500/15 px-1 py-0.5 text-[10px] font-medium text-red-400">
                              <ThumbsDown className="size-2.5" />
                              dislike
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-right text-xs whitespace-nowrap tabular-nums">
                        {formatMs(session.debug?.response_time_ms)}
                      </td>
                      <td className="text-muted-foreground max-w-[120px] truncate px-4 py-3 font-mono text-xs">
                        {session.debug?.model_used ?? "—"}
                      </td>
                    </tr>

                    {expandedSession === session.session_id && (
                      <tr key={`${session.session_id}-detail`}>
                        <td colSpan={8} className="p-0">
                          <ChatDetailPanel
                            sessionId={session.session_id}
                            secret={secret}
                            apiUrl={apiUrl}
                            onClose={() => setExpandedSession(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="border-border-subtle border-t px-4 py-3 text-center">
              <Button
                size="sm"
                variant="outline"
                onClick={loadMore}
                className="text-xs"
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
