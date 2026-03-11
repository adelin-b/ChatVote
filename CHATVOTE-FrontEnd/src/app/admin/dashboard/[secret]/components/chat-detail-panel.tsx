"use client";

import { useState, useEffect } from "react";
import { Loader2, X, ChevronDown, ChevronRight } from "lucide-react";

interface ChatDetailPanelProps {
  sessionId: string;
  secret: string;
  apiUrl: string;
  onClose: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: Array<{ id: string; score?: number; text?: string }>;
}

interface SessionDetail {
  session_id: string;
  municipality_code?: string;
  municipality_name?: string;
  created_at?: string;
  updated_at?: string;
  messages: Message[];
  debug?: {
    response_time_ms?: number;
    source_count?: number;
    model_used?: string;
    status?: string;
    error_messages?: string[];
    total_tokens?: number;
  };
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
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Failed to load session");
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
    <div className="border-t border-gray-200 bg-gray-50">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Session Detail
          </h3>
          <span className="font-mono text-xs text-gray-400">{sessionId}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Panel body */}
      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-gray-400" />
            <span className="ml-2 text-sm text-gray-500">Loading...</span>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {detail && !loading && (
          <div className="space-y-5">
            {/* Metadata row */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              {detail.municipality_name && (
                <span>
                  <span className="font-medium text-gray-700">Commune:</span>{" "}
                  {detail.municipality_name}{" "}
                  {detail.municipality_code && (
                    <span className="font-mono">{detail.municipality_code}</span>
                  )}
                </span>
              )}
              <span>
                <span className="font-medium text-gray-700">Created:</span>{" "}
                {formatTime(detail.created_at)}
              </span>
              <span>
                <span className="font-medium text-gray-700">Updated:</span>{" "}
                {formatTime(detail.updated_at)}
              </span>
            </div>

            {/* Debug info */}
            {detail.debug && (
              <div className="flex flex-wrap gap-3">
                {detail.debug.model_used && (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                    {detail.debug.model_used}
                  </span>
                )}
                {detail.debug.status && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      detail.debug.status === "success"
                        ? "bg-green-100 text-green-700"
                        : detail.debug.status === "error"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {detail.debug.status}
                  </span>
                )}
                {detail.debug.response_time_ms !== undefined && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {detail.debug.response_time_ms}ms
                  </span>
                )}
                {detail.debug.source_count !== undefined && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    {detail.debug.source_count} sources
                  </span>
                )}
                {detail.debug.total_tokens !== undefined &&
                  detail.debug.total_tokens > 0 && (
                    <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      {detail.debug.total_tokens} tokens
                    </span>
                  )}
              </div>
            )}

            {/* Error messages */}
            {detail.debug?.error_messages &&
              detail.debug.error_messages.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3">
                  <p className="mb-2 text-xs font-semibold text-red-700">
                    Errors:
                  </p>
                  {detail.debug.error_messages.map((msg, i) => (
                    <pre
                      key={i}
                      className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed text-red-600"
                    >
                      {msg}
                    </pre>
                  ))}
                </div>
              )}

            {/* Messages */}
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Messages ({detail.messages.length})
              </p>
              {detail.messages.length === 0 && (
                <p className="text-sm text-gray-400 italic">
                  No messages in this session.
                </p>
              )}
              {detail.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg border p-3 ${
                    msg.role === "user"
                      ? "border-blue-200 bg-blue-50"
                      : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        msg.role === "user"
                          ? "text-blue-600"
                          : "text-gray-500"
                      }`}
                    >
                      {msg.role}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>

                  {/* Sources toggle */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => toggleSources(msg.id)}
                        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
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
                              className="rounded border border-gray-100 bg-gray-50 px-2.5 py-1.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-[10px] text-gray-500">
                                  {src.id}
                                </span>
                                {src.score !== undefined && (
                                  <span className="text-[10px] text-gray-400">
                                    score: {src.score.toFixed(3)}
                                  </span>
                                )}
                              </div>
                              {src.text && (
                                <p className="mt-1 text-[11px] text-gray-600 leading-relaxed line-clamp-3">
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
