import { google } from '@ai-sdk/google';
import { type UIMessage, convertToModelMessages, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod/v4';

import { embedQuery } from '@lib/ai/embedding';
import { COLLECTIONS, qdrantClient } from '@lib/ai/qdrant-client';
import { db } from '@lib/firebase/firebase-admin';

export const maxDuration = 120;

interface QdrantPayload {
  page_content?: string;
  metadata?: {
    source?: string;
    url?: string;
    page?: number | string;
    party_id?: string;
    namespace?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface SearchResult {
  id: number;
  content: string;
  source: string;
  url: string;
  page: number | string;
  party_id: string;
}

async function searchQdrant(
  collection: string,
  query: string,
  filterKey: string,
  filterValue: string,
  limit: number,
): Promise<SearchResult[]> {
  const embedding = await embedQuery(query);

  const results = await qdrantClient.search(collection, {
    vector: { name: 'dense', vector: embedding },
    filter: {
      must: [
        {
          key: filterKey,
          match: { value: filterValue },
        },
      ],
    },
    limit,
    with_payload: true,
  });

  return results.map((r, idx) => {
    const payload = (r.payload ?? {}) as QdrantPayload;
    const meta = payload.metadata ?? {};
    return {
      id: idx + 1,
      content: String(payload.page_content ?? ''),
      source: String(meta.source ?? ''),
      url: String(meta.url ?? ''),
      page: (meta.page as number | string) ?? '',
      party_id: String(meta.party_id ?? meta.namespace ?? ''),
    };
  });
}

function buildTools(enabledFeatures: string[] | undefined) {
  const features = enabledFeatures ?? ['rag'];
  const ragEnabled = features.includes('rag');

  return {
    // ── RAG search tools (feature-gated) ────────────────────────────────────
    ...(ragEnabled
      ? {
          searchPartyManifesto: tool({
            description:
              "Search a political party's manifesto/programme for relevant content. Call this for EACH relevant party. You can search multiple parties simultaneously.",
            inputSchema: z.object({
              partyId: z.string().describe('The party identifier to search within'),
              query: z.string().describe('The search query to find relevant content'),
            }),
            execute: async (input) => {
              const { partyId, query } = input;
              const normalizedPartyId = partyId.toLowerCase();
              try {
                const results = await searchQdrant(
                  COLLECTIONS.allParties,
                  query,
                  'metadata.namespace',
                  normalizedPartyId,
                  8,
                );
                return { partyId, results, count: results.length };
              } catch (err) {
                console.error('[ai-chat] searchPartyManifesto error:', err);
                return { partyId, results: [] as SearchResult[], count: 0, error: String(err) };
              }
            },
          }),
          searchCandidateWebsite: tool({
            description: "Search a candidate's website content for relevant information.",
            inputSchema: z.object({
              candidateId: z.string().describe('The candidate identifier to search within'),
              query: z.string().describe('The search query to find relevant content'),
            }),
            execute: async (input) => {
              const { candidateId, query } = input;
              const normalizedCandidateId = candidateId.toLowerCase();
              try {
                const results = await searchQdrant(
                  COLLECTIONS.candidatesWebsites,
                  query,
                  'metadata.namespace',
                  normalizedCandidateId,
                  5,
                );
                return { candidateId, results, count: results.length };
              } catch (err) {
                console.error('[ai-chat] searchCandidateWebsite error:', err);
                return { candidateId, results: [] as SearchResult[], count: 0, error: String(err) };
              }
            },
          }),
        }
      : {}),

    // ── Placeholder tools (feature-gated) ───────────────────────────────────
    ...(features.includes('data-gouv')
      ? {
          searchDataGouv: tool({
            description: 'Search open government data on data.gouv.fr.',
            inputSchema: z.object({
              query: z.string().describe('The search query'),
            }),
            execute: async () => ({
              available: false,
              message: 'Cette fonctionnalité sera bientôt disponible.',
            }),
          }),
        }
      : {}),

    ...(features.includes('perplexity')
      ? {
          webSearch: tool({
            description: 'Search the web for recent news and information.',
            inputSchema: z.object({
              query: z.string().describe('The search query'),
            }),
            execute: async () => ({
              available: false,
              message: 'Cette fonctionnalité sera bientôt disponible.',
            }),
          }),
        }
      : {}),

    ...(features.includes('widgets')
      ? {
          renderWidget: tool({
            description: 'Render an interactive chart or visualization widget.',
            inputSchema: z.object({
              query: z.string().describe('The data or topic to visualize'),
            }),
            execute: async () => ({
              available: false,
              message: 'Cette fonctionnalité sera bientôt disponible.',
            }),
          }),
        }
      : {}),

    ...(features.includes('voting-records')
      ? {
          searchVotingRecords: tool({
            description: 'Search parliamentary voting records.',
            inputSchema: z.object({
              query: z.string().describe('The topic or bill to search voting records for'),
            }),
            execute: async () => ({
              available: false,
              message: 'Cette fonctionnalité sera bientôt disponible.',
            }),
          }),
        }
      : {}),

    ...(features.includes('parliamentary')
      ? {
          searchParliamentaryQuestions: tool({
            description: 'Search parliamentary questions.',
            inputSchema: z.object({
              query: z.string().describe('The topic to search parliamentary questions for'),
            }),
            execute: async () => ({
              available: false,
              message: 'Cette fonctionnalité sera bientôt disponible.',
            }),
          }),
        }
      : {}),

    // ── Always-on tools ──────────────────────────────────────────────────────
    suggestFollowUps: tool({
      description: 'Generate 3 follow-up question suggestions for the user.',
      inputSchema: z.object({
        suggestions: z
          .array(z.string())
          .length(3)
          .describe('Exactly 3 follow-up question suggestions'),
      }),
      execute: async (input) => {
        return { suggestions: input.suggestions };
      },
    }),

    changeCity: tool({
      description:
        "Change the user's municipality/city context. Use when user asks to switch city or change location.",
      inputSchema: z.object({
        cityName: z.string().describe('The name of the city to switch to'),
        municipalityCode: z
          .string()
          .optional()
          .describe('The INSEE municipality code if known'),
      }),
      execute: async (input) => {
        return {
          action: 'changeCity',
          cityName: input.cityName,
          municipalityCode: input.municipalityCode,
        };
      },
    }),

    changeCandidates: tool({
      description:
        'Update selected candidates/parties. Use when user asks to focus on specific parties or remove parties.',
      inputSchema: z.object({
        partyIds: z.array(z.string()).describe('The party IDs to set, add, or remove'),
        operation: z
          .enum(['set', 'add', 'remove'])
          .describe('Whether to set, add to, or remove from current selection'),
      }),
      execute: async (input) => {
        return {
          action: 'changeCandidates',
          partyIds: input.partyIds,
          operation: input.operation,
        };
      },
    }),

    removeRestrictions: tool({
      description:
        'Remove municipality/party restrictions for a broader national search. Use when user wants to search across all parties or remove city filter.',
      inputSchema: z.object({
        reason: z.string().describe('Brief reason why the user wants to broaden scope'),
      }),
      execute: async (input) => {
        return { action: 'removeRestrictions', reason: input.reason };
      },
    }),
  };
}

export async function POST(req: Request) {
  const {
    messages: uiMessages,
    partyIds,
    locale,
    chatId,
    municipalityCode,
    enabledFeatures,
  } = (await req.json()) as {
    messages: UIMessage[];
    partyIds?: string[];
    locale?: string;
    chatId?: string;
    municipalityCode?: string;
    enabledFeatures?: string[];
  };

  const messages = await convertToModelMessages(uiMessages ?? []);

  const currentDate = new Date().toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  let resolvedPartyIds = partyIds ?? [];
  let candidateContext = '';
  let candidateIds: string[] = [];

  if (municipalityCode) {
    try {
      const candidatesSnap = await db
        .collection('candidates')
        .where('municipality_code', '==', municipalityCode)
        .get();

      const candidates = candidatesSnap.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      if (candidates.length > 0) {
        // Extract unique party IDs from candidates if none provided
        if (resolvedPartyIds.length === 0) {
          resolvedPartyIds = [
            ...new Set(candidates.flatMap((c: any) => c.party_ids ?? []).filter(Boolean)),
          ];
        }

        // Collect candidate IDs for search instructions
        candidateIds = candidates.map((c: any) => c.id);

        // Fetch party details for richer context
        const partiesSnap = await db.collection('parties').get();
        const partiesMap = new Map<string, any>();
        for (const doc of partiesSnap.docs) {
          partiesMap.set(doc.id, { id: doc.id, ...doc.data() });
        }

        // Build rich candidate context for system prompt
        candidateContext =
          `\n\n# Candidats disponibles dans cette commune (${municipalityCode})\n` +
          candidates
            .map((c: any) => {
              const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.id;
              const partyNames = (c.party_ids ?? [])
                .map((pid: string) => partiesMap.get(pid)?.name ?? pid)
                .join(', ');
              const lines = [`## ${name}`];
              lines.push(`- **ID candidat (pour searchCandidateWebsite)**: \`${c.id}\``);
              lines.push(`- **Parti(s)**: ${partyNames || 'Indépendant'}`);
              if (c.position) lines.push(`- **Position**: ${c.position}`);
              if (c.bio) lines.push(`- **Bio**: ${c.bio}`);
              if (c.website_url) lines.push(`- **Site web**: ${c.website_url}`);
              if (c.has_manifesto) lines.push(`- **Profession de foi**: disponible`);
              if (c.manifesto_pdf_url) lines.push(`- **PDF programme**: ${c.manifesto_pdf_url}`);
              if (c.is_incumbent) lines.push(`- **Sortant**: oui`);
              if (c.birth_year) lines.push(`- **Année de naissance**: ${c.birth_year}`);
              return lines.join('\n');
            })
            .join('\n\n');
      }
    } catch (err) {
      console.error('[ai-chat] Failed to resolve candidates:', err);
    }
  }

  const partiesList =
    resolvedPartyIds.length > 0 ? resolvedPartyIds.join(', ') : 'non spécifiés';
  const respondInLanguage =
    locale === 'en'
      ? 'Respond in English.'
      : "Réponds en français, en utilisant \"tu\" pour t'adresser à l'utilisateur.";

  const candidateIdsList = candidateIds.map((id) => `  - candidateId: "${id}"`).join('\n');

  const searchInstructions = municipalityCode
    ? `# RÈGLE CRITIQUE — OBLIGATOIRE
Pour TOUTE question politique, tu DOIS appeler searchCandidateWebsite pour CHAQUE candidat ci-dessous AVANT de répondre.
N'utilise PAS searchPartyManifesto en mode local.
Ne réponds JAMAIS sans avoir d'abord appelé les outils de recherche.
Ne demande JAMAIS à l'utilisateur de préciser quel candidat — cherche dans TOUS.

Appelle searchCandidateWebsite avec ces candidateId (un appel par candidat) :
${candidateIdsList || '  (aucun candidat trouvé)'}`
    : `# RÈGLE CRITIQUE — OBLIGATOIRE
Pour TOUTE question politique, tu DOIS appeler searchPartyManifesto pour CHAQUE parti ci-dessous AVANT de répondre.
Ne réponds JAMAIS sans avoir d'abord appelé les outils de recherche.
Ne demande JAMAIS à l'utilisateur de préciser quel parti — cherche dans TOUS.

Appelle searchPartyManifesto avec ces partyId (un appel par parti) :
${resolvedPartyIds.map((id) => `  - partyId: "${id}"`).join('\n') || '  (aucun parti trouvé)'}`;

  const contextLine = municipalityCode
    ? `L'utilisateur consulte les candidats de la commune ${municipalityCode}`
    : `L'utilisateur a sélectionné ces partis : ${partiesList}`;

  const systemPrompt = `${searchInstructions}

Candidats/partis disponibles pour la recherche : ${partiesList}

# Rôle
Tu es un assistant IA politiquement neutre qui aide les citoyens à se renseigner sur les partis politiques et leurs positions pour les élections françaises.
Tu utilises les documents récupérés via les outils pour répondre aux questions de l'utilisateur avec des citations de sources.

# Contexte
Date : ${currentDate}
${contextLine}

# Instructions pour ta réponse
1. **Basé sur les sources** : Pour les questions sur les programmes des partis, réfère-toi exclusivement aux informations des documents récupérés. Si les documents ne contiennent pas d'information sur le sujet, dis-le honnêtement. N'invente jamais de faits.
2. **Neutralité stricte** : N'évalue pas les positions des partis. Évite les adjectifs subjectifs. Ne donne AUCUNE recommandation de vote.
3. **Transparence** : Signale les incertitudes. Admets quand tu ne sais pas. Distingue les faits des interprétations.
4. **Style de réponse** :
   - Réponds avec des sources, de manière concrète et facile à comprendre
   - Donne des chiffres précis quand ils sont disponibles dans les sources
   - Cite les sources : après chaque affirmation factuelle, indique les IDs de source entre crochets [1], [2]
   - Si aucune source n'a été utilisée pour une affirmation, écris-la en italique
   - Formate en Markdown avec des puces et des mots-clés en gras
   - Garde les réponses courtes : 1-3 phrases ou puces, sauf si l'utilisateur demande plus de détails
5. **Limites** : Signale quand l'information peut être obsolète, les faits peu clairs, ou quand une question ne peut pas être traitée neutralement
6. **Protection des données** : Ne demande pas d'intentions de vote ni de données personnelles
7. **Suggestions de suivi** : À la fin de CHAQUE réponse, appelle TOUJOURS l'outil suggestFollowUps avec 3 questions de suivi pertinentes liées au sujet discuté

${respondInLanguage}${candidateContext}`;

  const result = streamText({
    model: google('gemini-2.0-flash'),
    system: systemPrompt,
    messages,
    stopWhen: stepCountIs(5),
    toolChoice: 'auto' as const,
    onStepFinish({ stepNumber, toolCalls, finishReason, usage }) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[ai-chat]', {
          chatId,
          stepNumber,
          toolCalls: toolCalls?.map((t) => t?.toolName),
          finishReason,
          usage,
        });
      }
    },
    tools: buildTools(enabledFeatures),
  });

  return result.toUIMessageStreamResponse();
}
