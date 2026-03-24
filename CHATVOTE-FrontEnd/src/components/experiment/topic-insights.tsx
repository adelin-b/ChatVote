"use client";

import React, { useEffect, useState } from "react";

import { Separator } from "@components/ui/separator";
import {
  BarChart3Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
} from "lucide-react";

import { FiabiliteBadge, SourceDocBadge, ThemeBadge } from "./metadata-badge";

// ─── Fixed taxonomy types ───

type ThemeStat = {
  theme: string;
  count: number;
  percentage: number;
  by_party: Record<string, number>;
  by_source: Record<string, number>;
  by_fiabilite: Record<string, number>;
  sub_themes: Array<{
    name: string;
    count: number;
    by_party: Record<string, number>;
  }>;
};

type TopicStatsResponse = {
  total_chunks: number;
  classified_chunks: number;
  unclassified_chunks: number;
  themes: ThemeStat[];
  collections: Record<string, { total: number; classified: number }>;
};

export default function TopicInsights() {
  const [data, setData] = useState<TopicStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/experiment/topics")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3Icon className="text-muted-foreground size-6 shrink-0" />
        <div>
          <h2 className="text-xl font-semibold">Knowledge Base Themes</h2>
          <p className="text-muted-foreground text-sm">
            Distribution of topics across all indexed documents and manifestos.
          </p>
        </div>
      </div>

      <TaxonomyView data={data} loading={loading} error={error} />
    </div>
  );
}

// ─── Fixed Taxonomy View ───

