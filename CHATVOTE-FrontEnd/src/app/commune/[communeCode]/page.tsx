"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import IconSidebar from "@components/layout/icon-sidebar";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Separator } from "@components/ui/separator";
import { trackCommuneDashboardView } from "@lib/firebase/analytics";
import { toTitleCase } from "@lib/utils";
import { ArrowLeft, MessageCircle } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ListInfo = {
  panel_number: number;
  list_label: string;
  list_short_label: string;
  head_first_name: string;
  head_last_name: string;
  nuance_code: string | null;
  nuance_label: string | null;
  website_url?: string;
  manifesto_url?: string;
};

type TaxonomyTheme = {
  theme: string;
  total_count: number;
  percentage: number;
  by_list: Record<string, number>;
};

type BertopicTopic = {
  topic_id: number;
  label: string;
  count: number;
  percentage: number;
  words: Array<{ word: string; weight: number }>;
  representative_messages: Array<{
    text: string;
    session_id: string;
    chat_title: string;
  }>;
};

type DashboardData = {
  commune: {
    code: string;
    name: string;
    postal_code: string;
    epci_nom: string;
    list_count: number;
    lists: ListInfo[];
  };
  stats: {
    total_questions: number;
    total_lists: number;
    total_chunks: number;
    themes_detected: number;
  };
  taxonomy: {
    themes: TaxonomyTheme[];
  };
  bertopic: {
    status: string;
    message?: string;
    total_messages: number;
    num_topics: number;
    topics: BertopicTopic[];
  };
  citizen: {
    total_messages: number;
    classified_messages: number;
    themes: Array<{ theme: string; count: number; percentage: number }>;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIST_COLORS = [
  "#7C3AED", // violet-600
  "#6D28D9", // violet-700
  "#A78BFA", // violet-400
  "#C084FC", // purple-400
  "#818CF8", // indigo-400
  "#67E8F9", // cyan-300
  "#94A3B8", // slate-400
  "#CBD5E1", // slate-300
  "#E879F9", // fuchsia-400
];

function listColor(index: number): string {
  return LIST_COLORS[index % LIST_COLORS.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 1);
  return values.map((v) => Math.round((v / max) * 100));
}

type RadarEntry = {
  theme: string;
  citizen: number;
  program: number;
};

function buildRadarData(
  themes: TaxonomyTheme[],
  listLabel: string,
): RadarEntry[] {
  const citizenRaw = themes.map((t) => t.total_count);
  const programRaw = themes.map((t) => t.by_list[listLabel] ?? 0);
  const citizenNorm = normalize(citizenRaw);
  const programNorm = normalize(programRaw);

  return themes.map((t, i) => ({
    theme: t.theme,
    citizen: citizenNorm[i],
    program: programNorm[i],
  }));
}

function buildCombinedRadarData(
  themes: TaxonomyTheme[],
  lists: ListInfo[],
): Array<Record<string, string | number>> {
  return themes.map((t) => {
    const entry: Record<string, string | number> = {
      theme: t.theme,
    };
    // Normalize each list's values relative to the max across all lists for this theme
    const values = lists.map((l) => t.by_list[l.list_label] ?? 0);
    const max = Math.max(...values, 1);
    lists.forEach((l) => {
      entry[toTitleCase(l.list_label)] = Math.round(
        ((t.by_list[l.list_label] ?? 0) / max) * 100,
      );
    });
    return entry;
  });
}

function alignmentScore(data: RadarEntry[]): number {
  if (data.length === 0) return 0;
  const scores = data.map(({ citizen, program }) => {
    const mx = Math.max(citizen, program, 1);
    const mn = Math.min(citizen, program);
    return mn / mx;
  });
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
}

function blindSpots(data: RadarEntry[], topN = 5): string[] {
  const sorted = [...data].sort((a, b) => b.citizen - a.citizen);
  const top = sorted.slice(0, topN);
  return top.filter(({ program }) => program < 30).map(({ theme }) => theme);
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-500";
  if (score >= 55) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number): string {
  if (score >= 70) return "bg-green-500/10 border-green-500/30";
  if (score >= 55) return "bg-amber-500/10 border-amber-500/30";
  return "bg-red-500/10 border-red-500/30";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  value,
  label,
  accentColor,
}: {
  value: number | string;
  label: string;
  accentColor: string;
}) {
  return (
    <div className="bg-surface border-border-subtle min-w-0 flex-1 overflow-hidden rounded-xl border">
      <div
        className="h-[3px] w-full"
        style={{ backgroundColor: accentColor }}
      />
      <div className="p-4 pt-3">
        <p className="text-foreground text-3xl leading-none font-extrabold">
          {value}
        </p>
        <p className="text-muted-foreground mt-1 text-xs tracking-wider uppercase">
          {label}
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-muted-foreground text-xs font-semibold tracking-widest whitespace-nowrap uppercase">
        {children}
      </span>
      <div className="border-border-subtle flex-1 border-t" />
    </div>
  );
}

function ThermometerBar({
  rank,
  label,
  count,
  percentage,
  barWidth,
  isTop3,
}: {
  rank: number;
  label: string;
  count: number;
  percentage: number;
  barWidth: number;
  isTop3: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.width = "0%";
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.width = `${barWidth}%`;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [barWidth]);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-muted-foreground w-5 shrink-0 text-right text-xs font-bold">
        {rank}.
      </span>
      <span className="text-foreground w-40 shrink-0 truncate text-sm">
        {label}
      </span>
      <div className="bg-border-subtle/40 h-5 flex-1 overflow-hidden rounded-full">
        <div
          ref={barRef}
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: "0%",
            background: isTop3
              ? "linear-gradient(90deg, #381AF3, #8B5CF6)"
              : "#381AF3",
          }}
        />
      </div>
      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs">
        {count} extraits
      </span>
      <span className="text-foreground w-12 shrink-0 text-right text-sm font-semibold">
        {percentage.toFixed(1)}%
      </span>
    </div>
  );
}

