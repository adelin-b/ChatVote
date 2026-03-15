'use client';

import { ChevronDown, ChevronUp, ExternalLink, Loader2, MapPin, Search, Sparkles, Unlock, Users } from 'lucide-react';
import { useState } from 'react';

type SearchResult = {
  id: number;
  content: string;
  source: string;
  url: string;
  page: number | string;
  party_id: string;
};

type ToolPart = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  args?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
};

type Props = {
  part: ToolPart;
  onSendMessage?: (text: string) => void;
};

export default function AiSdkToolResult({ part, onSendMessage }: Props) {
  const toolName = part.toolName ?? part.type.replace('tool-', '');
  const [expanded, setExpanded] = useState(false);

  // Searching state
  if (part.state === 'partial-call' || part.state === 'call' || part.state === 'input-available' || part.state === 'input-streaming') {
    const input = (part.input ?? part.args ?? {}) as Record<string, string>;
    const partyId = input.partyId;
    const query = input.query;

    return (
      <div className="bg-muted/50 my-2 flex items-center gap-2 rounded-lg border p-3 text-sm">
        <Loader2 className="text-primary size-4 animate-spin" />
        <span className="text-muted-foreground">
          {toolName === 'searchPartyManifesto' && (
            <>Recherche dans le programme de <strong>{partyId?.toUpperCase()}</strong>...</>
          )}
          {toolName === 'searchCandidateWebsite' && (
            <>Recherche sur le site du candidat...</>
          )}
          {toolName === 'suggestFollowUps' && (
            <>Génération de suggestions...</>
          )}
          {toolName === 'changeCity' && (
            <>Changement de ville...</>
          )}
          {toolName === 'changeCandidates' && (
            <>Mise à jour des partis...</>
          )}
          {toolName === 'removeRestrictions' && (
            <>Suppression des restrictions...</>
          )}
          {toolName === 'searchDataGouv' && (
            <>Recherche sur data.gouv.fr...</>
          )}
          {toolName === 'webSearch' && (
            <>Recherche sur le web...</>
          )}
          {toolName === 'renderWidget' && (
            <>Génération du widget...</>
          )}
          {toolName === 'searchVotingRecords' && (
            <>Recherche des votes parlementaires...</>
          )}
          {toolName === 'searchParliamentaryQuestions' && (
            <>Recherche des questions parlementaires...</>
          )}
          {![
            'searchPartyManifesto',
            'searchCandidateWebsite',
            'suggestFollowUps',
            'changeCity',
            'changeCandidates',
            'removeRestrictions',
            'searchDataGouv',
            'webSearch',
            'renderWidget',
            'searchVotingRecords',
            'searchParliamentaryQuestions',
          ].includes(toolName) && <>Traitement en cours...</>}
        </span>
        {query && (
          <span className="text-muted-foreground/60 truncate text-xs italic">
            &quot;{query}&quot;
          </span>
        )}
      </div>
    );
  }

  // Result state for suggestFollowUps - render as clickable chips
  if (toolName === 'suggestFollowUps' && part.state === 'output-available') {
    const result = part.output as { suggestions?: string[] };
    if (!result?.suggestions?.length) return null;

    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {result.suggestions.map((suggestion, i) => (
          <button
            key={i}
            onClick={() => onSendMessage?.(suggestion)}
            className="bg-background hover:bg-accent rounded-full border px-3 py-1.5 text-xs transition-colors"
          >
            <Sparkles className="mr-1 inline size-3" />
            {suggestion}
          </button>
        ))}
      </div>
    );
  }

  // Result state for search tools - render as expandable source cards
  if (
    part.state === 'output-available' &&
    (toolName === 'searchPartyManifesto' || toolName === 'searchCandidateWebsite')
  ) {
    const result = part.output as {
      partyId?: string;
      candidateId?: string;
      results?: SearchResult[];
      documents?: Array<{ content: string }>;
      count?: number;
    };

    const sources = result?.results ?? [];
    const count = result?.count ?? result?.documents?.length ?? sources.length;
    const label = result?.partyId ?? result?.candidateId;

    return (
      <div className="my-2 overflow-hidden rounded-lg border border-green-200 bg-green-50 text-xs dark:border-green-900 dark:bg-green-950">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="flex w-full items-center gap-2 p-2 text-left transition-colors hover:bg-green-100 dark:hover:bg-green-900/50"
        >
          <Search className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
          <span className="flex-1 text-green-800 dark:text-green-200">
            {count} source{count !== 1 ? 's' : ''} trouvée{count !== 1 ? 's' : ''}
            {label && (
              <> pour <strong>{label.toUpperCase()}</strong></>
            )}
          </span>
          {sources.length > 0 && (
            expanded
              ? <ChevronUp className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
              : <ChevronDown className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
          )}
        </button>

        {expanded && sources.length > 0 && (
          <ul className="divide-y divide-green-200 border-t border-green-200 dark:divide-green-900 dark:border-green-900">
            {sources.map((src, i) => (
              <li key={src.id ?? i} className="flex gap-2 p-2">
                <span className="bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-green-900 dark:text-green-100 line-clamp-3 leading-snug">
                    {src.content.length > 150
                      ? src.content.slice(0, 150) + '…'
                      : src.content}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-green-700 dark:text-green-400">
                    {src.source && (
                      <span className="truncate font-medium">{src.source}</span>
                    )}
                    {src.page != null && src.page !== '' && (
                      <span className="shrink-0">· p.{src.page}</span>
                    )}
                    {src.url && (
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto shrink-0 hover:text-green-900 dark:hover:text-green-200"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Result state for changeCity
  if (toolName === 'changeCity' && part.state === 'output-available') {
    const result = part.output as { action: string; cityName: string; municipalityCode?: string };
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-900 dark:bg-blue-950">
        <MapPin className="size-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-blue-800 dark:text-blue-200">
          Contexte changé : <strong>{result.cityName}</strong>
        </span>
      </div>
    );
  }

  // Result state for changeCandidates
  if (toolName === 'changeCandidates' && part.state === 'output-available') {
    const result = part.output as { action: string; partyIds: string[]; operation: string };
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-900 dark:bg-blue-950">
        <Users className="size-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-blue-800 dark:text-blue-200">
          Partis mis à jour : <strong>{result.partyIds.join(', ')}</strong>
        </span>
      </div>
    );
  }

  // Result state for removeRestrictions
  if (toolName === 'removeRestrictions' && part.state === 'output-available') {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-900 dark:bg-blue-950">
        <Unlock className="size-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-blue-800 dark:text-blue-200">
          Restrictions supprimées — recherche nationale activée
        </span>
      </div>
    );
  }

  // Result state for placeholder tools (available: false)
  if (part.state === 'output-available' && (part.output as any)?.available === false) {
    return (
      <div className="my-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
        <span className="text-amber-800 dark:text-amber-200">
          {(part.output as any)?.message ?? 'Fonctionnalité bientôt disponible'}
        </span>
      </div>
    );
  }

  return null;
}
