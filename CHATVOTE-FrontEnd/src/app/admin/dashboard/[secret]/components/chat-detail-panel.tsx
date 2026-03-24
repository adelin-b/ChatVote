"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

interface ChatDetailPanelProps {
  sessionId: string;
  secret: string;
  apiUrl: string;
  onClose: () => void;
}

/** A single sub-message inside a grouped message doc */
interface SubMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Array<{ id: string; score?: number; text?: string }>;
  party_id?: string;
  party_name?: string;
  feedback?: { feedback: "like" | "dislike"; detail?: string };
}

/** Raw grouped-message document from Firestore */
interface GroupedMessageDoc {
  id: string;
  role: "user" | "assistant";
  created_at: string;
  messages?: SubMessage[];
  /** Legacy flat fields (in case some docs use them) */
  content?: string;
  sources?: Array<{ id: string; score?: number; text?: string }>;
}

/** Flattened message for display */
interface FlatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Array<{ id: string; score?: number; text?: string }>;
  party_id?: string;
  party_name?: string;
  feedback?: { feedback: "like" | "dislike"; detail?: string };
}

interface SessionDetail {
  session_id: string;
  municipality_code?: string;
  municipality_name?: string;
  created_at?: string;
  updated_at?: string;
  messages: GroupedMessageDoc[];
  debug?: {
    response_time_ms?: number;
    source_count?: number;
    model_used?: string;
    status?: string;
    error_messages?: string[];
    total_tokens?: number;
  };
}

/** Flatten grouped message docs into individual display messages */
function flattenMessages(docs: GroupedMessageDoc[]): FlatMessage[] {
  const result: FlatMessage[] = [];
  for (const doc of docs) {
    if (doc.messages && doc.messages.length > 0) {
      for (const sub of doc.messages) {
        result.push({
          id: sub.id || doc.id,
          role: sub.role || doc.role,
          content: sub.content || "",
          created_at: sub.created_at || doc.created_at,
          sources: sub.sources,
          party_id: sub.party_id,
          party_name: sub.party_name,
          feedback: sub.feedback,
        });
      }
    } else if (doc.content) {
      // Legacy flat format
      result.push({
        id: doc.id,
        role: doc.role,
        content: doc.content,
        created_at: doc.created_at,
        sources: doc.sources,
      });
    }
  }
  return result;
}