function LegendBar({ lists }: { lists: ListInfo[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-2">
      {lists.map((list, i) => (
        <div key={list.panel_number} className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: listColor(i) }}
          />
          <span className="text-muted-foreground text-xs">
            {toTitleCase(list.list_label || list.list_short_label)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RadarCard({
  list,
  listIndex,
  themes,
}: {
  list: ListInfo;
  listIndex: number;
  themes: TaxonomyTheme[];
}) {
  const color = listColor(listIndex);
  const headName = `${list.head_first_name} ${list.head_last_name}`;
  const radarData = buildRadarData(themes, list.list_label);
  const score = alignmentScore(radarData);
  const blind = blindSpots(radarData);

  return (
    <div className="bg-surface border-border-subtle flex flex-col overflow-hidden rounded-xl border">
      <div className="h-[3px] w-full" style={{ backgroundColor: color }} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-foreground text-sm leading-tight font-bold">
            {headName}
          </p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs tracking-wider">
            {toTitleCase(list.list_label)}
          </p>
          {(list.website_url || list.manifesto_url) && (
            <div className="mt-1 flex items-center gap-2">
              {list.website_url && (
                <a
                  href={list.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary/80 hover:text-primary max-w-[140px] truncate text-[10px] underline underline-offset-2"
                >
                  Site web
                </a>
              )}
              {list.manifesto_url && (
                <a
                  href={list.manifesto_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary/80 hover:text-primary max-w-[140px] truncate text-[10px] underline underline-offset-2"
                >
                  Programme
                </a>
              )}
            </div>
          )}
        </div>

        <div className="aspect-square w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              data={radarData}
              margin={{ top: 20, right: 35, bottom: 20, left: 35 }}
            >
              <PolarGrid stroke="#2E275A" />
              <PolarAngleAxis
                dataKey="theme"
                tick={{ fill: "#a1a1aa", fontSize: 8 }}
              />
              <PolarRadiusAxis
                angle={30}
                domain={[0, 100]}
                tick={false}
                axisLine={false}
              />
              <Radar
                name="Citoyens"
                dataKey="citizen"
                stroke="#a1a1aa"
                fill="transparent"
                strokeDasharray="4 3"
                strokeWidth={1.5}
              />
              <Radar
                name="Programme"
                dataKey="program"
                stroke={color}
                fill={color}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div
          className={`flex items-center justify-between rounded-lg border px-3 py-2 ${scoreBg(score)}`}
        >
          <span className="text-muted-foreground text-xs">Alignement</span>
          <span className={`text-xl font-extrabold ${scoreColor(score)}`}>
            {score}%
          </span>
        </div>

        {blind.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-1.5 text-[10px] tracking-wider uppercase">
              Angles morts
            </p>
            <div className="flex flex-wrap gap-1">
              {blind.map((theme) => (
                <span
                  key={theme}
                  className="inline-block rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400"
                >
                  {theme}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CitizenRadarSection({
  citizenThemes,
  taxonomyThemes,
}: {
  citizenThemes: Array<{ theme: string; count: number; percentage: number }>;
  taxonomyThemes: TaxonomyTheme[];
}) {
  if (citizenThemes.length === 0) return null;

  const allThemes = taxonomyThemes.map((t) => t.theme);
  const citizenMap = Object.fromEntries(
    citizenThemes.map((c) => [c.theme, c.count]),
  );
  const programMap = Object.fromEntries(
    taxonomyThemes.map((t) => [t.theme, t.total_count]),
  );

  const citizenValues = allThemes.map((t) => citizenMap[t] ?? 0);
  const programValues = allThemes.map((t) => programMap[t] ?? 0);
  const citizenNorm = normalize(citizenValues);
  const programNorm = normalize(programValues);

  const data = allThemes.map((theme, i) => ({
    theme,
    citizen: citizenNorm[i],
    program: programNorm[i],
  }));

  return (
    <section>
      <SectionLabel>Radar citoyen — Préoccupations vs programmes</SectionLabel>
      <div className="bg-surface border-border-subtle rounded-xl border p-6">
        <div className="mb-4 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="bg-primary inline-block h-0.5 w-8" />
            <span className="text-muted-foreground text-xs">
              Questions citoyennes
            </span>
          </div>
          <div className="flex items-center gap-2">
            <svg width="28" height="10">
              <line
                x1="0"
                y1="5"
                x2="28"
                y2="5"
                stroke="#a1a1aa"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            </svg>
            <span className="text-muted-foreground text-xs">
              Couverture des programmes
            </span>
          </div>
        </div>
        <div className="mx-auto aspect-square max-w-xl">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              data={data}
              margin={{ top: 20, right: 40, bottom: 20, left: 40 }}
            >
              <PolarGrid stroke="#2E275A" />
              <PolarAngleAxis
                dataKey="theme"
                tick={{ fill: "#a1a1aa", fontSize: 10 }}
              />
              <PolarRadiusAxis
                angle={30}
                domain={[0, 100]}
                tick={false}
                axisLine={false}
              />
              <Radar
                name="Programmes"
                dataKey="program"
                stroke="#a1a1aa"
                fill="transparent"
                strokeDasharray="4 3"
                strokeWidth={1.5}
              />
              <Radar
                name="Citoyens"
                dataKey="citizen"
                stroke="#381AF3"
                fill="#381AF3"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function BlindSpotsSection({
  citizenThemes,
  taxonomyThemes,
}: {
  citizenThemes: Array<{ theme: string; count: number; percentage: number }>;
  taxonomyThemes: TaxonomyTheme[];
}) {
  if (citizenThemes.length === 0 || taxonomyThemes.length === 0) return null;

  const citizenMap = Object.fromEntries(
    citizenThemes.map((c) => [c.theme, c.percentage]),
  );
  const programMap = Object.fromEntries(
    taxonomyThemes.map((t) => [t.theme, t.percentage]),
  );

  // Compute gap = citizen% - program% for each theme
  const allThemes = taxonomyThemes.map((t) => t.theme);
  const gaps = allThemes
    .map((theme) => ({
      theme,
      citizenPct: citizenMap[theme] ?? 0,
      programPct: programMap[theme] ?? 0,
      gap: (citizenMap[theme] ?? 0) - (programMap[theme] ?? 0),
    }))
    .filter((g) => g.gap > 2) // only meaningful gaps
    .sort((a, b) => b.gap - a.gap);

  if (gaps.length === 0) return null;

  const maxGap = gaps[0].gap;

  return (
    <section>
      <SectionLabel>
        Angles morts — Préoccupations citoyennes sous-couvertes
      </SectionLabel>
      <div className="bg-surface border-border-subtle overflow-hidden rounded-xl border">
        <div className="border-border-subtle border-b px-5 pt-4 pb-2">
          <p className="text-foreground text-sm font-semibold">
            Écart entre questions citoyennes et couverture des programmes
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Thèmes où les citoyens posent proportionnellement plus de questions
            que ce que les programmes couvrent
          </p>
        </div>
        <div className="space-y-3 px-5 py-4">
          {gaps.map((g) => (
            <div key={g.theme} className="flex items-center gap-3">
              <span className="text-foreground w-40 shrink-0 truncate text-sm font-medium">
                {g.theme}
              </span>
              <div className="flex flex-1 flex-col gap-1">
                {/* Citizen bar */}
                <div className="flex items-center gap-2">
                  <div className="bg-border-subtle/40 h-3 flex-1 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(g.citizenPct / Math.max(g.citizenPct, g.programPct, 1)) * 100}%`,
                        background: "#381AF3",
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground w-14 shrink-0 text-right text-xs">
                    {g.citizenPct.toFixed(1)}%
                  </span>
                </div>
                {/* Program bar */}
                <div className="flex items-center gap-2">
                  <div className="bg-border-subtle/40 h-3 flex-1 overflow-hidden rounded-full">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(g.programPct / Math.max(g.citizenPct, g.programPct, 1)) * 100}%`,
                        background: "#a1a1aa",
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground w-14 shrink-0 text-right text-xs">
                    {g.programPct.toFixed(1)}%
                  </span>
                </div>
              </div>
              {/* Gap badge */}
              <div
                className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold text-white"
                style={{
                  background: `rgba(239, 68, 68, ${0.4 + (g.gap / maxGap) * 0.6})`,
                }}
              >
                +{g.gap.toFixed(1)}
              </div>
            </div>
          ))}
        </div>
        <div className="text-muted-foreground flex items-center gap-6 px-5 pb-4 text-[11px]">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-5 rounded-full"
              style={{ background: "#381AF3" }}
            />
            Questions citoyennes
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-5 rounded-full"
              style={{ background: "#a1a1aa" }}
            />
            Couverture programmes
          </div>
          <div className="flex items-center gap-2">
            <span className="flex inline-block h-3 w-5 items-center rounded bg-red-500/60 px-1 text-[10px] leading-none font-bold text-white">
              +
            </span>
            Écart (points de %)
          </div>
        </div>
      </div>
    </section>
  );
}

function CombinedRadarSection({
  themes,
  lists,
}: {
  themes: TaxonomyTheme[];
  lists: ListInfo[];
}) {
  const data = buildCombinedRadarData(themes, lists);

  return (
    <section>
      <SectionLabel>
        Vue d&apos;ensemble — Couverture thématique comparée
      </SectionLabel>
      <div className="bg-surface border-border-subtle rounded-xl border p-6">
        <div className="mx-auto aspect-square max-w-2xl">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart
              data={data}
              margin={{ top: 20, right: 40, bottom: 20, left: 40 }}
            >
              <PolarGrid stroke="#2E275A" />
              <PolarAngleAxis
                dataKey="theme"
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
              />
              <PolarRadiusAxis
                angle={30}
                domain={[0, 100]}
                tick={false}
                axisLine={false}
              />
              {lists.map((list, i) => (
                <Radar
                  key={list.panel_number}
                  name={toTitleCase(list.list_label)}
                  dataKey={toTitleCase(list.list_label)}
                  stroke={listColor(i)}
                  fill={listColor(i)}
                  fillOpacity={0.05}
                  strokeWidth={2}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CommuneDashboardPage() {
  const params = useParams<{ communeCode: string }>();
  const communeCode = params.communeCode;
  const router = useRouter();

  const handleClose = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/chat");
    }
  };

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/commune/${communeCode}/dashboard`)
      .then((res) => {
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        return res.json() as Promise<DashboardData>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communeCode]);

  useEffect(() => {
    if (data) {
      trackCommuneDashboardView({
        commune_code: data.commune.code,
        commune_name: data.commune.name,
        list_count: data.commune.list_count,
      });
    }
  }, [data]);

  // ---- Loading state -------------------------------------------------------
  if (loading) {
    return (
      <div className="bg-background flex h-screen">
        <IconSidebar />
        <div className="flex flex-1 items-center justify-center overflow-y-auto">
          <div className="text-muted-foreground flex flex-col items-center gap-4">
            <div className="border-primary h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
            <p className="text-sm">Chargement du tableau de bord…</p>
          </div>
        </div>
      </div>
    );
  }

  // ---- Error state ---------------------------------------------------------
  if (error || !data) {
    return (
      <div className="bg-background flex h-screen">
        <IconSidebar />
        <div className="flex flex-1 items-center justify-center overflow-y-auto">
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <p className="text-destructive font-semibold">
              {error ?? "Données introuvables"}
            </p>
            <p className="text-muted-foreground text-sm">
              Impossible de charger le tableau de bord pour la commune{" "}
              <span className="font-mono">{communeCode}</span>.
            </p>
            <Button variant="outline" onClick={fetchData}>
              Réessayer
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { commune, stats, taxonomy, citizen } = data;

  return (
    <div className="bg-background text-foreground flex h-screen">
      <IconSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 pt-5 pb-2 sm:px-6">
          {/* Back arrow */}
          <button
            type="button"
            onClick={handleClose}
            className="bg-border-subtle/40 text-muted-foreground hover:text-foreground hover:bg-border-subtle mb-4 shrink-0 rounded-lg p-2 transition-colors"
            title="Retour"
          >
            <ArrowLeft className="size-5" />
          </button>

          {/* Commune name & info */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Badge className="bg-primary/20 text-primary border-primary/30 mb-1 border px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase">
                Commune
              </Badge>
              <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {commune.name}
              </h1>
              <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {commune.postal_code && <span>CP {commune.postal_code}</span>}
                <span>INSEE {commune.code}</span>
                {commune.epci_nom && (
                  <>
                    <Separator
                      orientation="vertical"
                      className="bg-border-subtle hidden h-3 sm:block"
                    />
                    <span className="max-w-[18rem] truncate">
                      {commune.epci_nom}
                    </span>
                  </>
                )}
                <Separator
                  orientation="vertical"
                  className="bg-border-subtle hidden h-3 sm:block"
                />
                <span>
                  {commune.list_count} liste
                  {commune.list_count !== 1 ? "s" : ""}
                </span>
                <span>·</span>
                <span>
                  {stats.total_questions} question
                  {stats.total_questions !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <Link
              href={`/chat?municipality_code=${commune.code}`}
              className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
            >
              <MessageCircle className="size-4" />
              Poser une question
            </Link>
          </div>
        </div>

        <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6">
          {/* ---------------------------------------------------------------- */}
          {/* Stats row                                                         */}
          {/* ---------------------------------------------------------------- */}
          <div className="flex flex-wrap gap-3 sm:flex-nowrap">
            <StatCard
              value={stats.total_questions}
              label="Questions citoyennes"
              accentColor="#7C3AED"
            />
            <StatCard
              value={stats.total_lists}
              label="Listes en compétition"
              accentColor="#A78BFA"
            />
            <StatCard
              value={stats.themes_detected}
              label="Thèmes détectés"
              accentColor="#818CF8"
            />
            <StatCard
              value={stats.total_chunks}
              label="Extraits de programme"
              accentColor="#94A3B8"
            />
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Thermometre citoyen                                               */}
          {/* ---------------------------------------------------------------- */}
          <section>
            <SectionLabel>
              Couverture thématique — Répartition des programmes
            </SectionLabel>

            {taxonomy.themes.length === 0 ? (
              <div className="bg-surface border-border-subtle text-muted-foreground rounded-xl border p-6 text-center text-sm">
                Pas assez de données pour l&apos;analyse thématique
              </div>
            ) : (
              <div className="bg-surface border-border-subtle overflow-hidden rounded-xl border">
                <div className="border-border-subtle flex items-start justify-between gap-2 border-b px-5 pt-4 pb-2">
                  <div>
                    <p className="text-foreground text-sm font-semibold">
                      Thèmes les plus couverts dans les programmes
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      Classification fixe · {stats.total_chunks} extraits
                      analysés · {taxonomy.themes.length} thèmes
                    </p>
                  </div>
                </div>
                <div className="space-y-1 px-5 py-4">
                  {(() => {
                    const maxPct = taxonomy.themes[0]?.percentage ?? 1;
                    return taxonomy.themes.map((theme, i) => (
                      <ThermometerBar
                        key={theme.theme}
                        rank={i + 1}
                        label={theme.theme}
                        count={theme.total_count}
                        percentage={theme.percentage}
                        barWidth={(theme.percentage / maxPct) * 100}
                        isTop3={i < 3}
                      />
                    ));
                  })()}
                </div>
              </div>
            )}
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* Legend                                                            */}
          {/* ---------------------------------------------------------------- */}
          {taxonomy.themes.length > 0 && commune.lists.length > 0 && (
            <div className="bg-surface border-border-subtle rounded-xl border px-5 py-3">
              <LegendBar lists={commune.lists} />
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Citizen radar                                                     */}
          {/* ---------------------------------------------------------------- */}
          {citizen &&
            citizen.themes.length > 0 &&
            taxonomy.themes.length > 0 && (
              <CitizenRadarSection
                citizenThemes={citizen.themes}
                taxonomyThemes={taxonomy.themes}
              />
            )}

          {/* ---------------------------------------------------------------- */}
          {/* Blind spots                                                       */}
          {/* ---------------------------------------------------------------- */}
          {citizen &&
            citizen.themes.length > 0 &&
            taxonomy.themes.length > 0 && (
              <BlindSpotsSection
                citizenThemes={citizen.themes}
                taxonomyThemes={taxonomy.themes}
              />
            )}

          {/* ---------------------------------------------------------------- */}
          {/* Combined radar                                                    */}
          {/* ---------------------------------------------------------------- */}
          {taxonomy.themes.length > 0 && commune.lists.length > 0 && (
            <CombinedRadarSection
              themes={taxonomy.themes}
              lists={commune.lists}
            />
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Radar grid                                                        */}
          {/* ---------------------------------------------------------------- */}
          {taxonomy.themes.length > 0 && commune.lists.length > 0 && (
            <section>
              <SectionLabel>Couverture thématique par liste</SectionLabel>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {commune.lists.map((list, i) => (
                  <RadarCard
                    key={list.panel_number}
                    list={list}
                    listIndex={i}
                    themes={taxonomy.themes}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
