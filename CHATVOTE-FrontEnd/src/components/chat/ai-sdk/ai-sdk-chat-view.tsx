'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, getToolName, isToolUIPart } from 'ai';
import { Plus } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChatStoreContext, useChatStore } from '@components/providers/chat-store-provider';
import { MunicipalitySearch } from '@components/election-flow';
import { type Municipality } from '@lib/election/election.types';
import { useAiSdkFeaturesStore } from '@lib/stores/ai-sdk-features-store';
import AiSdkCandidateBar from './ai-sdk-candidate-bar';
import AiSdkFeatureRibbon from './ai-sdk-feature-ribbon';
import AiSdkMessage from './ai-sdk-message';
import AiSdkStreamingIndicator from './ai-sdk-streaming-indicator';

type Props = {
  chatId?: string;
  locale: string;
  municipalityCode?: string;
};

export default function AiSdkChatView({ chatId, locale, municipalityCode: municipalityCodeProp }: Props) {
  const partyIds = useChatStore((s) => s.partyIds);
  const scope = useChatStore((s) => s.scope);
  const storeMunicipalityCode = useChatStore((s) => s.municipalityCode);
  const municipalityCode = municipalityCodeProp ?? storeMunicipalityCode;
  const getEnabledFeatureIds = useAiSdkFeaturesStore((s) => s.getEnabledFeatureIds);
  const features = useAiSdkFeaturesStore((s) => s.features);

  // Municipality search (mirroring classic mode)
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedMunicipality, setSelectedMunicipality] = useState<Municipality | null>(null);

  const handleSelectMunicipality = useCallback(
    (municipality: Municipality) => {
      setSelectedMunicipality(municipality);
      const next = new URLSearchParams(searchParams.toString());
      next.set('municipality_code', municipality.code);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Stabilize partyIds — only update ref when the actual values change
  const partyIdsRef = useRef<string[]>([]);
  const currentIds = Array.from(partyIds).sort().join(',');
  const prevIds = partyIdsRef.current.sort().join(',');
  if (currentIds !== prevIds) {
    partyIdsRef.current = Array.from(partyIds);
  }

  // Stabilize enabledFeatures — recompute only when features change
  const enabledFeaturesKey = features
    .filter((f) => f.enabled)
    .map((f) => f.id)
    .join(',');

  const [input, setInput] = useState('');

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/ai-chat',
        body: {
          partyIds: partyIdsRef.current,
          locale,
          chatId,
          scope,
          municipalityCode,
          enabledFeatures: getEnabledFeatureIds(),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentIds, locale, chatId, scope, municipalityCode, enabledFeaturesKey],
  );

  const { messages, sendMessage, regenerate, stop, status, error } = useChat({
    transport,
  });

  const setPartyIds = useChatStore((s) => s.setPartyIds);
  const storeApi = useContext(ChatStoreContext);

  // Apply context tool results to the store when messages arrive
  useEffect(() => {
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== 'output-available') continue;
        const toolName = getToolName(part);

        if (toolName === 'changeCity') {
          const result = part.output as { municipalityCode?: string };
          if (result.municipalityCode && storeApi) {
            storeApi.setState({ municipalityCode: result.municipalityCode, scope: 'local' });
            window.location.reload();
          }
        } else if (toolName === 'changeCandidates') {
          const result = part.output as { partyIds: string[]; operation: string };
          if (result.operation === 'set') {
            setPartyIds(result.partyIds);
          } else if (result.operation === 'add') {
            const current = Array.from(storeApi?.getState().partyIds ?? []);
            setPartyIds([...new Set([...current, ...result.partyIds])]);
          } else if (result.operation === 'remove') {
            const current = Array.from(storeApi?.getState().partyIds ?? []);
            setPartyIds(current.filter((id) => !result.partyIds.includes(id)));
          }
        } else if (toolName === 'removeRestrictions') {
          if (storeApi) {
            storeApi.setState({ municipalityCode: undefined, scope: 'national' });
          }
          setPartyIds([]);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === 'streaming') return;
    sendMessage({ text });
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      {/* Feature toggle ribbon */}
      <AiSdkFeatureRibbon />

      {/* Candidate/party pills for the current municipality */}
      {municipalityCode && <AiSdkCandidateBar municipalityCode={municipalityCode} />}

      {messages.length > 0 && (
        <div className="flex justify-end px-3 md:px-9">
          <button
            onClick={() => window.location.reload()}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
          >
            <Plus className="size-3.5" />
            Nouveau chat
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-9">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && !municipalityCode && (
            <div className="flex h-full items-center justify-center py-20">
              <div className="flex flex-col items-center gap-6">
                <h2 className="text-lg font-semibold">Assistant IA ChatVote</h2>
                <MunicipalitySearch
                  selectedMunicipality={selectedMunicipality}
                  onSelectMunicipality={handleSelectMunicipality}
                  municipalityCode={undefined}
                />
              </div>
            </div>
          )}

          {messages.length === 0 && municipalityCode && (
            <div className="flex h-full items-center justify-center py-20">
              <div className="text-center">
                <h2 className="text-lg font-semibold">Assistant IA ChatVote</h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  Posez une question sur les programmes et candidats
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    'Que proposent les candidats sur la sécurité ?',
                    "Quelles sont les positions sur l'écologie ?",
                    "Comment améliorer l'éducation dans ma commune ?",
                    'Que disent les candidats sur le pouvoir d\'achat ?',
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage({ text: q })}
                      className="bg-muted hover:bg-accent rounded-full border px-3 py-1.5 text-xs transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <AiSdkMessage
              key={message.id}
              message={message}
              onSendMessage={(text) => sendMessage({ text })}
            />
          ))}

          {status === 'streaming' && <AiSdkStreamingIndicator />}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
              <p className="text-sm text-red-800 dark:text-red-200">
                Une erreur est survenue.
                <button
                  onClick={() => regenerate()}
                  className="ml-2 font-medium underline hover:no-underline"
                >
                  Réessayer
                </button>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t px-3 py-3 md:px-9">
        <form
          onSubmit={handleSubmit}
          className="border-border-strong bg-surface-input relative mx-auto flex max-w-3xl items-center gap-4 overflow-hidden rounded-4xl border px-4 py-3 transition-colors focus-within:border-zinc-400 dark:focus-within:border-zinc-700"
        >
          <input
            className="placeholder:text-muted-foreground flex-1 text-base whitespace-pre focus-visible:ring-0 focus-visible:outline-none disabled:cursor-not-allowed"
            placeholder="Posez une question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === 'streaming'}
          />
          {status === 'streaming' ? (
            <button
              type="button"
              onClick={stop}
              className="bg-foreground text-background hover:bg-foreground/80 flex size-8 flex-none items-center justify-center rounded-full transition-colors"
            >
              <span className="size-3 rounded-sm bg-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.length}
              className="bg-foreground text-background hover:bg-foreground/80 disabled:bg-foreground/20 disabled:text-muted flex size-8 flex-none items-center justify-center rounded-full transition-colors"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
