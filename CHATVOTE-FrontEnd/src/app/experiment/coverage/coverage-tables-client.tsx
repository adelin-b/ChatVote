"use client";

import { useState } from "react";

import { CheckIcon, XIcon, ArrowUpDownIcon } from "lucide-react";

import { type CandidateCoverage, type CommuneCoverage, type PartyCoverage } from "../../api/coverage/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommuneSortKey = "name" | "list_count" | "question_count";
type PartySortKey = "name" | "chunk_count";
type CandidateSortKey = "name" | "commune_name" | "party_label";
type SortDir = "asc" | "desc";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CoverageBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2 bg-border-subtle/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #381AF3, #8B5CF6)",
          }}
        />
      </div>
      <span className="w-8 text-right text-xs text-muted-foreground shrink-0 tabular-nums">
        {value}
      </span>
    </div>
  );
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
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <ArrowUpDownIcon
        className={`size-3 shrink-0 ${active ? (dir === "desc" ? "rotate-180" : "") : ""}`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Communes table
// ---------------------------------------------------------------------------

function CommunesTable({ communes }: { communes: CommuneCoverage[] }) {
  const [sortKey, setSortKey] = useState<CommuneSortKey>("question_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const maxQuestions = Math.max(...communes.map((c) => c.question_count), 1);
  const maxLists = Math.max(...communes.map((c) => c.list_count), 1);

  function handleSort(key: CommuneSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...communes].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "name") return mul * a.name.localeCompare(b.name);
    return mul * (a[sortKey] - b[sortKey]);
  });

  return (
    <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground text-sm">
          Communes ({communes.length})
        </p>
        <div className="flex items-center gap-4">
          <SortButton
            label="Name"
            active={sortKey === "name"}
            dir={sortDir}
            onClick={() => handleSort("name")}
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

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left">
              <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Commune
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-20 text-right">
                Lists
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[180px]">
                Questions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-muted-foreground text-sm"
                >
                  No communes found.
                </td>
              </tr>
            )}
            {sorted.map((commune, i) => (
              <tr
                key={commune.code}
                className="hover:bg-border-subtle/10 transition-colors"
              >
                <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums">
                  {i + 1}.
                </td>
                <td className="px-3 py-3">
                  <span className="font-medium text-foreground">
                    {commune.name}
                  </span>
                  <span className="ml-2 text-[10px] text-muted-foreground font-mono">
                    {commune.code}
                  </span>
                </td>
                <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                  {commune.list_count > 0 ? (
                    <CoverageBar value={commune.list_count} max={maxLists} />
                  ) : (
                    <span className="text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  {commune.question_count > 0 ? (
                    <CoverageBar
                      value={commune.question_count}
                      max={maxQuestions}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
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
// Parties table
// ---------------------------------------------------------------------------

function PartiesTable({ parties }: { parties: PartyCoverage[] }) {
  const [sortKey, setSortKey] = useState<PartySortKey>("chunk_count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const maxChunks = Math.max(...parties.map((p) => p.chunk_count), 1);

  function handleSort(key: PartySortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...parties].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    if (sortKey === "name") return mul * a.name.localeCompare(b.name);
    return mul * (a.chunk_count - b.chunk_count);
  });

  return (
    <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground text-sm">
          Parties ({parties.length})
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

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left">
              <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-10">
                #
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Party
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-24 text-center">
                Manifesto
              </th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground min-w-[220px]">
                Indexed chunks
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-muted-foreground text-sm"
                >
                  No parties found.
                </td>
              </tr>
            )}
            {sorted.map((party, i) => (
              <tr
                key={party.party_id}
                className="hover:bg-border-subtle/10 transition-colors"
              >
                <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums">
                  {i + 1}.
                </td>
                <td className="px-3 py-3">
                  <span className="font-medium text-foreground">
                    {party.name}
                  </span>
                  {party.short_name && party.short_name !== party.name && (
                    <span className="ml-2 text-[10px] bg-primary/10 text-primary border border-primary/20 rounded px-1.5 py-0.5 font-mono">
                      {party.short_name}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {party.has_manifesto ? (
                    <CheckIcon className="size-4 text-green-500 mx-auto" />
                  ) : (
                    <XIcon className="size-4 text-muted-foreground mx-auto" />
                  )}
                </td>
                <td className="px-3 py-3">
                  {party.chunk_count > 0 ? (
                    <CoverageBar
                      value={party.chunk_count}
                      max={maxChunks}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Not indexed
                    </span>
                  )}
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
// Candidates table
// ---------------------------------------------------------------------------

function CandidatesTable({ candidates }: { candidates: CandidateCoverage[] }) {
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

  const sorted = [...candidates].sort((a, b) => {
    const mul = sortDir === "desc" ? -1 : 1;
    return mul * (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "");
  });

  return (
    <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between gap-2">
        <p className="font-semibold text-foreground text-sm">
          Candidates ({candidates.length})
        </p>
        <div className="flex items-center gap-4">
          <SortButton label="Name" active={sortKey === "name"} dir={sortDir} onClick={() => handleSort("name")} />
          <SortButton label="Commune" active={sortKey === "commune_name"} dir={sortDir} onClick={() => handleSort("commune_name")} />
          <SortButton label="Party" active={sortKey === "party_label"} dir={sortDir} onClick={() => handleSort("party_label")} />
        </div>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface z-10">
            <tr className="border-b border-border-subtle text-left">
              <th className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-10">#</th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Candidate</th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Commune</th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">List / Party</th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-20 text-center">Website</th>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-24 text-center">Manifesto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground text-sm">No candidates found.</td>
              </tr>
            )}
            {sorted.map((c, i) => (
              <tr key={c.candidate_id} className="hover:bg-border-subtle/10 transition-colors">
                <td className="px-5 py-3 text-xs text-muted-foreground tabular-nums">{i + 1}.</td>
                <td className="px-3 py-3">
                  <span className="font-medium text-foreground">{c.name}</span>
                </td>
                <td className="px-3 py-3 text-muted-foreground">
                  {c.commune_name || "—"}
                  {c.commune_code && (
                    <span className="ml-1.5 text-[10px] font-mono text-muted-foreground/60">{c.commune_code}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground text-xs">{c.party_label || "—"}</td>
                <td className="px-3 py-3 text-center">
                  {c.has_website ? (
                    <CheckIcon className="size-4 text-green-500 mx-auto" />
                  ) : (
                    <XIcon className="size-4 text-muted-foreground mx-auto" />
                  )}
                </td>
                <td className="px-3 py-3 text-center">
                  {c.has_manifesto ? (
                    <CheckIcon className="size-4 text-green-500 mx-auto" />
                  ) : (
                    <XIcon className="size-4 text-muted-foreground mx-auto" />
                  )}
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
// Combined export (all tables)
// ---------------------------------------------------------------------------

export default function CoverageTablesClient({
  communes,
  parties,
  candidates,
}: {
  communes: CommuneCoverage[];
  parties: PartyCoverage[];
  candidates: CandidateCoverage[];
}) {
  return (
    <div className="space-y-8">
      <CommunesTable communes={communes} />

      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
            Parties — Knowledge Base Coverage
          </span>
          <div className="flex-1 border-t border-border-subtle" />
        </div>
        <PartiesTable parties={parties} />
      </div>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
            Candidates — Data Availability
          </span>
          <div className="flex-1 border-t border-border-subtle" />
        </div>
        <CandidatesTable candidates={candidates} />
      </div>
    </div>
  );
}
