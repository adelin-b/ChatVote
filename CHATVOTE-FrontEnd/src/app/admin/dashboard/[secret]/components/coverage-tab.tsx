"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CheckIcon,
  XIcon,
  ArrowUpDownIcon,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageTabProps {
  secret: string;
  apiUrl: string;
}

interface CommuneRow {
  code: string;
  name: string;
  population: number;
  list_count: number;
  candidate_count: number;
  question_count: number;
  chunk_count: number;
}

interface PartyRow {
  party_id: string;
  name: string;
  short_name: string;
  chunk_count: number;
  has_manifesto: boolean;
}

interface CandidateRow {
  candidate_id: string;
  name: string;
  commune_code: string;
  commune_name: string;
  has_website: boolean;
  has_manifesto: boolean;
  has_scraped: boolean;
  chunk_count: number;
  party_label: string;
}

interface CoverageSummary {
  total_communes: number;
  total_parties: number;
  total_candidates: number;
  total_lists: number;
  total_questions: number;
  total_chunks: number;
  scraped_candidates: number;
  indexed_candidates: number;
}

interface CoverageData {
  communes: CommuneRow[];
  parties: PartyRow[];
  candidates: CandidateRow[];
  summary: CoverageSummary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc";

function chunkColor(count: number): string {
  if (count === 0) return "bg-red-100 text-red-700";
  if (count < 5) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
        active ? "text-gray-800" : "text-gray-400 hover:text-gray-700"
      }`}
    >
      {label}
      <ArrowUpDownIcon
        className={`size-3 shrink-0 ${active && dir === "asc" ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function StatCard({
  value,
  label,
}: {
  value: number | string;
  label: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
      <p className="text-2xl font-bold tabular-nums text-gray-900">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-wider text-gray-500">
        {label}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Communes Table
// ---------------------------------------------------------------------------

type CommuneSortKey = "name" | "list_count" | "question_count" | "population";

function CommunesTable({
  communes,
  showMissingOnly,
}: {
  communes: CommuneRow[];
  showMissingOnly: boolean;
}) {
  const [sortKey, setSortKey] = useState<CommuneSortKey>("question_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: CommuneSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = showMissingOnly
    ? communes.filter((c) => c.list_count === 0)
    : communes;

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "name") return mul * a.name.localeCompare(b.name);
    return mul * (a[sortKey] - b[sortKey]);
  });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-5 pt-4 pb-3">
        <p className="text-sm font-semibold text-gray-900">
          Communes ({filtered.length})
        </p>
        <div className="flex items-center gap-4">
          <SortButton
            label="Name"
            active={sortKey === "name"}
            dir={sortDir}
            onClick={() => handleSort("name")}
          />
          <SortButton
            label="Pop."
            active={sortKey === "population"}
            dir={sortDir}
            onClick={() => handleSort("population")}
          />
          <SortButton
            label="Lists"
            active={sortKey === "list_count"}
            dir={sortDir}
            onClick={() => handleSort("list_count")}
          />
          <SortButton
            label="Questions"
            active={sortKey === "question_count"}
            dir={sortDir}
            onClick={() => handleSort("question_count")}
          />
        </div>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-gray-200 text-left">
              <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Commune
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                Population
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                Lists
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 text-right">
                Questions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-8 text-center text-sm text-gray-400"
                >
                  No communes found.
                </td>
              </tr>
            )}
            {sorted.map((c, i) => (
              <tr
                key={c.code}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-5 py-3 text-xs text-gray-400 tabular-nums">
                  {i + 1}.
                </td>
                <td className="px-3 py-3">
                  <span className="font-medium text-gray-900">{c.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-gray-400">
                    {c.code}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-gray-500 tabular-nums text-xs">
                  {c.population > 0 ? c.population.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${chunkColor(c.list_count)}`}
                  >
                    {c.list_count}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-gray-500 tabular-nums text-xs">
                  {c.question_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parties Table
// ---------------------------------------------------------------------------

type PartySortKey = "name" | "chunk_count";

function PartiesTable({
  parties,
  showMissingOnly,
}: {
  parties: PartyRow[];
  showMissingOnly: boolean;
}) {
  const [sortKey, setSortKey] = useState<PartySortKey>("chunk_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: PartySortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = showMissingOnly
    ? parties.filter((p) => p.chunk_count === 0)
    : parties;

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "name") return mul * a.name.localeCompare(b.name);
    return mul * (a.chunk_count - b.chunk_count);
  });

  const maxChunks = Math.max(...parties.map((p) => p.chunk_count), 1);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-5 pt-4 pb-3">
        <p className="text-sm font-semibold text-gray-900">
          Parties ({filtered.length})
        </p>
        <div className="flex items-center gap-4">
          <SortButton
            label="Name"
            active={sortKey === "name"}
            dir={sortDir}
            onClick={() => handleSort("name")}
          />
          <SortButton
            label="Chunks"
            active={sortKey === "chunk_count"}
            dir={sortDir}
            onClick={() => handleSort("chunk_count")}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Party
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-24 text-center">
                Manifesto
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 min-w-[200px]">
                Indexed chunks
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-sm text-gray-400"
                >
                  No parties found.
                </td>
              </tr>
            )}
            {sorted.map((p, i) => (
              <tr
                key={p.party_id}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-5 py-3 text-xs text-gray-400 tabular-nums">
                  {i + 1}.
                </td>
                <td className="px-3 py-3">
                  <span className="font-medium text-gray-900">{p.name}</span>
                  {p.short_name && p.short_name !== p.name && (
                    <span className="ml-2 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] text-blue-600">
                      {p.short_name}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {p.has_manifesto ? (
                    <CheckIcon className="mx-auto size-4 text-green-500" />
                  ) : (
                    <XIcon className="mx-auto size-4 text-gray-300" />
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{
                          width: `${maxChunks > 0 ? Math.round((p.chunk_count / maxChunks) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${chunkColor(p.chunk_count)}`}
                    >
                      {p.chunk_count}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidates Table
// ---------------------------------------------------------------------------

type CandidateSortKey = "name" | "commune_name" | "party_label" | "chunk_count";

function CandidatesTable({
  candidates,
  showMissingOnly,
}: {
  candidates: CandidateRow[];
  showMissingOnly: boolean;
}) {
  const [sortKey, setSortKey] = useState<CandidateSortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(key: CandidateSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = showMissingOnly
    ? candidates.filter((c) => !c.has_website && !c.has_scraped)
    : candidates;

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "chunk_count")
      return mul * (a.chunk_count - b.chunk_count);
    return mul * (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
  });

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-5 pt-4 pb-3">
        <p className="text-sm font-semibold text-gray-900">
          Candidates ({filtered.length})
        </p>
        <div className="flex items-center gap-4">
          <SortButton
            label="Name"
            active={sortKey === "name"}
            dir={sortDir}
            onClick={() => handleSort("name")}
          />
          <SortButton
            label="Commune"
            active={sortKey === "commune_name"}
            dir={sortDir}
            onClick={() => handleSort("commune_name")}
          />
          <SortButton
            label="Party"
            active={sortKey === "party_label"}
            dir={sortDir}
            onClick={() => handleSort("party_label")}
          />
          <SortButton
            label="Chunks"
            active={sortKey === "chunk_count"}
            dir={sortDir}
            onClick={() => handleSort("chunk_count")}
          />
        </div>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-gray-200 text-left">
              <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Candidate
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                Commune
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
                List / Party
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-20 text-center">
                Website
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-20 text-center">
                Scraped
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 w-20 text-center">
                Chunks
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-8 text-center text-sm text-gray-400"
                >
                  No candidates found.
                </td>
              </tr>
            )}
            {sorted.map((c, i) => (
              <tr
                key={c.candidate_id}
                className="hover:bg-gray-50 transition-colors"
              >
                <td className="px-5 py-3 text-xs text-gray-400 tabular-nums">
                  {i + 1}.
                </td>
                <td className="px-3 py-3">
                  <span className="font-medium text-gray-900">{c.name}</span>
                </td>
                <td className="px-3 py-3 text-gray-500">
                  {c.commune_name || "—"}
                  {c.commune_code && (
                    <span className="ml-1.5 font-mono text-[10px] text-gray-400">
                      {c.commune_code}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-gray-500">
                  {c.party_label || "—"}
                </td>
                <td className="px-3 py-3 text-center">
                  {c.has_website ? (
                    <CheckIcon className="mx-auto size-4 text-green-500" />
                  ) : (
                    <XIcon className="mx-auto size-4 text-gray-300" />
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {c.has_scraped ? (
                    <CheckIcon className="mx-auto size-4 text-green-500" />
                  ) : (
                    <XIcon className="mx-auto size-4 text-gray-300" />
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${chunkColor(c.chunk_count)}`}
                  >
                    {c.chunk_count}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage Tab
// ---------------------------------------------------------------------------

export default function CoverageTab({ secret, apiUrl }: CoverageTabProps) {
  const [data, setData] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  const fetchCoverage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/api/v1/admin/dashboard/coverage`, {
        headers: { "X-Admin-Secret": secret },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json: CoverageData = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Failed to fetch coverage data");
    } finally {
      setLoading(false);
    }
  }, [secret, apiUrl]);

  useEffect(() => {
    fetchCoverage();
  }, [fetchCoverage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">
          Loading coverage data...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={fetchCoverage}
          className="mt-3"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { summary, communes, parties, candidates } = data;

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <StatCard value={summary.total_communes} label="Communes" />
        <StatCard value={summary.total_parties} label="Parties" />
        <StatCard value={summary.total_candidates} label="Candidates" />
        <StatCard value={summary.total_lists} label="Lists" />
        <StatCard value={summary.total_questions} label="Questions" />
        <StatCard value={summary.total_chunks} label="Chunks" />
        <StatCard value={summary.scraped_candidates} label="Scraped" />
        <StatCard value={summary.indexed_candidates} label="Indexed" />
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showMissingOnly}
            onChange={(e) => setShowMissingOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show missing only
        </label>
        <Button
          size="sm"
          variant="ghost"
          onClick={fetchCoverage}
          className="h-8 gap-1.5 text-xs"
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {/* Tables */}
      <CommunesTable communes={communes} showMissingOnly={showMissingOnly} />

      <div>
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 whitespace-nowrap">
            Parties — Knowledge Base Coverage
          </span>
          <div className="flex-1 border-t border-gray-200" />
        </div>
        <PartiesTable parties={parties} showMissingOnly={showMissingOnly} />
      </div>

      <div>
        <div className="mb-3 flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400 whitespace-nowrap">
            Candidates — Data Availability
          </span>
          <div className="flex-1 border-t border-gray-200" />
        </div>
        <CandidatesTable
          candidates={candidates}
          showMissingOnly={showMissingOnly}
        />
      </div>
    </div>
  );
}
