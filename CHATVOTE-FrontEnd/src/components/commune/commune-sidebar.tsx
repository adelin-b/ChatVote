"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { ArrowLeft, ChevronLeft, ChevronRight, Search } from "lucide-react";

export function CommuneSidebar({ currentCode }: { currentCode?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ code: string; nom: string; codesPostaux?: string[] }>
  >([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/municipalities`);
        if (res.ok) {
          const data = (await res.json()) as Array<{
            code: string;
            nom: string;
            codesPostaux?: string[];
          }>;
          const q = query.toLowerCase();
          const filtered = (Array.isArray(data) ? data : [])
            .filter(
              (m) =>
                m.nom?.toLowerCase().includes(q) ||
                m.codesPostaux?.some((cp) => cp.startsWith(q)),
            )
            .slice(0, 20);
          setResults(filtered);
        }
      } catch {
        /* ignore */
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-surface border-border-subtle hover:bg-border-subtle/40 fixed top-1/2 left-0 z-30 -translate-y-1/2 rounded-r-lg border p-2 transition-colors"
      >
        {open ? (
          <ChevronLeft className="size-4" />
        ) : (
          <ChevronRight className="size-4" />
        )}
      </button>

      {/* Sidebar panel */}
      {open && (
        <div className="bg-surface border-border-subtle fixed top-0 bottom-0 left-0 z-20 flex w-72 flex-col border-r shadow-xl">
          <div className="border-border-subtle border-b p-3">
            <Link
              href="/chat"
              className="text-muted-foreground hover:text-foreground hover:bg-border-subtle/40 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <ArrowLeft className="size-4" />
              Retour au chat
            </Link>
          </div>
          <div className="border-border-subtle border-b p-4">
            <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-widest uppercase">
              Communes
            </p>
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une commune…"
                className="bg-border-subtle/40 border-border-subtle text-foreground placeholder:text-muted-foreground focus:border-primary w-full rounded-lg border py-2 pr-3 pl-9 text-sm focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
            {searching && (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Recherche…
              </p>
            )}
            {!searching && query.length >= 2 && results.length === 0 && (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Aucun résultat
              </p>
            )}
            {results.map((r) => (
              <Link
                key={r.code}
                href={`/commune/${r.code}`}
                className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                  r.code === currentCode
                    ? "bg-primary/20 text-primary"
                    : "text-foreground hover:bg-border-subtle/40"
                }`}
              >
                <span className="font-medium">{r.nom}</span>
                {r.codesPostaux?.[0] && (
                  <span className="text-muted-foreground ml-1 text-xs">
                    ({r.codesPostaux[0]})
                  </span>
                )}
              </Link>
            ))}
            {query.length < 2 && (
              <p className="text-muted-foreground py-4 text-center text-xs">
                Tapez au moins 2 caractères
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