export default function ChatDetailPanel({
  sessionId,
  secret,
  apiUrl,
  onClose,
}: ChatDetailPanelProps) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(
    new Set(),
  );

  const flatMessages = useMemo(
    () => (detail ? flattenMessages(detail.messages) : []),
    [detail],
  );

  const chatUrl = `/chat/${sessionId}`;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${apiUrl}/api/v1/admin/chat-sessions/${sessionId}`,
          {
            headers: { "X-Admin-Secret": secret },
            cache: "no-store",
          },
        );
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data: SessionDetail = await res.json();
        if (!cancelled) setDetail(data);
      } catch (err: unknown) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load session",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, secret, apiUrl]);

  function toggleSources(msgId: string) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }

  function formatTime(ts?: string) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <div className="border-border-subtle bg-background border-t">
      {/* Panel header */}
      <div className="border-border-subtle bg-card flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-foreground text-sm font-semibold">
            Session Detail
          </h3>
          <span className="text-muted-foreground font-mono text-xs">
            {sessionId}
          </span>
          <a
            href={chatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-400 transition-colors hover:bg-blue-500/25"
          >
            <ExternalLink className="size-3" />
            Open chat
          </a>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:bg-surface-elevated hover:text-foreground rounded p-1 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Panel body */}
      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
            <span className="text-muted-foreground ml-2 text-sm">
              Loading...
            </span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {detail && !loading && (
          <div className="space-y-5">
            {/* Metadata row */}
            <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
              {detail.municipality_name && (
                <span>
                  <span className="text-foreground font-medium">Commune:</span>{" "}
                  {detail.municipality_name}{" "}
                  {detail.municipality_code && (
                    <span className="font-mono">
                      {detail.municipality_code}
                    </span>
                  )}
                </span>
              )}
              <span>
                <span className="text-foreground font-medium">Created:</span>{" "}
                {formatTime(detail.created_at)}
              </span>
              <span>
                <span className="text-foreground font-medium">Updated:</span>{" "}
                {formatTime(detail.updated_at)}
              </span>
            </div>

            {/* Debug info */}
            {detail.debug && (
              <div className="flex flex-wrap gap-3">
                {detail.debug.model_used && (
                  <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                    {detail.debug.model_used}
                  </span>
                )}
                {detail.debug.status && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      detail.debug.status === "success"
                        ? "bg-green-500/15 text-green-400"
                        : detail.debug.status === "error"
                          ? "bg-red-500/15 text-red-400"
                          : "bg-yellow-500/15 text-yellow-400"
                    }`}
                  >
                    {detail.debug.status}
                  </span>
                )}
                {detail.debug.response_time_ms !== undefined && (
                  <span className="bg-surface-elevated text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {detail.debug.response_time_ms}ms
                  </span>
                )}
                {detail.debug.source_count !== undefined && (
                  <span className="bg-surface-elevated text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
                    {detail.debug.source_count} sources
                  </span>
                )}
                {detail.debug.total_tokens !== undefined &&
                  detail.debug.total_tokens > 0 && (
                    <span className="bg-surface-elevated text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
                      {detail.debug.total_tokens} tokens
                    </span>
                  )}
              </div>
            )}

            {/* Error messages */}
            {detail.debug?.error_messages &&
              detail.debug.error_messages.length > 0 && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
                  <p className="mb-2 text-xs font-semibold text-red-400">
                    Errors:
                  </p>
                  {detail.debug.error_messages.map((msg, i) => (
                    <pre
                      key={i}
                      className="overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap text-red-400"
                    >
                      {msg}
                    </pre>
                  ))}
                </div>
              )}

            {/* Messages */}
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                Messages ({flatMessages.length})
              </p>
              {flatMessages.length === 0 && (
                <p className="text-muted-foreground text-sm italic">
                  No messages in this session.
                </p>
              )}
              {flatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`border-border-subtle rounded-lg border p-3 ${
                    msg.role === "user"
                      ? "border-blue-500/30 bg-blue-500/10"
                      : "border-border-subtle bg-card"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-bold tracking-wider uppercase ${
                          msg.role === "user"
                            ? "text-blue-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {msg.role}
                      </span>
                      {msg.party_name && (
                        <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
                          {msg.party_name}
                        </span>
                      )}
                      {msg.feedback?.feedback === "like" && (
                        <span className="flex items-center gap-0.5 rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                          <ThumbsUp className="size-2.5" />
                          like
                        </span>
                      )}
                      {msg.feedback?.feedback === "dislike" && (
                        <span className="flex items-center gap-0.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                          <ThumbsDown className="size-2.5" />
                          dislike
                          {msg.feedback.detail && (
                            <span className="ml-1 text-red-300">
                              — {msg.feedback.detail}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <span className="text-muted-foreground text-[10px]">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>

                  {/* Sources toggle */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => toggleSources(msg.id)}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px] transition-colors"
                      >
                        {expandedSources.has(msg.id) ? (
                          <ChevronDown className="size-3" />
                        ) : (
                          <ChevronRight className="size-3" />
                        )}
                        {msg.sources.length} source
                        {msg.sources.length !== 1 ? "s" : ""}
                      </button>
                      {expandedSources.has(msg.id) && (
                        <div className="mt-1.5 space-y-1">
                          {msg.sources.map((src, i) => (
                            <div
                              key={i}
                              className="border-border-subtle bg-background rounded border px-2.5 py-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground font-mono text-[10px]">
                                  {src.id}
                                </span>
                                {src.score !== undefined && (
                                  <span className="text-muted-foreground text-[10px]">
                                    score: {src.score.toFixed(3)}
                                  </span>
                                )}
                              </div>
                              {src.text && (
                                <p className="text-muted-foreground mt-1 line-clamp-3 text-[11px] leading-relaxed">
                                  {src.text}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