function TaxonomyView({
  data,
  loading,
  error,
}: {
  data: TopicStatsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Loader2Icon className="text-muted-foreground size-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <p className="text-destructive">Failed to load topic stats: {error}</p>
      </div>
    );
  }

  const maxCount = data.themes[0]?.count ?? 1;

  return (
    <div className="flex flex-col gap-6">
      {/* Summary stats */}
      <div className="flex flex-wrap gap-3 sm:flex-nowrap">
        <StatCard label="Total Chunks" value={data.total_chunks} />
        <StatCard
          label="Classified"
          value={data.classified_chunks}
          sub={`${data.total_chunks ? Math.round((data.classified_chunks / data.total_chunks) * 100) : 0}%`}
        />
        <StatCard label="Unclassified" value={data.unclassified_chunks} />
        <StatCard label="Themes Found" value={data.themes.length} />
      </div>

      {/* Collection breakdown */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(data.collections).map(([name, stats]) => (
          <div
            key={name}
            className="bg-surface flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
          >
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground">
              {stats.classified}/{stats.total}
            </span>
          </div>
        ))}
      </div>

      <Separator />

      {/* Bar chart */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Distribution</h2>
        <div className="flex flex-col gap-1.5">
          {data.themes.map((t) => (
            <div key={t.theme} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate text-right text-sm">
                {t.theme}
              </span>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-white/5">
                <div
                  className="absolute inset-y-0 left-0 rounded transition-all"
                  style={{
                    width: `${(t.count / maxCount) * 100}%`,
                    background: "linear-gradient(90deg, #381AF3, #8B5CF6)",
                  }}
                />
                <span className="relative z-10 flex h-full items-center px-2 text-xs font-medium">
                  {t.count} ({t.percentage}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Theme details */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Theme Details</h2>
        <div className="flex flex-col gap-2">
          {data.themes.map((t) => (
            <ThemeCard
              key={t.theme}
              theme={t}
              totalChunks={data.classified_chunks}
            />
          ))}
        </div>
      </div>

      {/* Unclassified */}
      {data.unclassified_chunks > 0 && (
        <>
          <Separator />
          <div className="bg-surface rounded-xl p-4">
            <h3 className="font-semibold">Unclassified Chunks</h3>
            <p className="text-muted-foreground text-sm">
              {data.unclassified_chunks} chunks (
              {data.total_chunks
                ? Math.round(
                    (data.unclassified_chunks / data.total_chunks) * 100,
                  )
                : 0}
              %) have no theme assigned.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Shared components ───

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="bg-surface min-w-0 flex-1 rounded-xl p-4">
      <p className="text-foreground text-2xl leading-none font-extrabold tabular-nums">
        {value.toLocaleString()}
        {sub && (
          <span className="text-muted-foreground ml-1 text-sm font-normal">
            {sub}
          </span>
        )}
      </p>
      <p className="text-muted-foreground mt-1 text-xs tracking-wider uppercase">
        {label}
      </p>
    </div>
  );
}

function ThemeCard({
  theme,
  totalChunks,
}: {
  theme: ThemeStat;
  totalChunks: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const partyEntries = Object.entries(theme.by_party).sort(
    ([, a], [, b]) => b - a,
  );
  const topParties = partyEntries.slice(0, 3);
  const maxPartyCount = partyEntries[0]?.[1] ?? 1;

  return (
    <div className="bg-surface overflow-hidden rounded-xl">
      {/* Always-visible summary row */}
      <button
        type="button"
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.02]"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Theme name + badge */}
        <div className="flex w-44 shrink-0 items-center gap-3">
          {expanded ? (
            <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-4 shrink-0" />
          )}
          <ThemeBadge theme={theme.theme} />
        </div>

        {/* Inline progress bar showing share of total */}
        <div className="min-w-0 flex-1">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${(theme.count / totalChunks) * 100}%`,
                background: "linear-gradient(90deg, #381AF3, #8B5CF6)",
              }}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="flex shrink-0 items-center gap-4">
          <span className="w-16 text-right text-sm font-medium tabular-nums">
            {theme.count.toLocaleString()}
          </span>
          <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">
            {theme.percentage}%
          </span>
        </div>

        {/* Top parties preview */}
        <div className="hidden w-48 shrink-0 items-center gap-1 lg:flex">
          {topParties.map(([party]) => (
            <span
              key={party}
              className="text-muted-foreground truncate rounded bg-white/5 px-1.5 py-0.5 text-[10px]"
            >
              {party}
            </span>
          ))}
          {partyEntries.length > 3 && (
            <span className="text-muted-foreground text-[10px]">
              +{partyEntries.length - 3}
            </span>
          )}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pt-1 pb-5">
          <div className="grid gap-5 md:grid-cols-2">
            {/* Left column: Party breakdown */}
            {partyEntries.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                  Party Distribution
                </p>
                <div className="flex flex-col gap-1.5">
                  {partyEntries.map(([party, count]) => (
                    <div
                      key={party}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span className="text-muted-foreground w-24 shrink-0 truncate text-right">
                        {party}
                      </span>
                      <div className="relative h-5 flex-1 overflow-hidden rounded bg-white/5">
                        <div
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${(count / maxPartyCount) * 100}%`,
                            background:
                              "linear-gradient(90deg, #381AF3, #8B5CF6)",
                          }}
                        />
                        <span className="relative z-10 flex h-full items-center px-2 text-[11px] font-medium">
                          {count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Right column: Metadata */}
            <div className="flex flex-col gap-4">
              {/* Source types */}
              {Object.keys(theme.by_source).length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                    Sources
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(theme.by_source)
                      .sort(([, a], [, b]) => b - a)
                      .map(([src, count]) => (
                        <div
                          key={src}
                          className="flex items-center gap-1 rounded bg-white/5 px-2 py-1"
                        >
                          <SourceDocBadge sourceDoc={src} />
                          <span className="text-muted-foreground text-[11px] tabular-nums">
                            {count}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Fiabilite */}
              {Object.keys(theme.by_fiabilite).length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                    Reliability
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(theme.by_fiabilite)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([level, count]) => (
                        <div
                          key={level}
                          className="flex items-center gap-1 rounded bg-white/5 px-2 py-1"
                        >
                          <FiabiliteBadge level={Number(level)} />
                          <span className="text-muted-foreground text-[11px] tabular-nums">
                            {count}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sub-themes — full width below */}
          {theme.sub_themes.length > 0 && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <p className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                Sub-themes
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {theme.sub_themes.map((st) => {
                  const maxSt = theme.sub_themes[0]?.count ?? 1;
                  return (
                    <div key={st.name} className="flex items-center gap-2">
                      <span className="text-muted-foreground w-32 shrink-0 truncate text-right text-xs">
                        {st.name}
                      </span>
                      <div className="relative h-4 flex-1 overflow-hidden rounded bg-white/5">
                        <div
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${(st.count / maxSt) * 100}%`,
                            background:
                              "linear-gradient(90deg, #381AF3cc, #8B5CF6aa)",
                          }}
                        />
                        <span className="relative z-10 flex h-full items-center px-1.5 text-[10px] font-medium tabular-nums">
                          {st.count}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
