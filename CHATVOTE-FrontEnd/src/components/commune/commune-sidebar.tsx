"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { ArrowLeft, ChevronLeft, ChevronRight, MessageCircle, Search } from "lucide-react";

export function CommuneSidebar({ currentCode }: { currentCode?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ code: string; nom: string; codesPostaux?: string[] }>>([]);
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
          const data = await res.json() as Array<{ code: string; nom: string; codesPostaux?: string[] }>;
          const q = query.toLowerCase();
          const filtered = (Array.isArray(data) ? data : []).filter(
            (m) =>
              m.nom?.toLowerCase().includes(q) ||
              m.codesPostaux?.some((cp) => cp.startsWith(q))
          ).slice(0, 20);
          setResults(filtered);
        }
      } catch { /* ignore */ }
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
        className="fixed left-0 top-1/2 -translate-y-1/2 z-30 bg-surface border border-border-subtle rounded-r-lg p-2 hover:bg-border-subtle/40 transition-colors"
      >
        {open ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {/* Sidebar panel */}
      {open && (
        <div className="fixed left-0 top-0 bottom-0 z-20 w-72 bg-surface border-r border-border-subtle flex flex-col shadow-xl">
          <div className="p-3 border-b border-border-subtle">
            <Link
              href="/chat"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-border-subtle/40 transition-colors"
            >
              <ArrowLeft className="size-4" />
              Retour au chat
            </Link>
          </div>
          <div className="p-4 border-b border-border-subtle">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
              Communes
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une commune…"
                className="w-full bg-border-subtle/40 border border-border-subtle rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {searching && (
              <p className="text-xs text-muted-foreground text-center py-4">Recherche…</p>
            )}
            {!searching && query.length >= 2 && results.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Aucun résultat</p>
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
              <p className="text-xs text-muted-foreground text-center py-4">
                Tapez au moins 2 caractères
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
