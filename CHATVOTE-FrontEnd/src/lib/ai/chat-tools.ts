/**
 * Shared chat tool definitions and utilities used by both:
 * - `route.ts` (production streaming chat via `streamText`)
 * - `chat-pipeline.ts` (eval harness via `generateText`)
 *
 * Only contains pieces that are truly identical between both files.
 * Each caller composes these with their own RAG-specific tools (which differ
 * in search strategy, global ID assignment, and web search providers).
 */
import { tool } from "ai";
import { z } from "zod/v4";

// ── data.gouv.fr REST API client ─────────────────────────────────────────────
// Uses the official data.gouv.fr REST API (https://www.data.gouv.fr/api/1/)
// Public endpoint, no API key required
export interface DataGouvDataset {
  id: string;
  title: string;
  description: string;
  url: string;
  organization?: { name: string };
  frequency?: string;
  last_modified?: string;
  resources?: Array<{ title: string; format: string; url: string }>;
}

export async function searchDataGouv(
  query: string,
  limit = 5,
): Promise<DataGouvDataset[]> {
  const apiUrl = `https://www.data.gouv.fr/api/1/datasets/?q=${encodeURIComponent(query)}&page_size=${limit}`;
  console.info("[data.gouv] Searching:", query);
  const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`data.gouv.fr API returned ${res.status}`);
  const json = await res.json();
  const results = (json.data ?? []).map((d: Record<string, unknown>) => ({
    id: d.id,
    title: d.title,
    description: String(d.description ?? "").slice(0, 300),
    url: d.page ?? `https://www.data.gouv.fr/fr/datasets/${d.id}/`,
    organization: d.organization
      ? { name: (d.organization as Record<string, unknown>).name }
      : undefined,
    frequency: d.frequency,
    last_modified: d.last_modified,
    resources: (Array.isArray(d.resources) ? d.resources : [])
      .slice(0, 3)
      .map((r: Record<string, unknown>) => ({
        title: r.title,
        format: r.format,
        url: r.url,
      })),
  }));
  console.info(`[data.gouv] Found ${results.length} datasets for "${query}"`);
  return results;
}

// ── Shared types ─────────────────────────────────────────────────────────────

export interface ToolCallSummary {
  stepNumber: number;
  toolName: string;
  args: Record<string, unknown>;
  resultPreview: string;
}

export interface SourceInfo {
  id: number;
  content: string;
  source?: string;
  url?: string;
  score?: number;
  party_id?: string;
  candidate_name?: string;
}

// ── Common tool parameters ───────────────────────────────────────────────────

export interface CommonToolParams {
  enabledFeatures?: string[];
  candidateIds?: string[];
  selectedCandidateIds?: string[];
}

// ── Common tools (identical between route.ts and chat-pipeline.ts) ───────────
// These tools have the same implementation in both the streaming route and
// the eval pipeline. Tools that differ (RAG search, webSearch, changeCity,
// runDeepResearch, searchVotingRecords, searchParliamentaryQuestions) remain
// in their respective files because they use caller-specific logic
// (e.g. assignGlobalIds, search caching, Firestore lookups).

export function buildCommonTools(params: CommonToolParams) {
  const {
    enabledFeatures,
    candidateIds: _candidateIds = [],
    selectedCandidateIds: _selectedCandidateIds = [],
  } = params;
  const features = enabledFeatures ?? ["rag"];

  return {
    // ── data.gouv.fr open data search ────────────────────────────────────────
    ...(features.includes("data-gouv")
      ? {
          searchDataGouv: tool({
            description:
              "Recherche dans les données ouvertes de l'État français (data.gouv.fr). Contient des jeux de données officiels : budgets municipaux, démographie INSEE, résultats électoraux, équipements publics, qualité de l'air, etc. Utilise pour appuyer une réponse avec des chiffres vérifiables ou quand l'utilisateur demande des statistiques.",
            inputSchema: z.object({
              query: z
                .string()
                .describe(
                  'Recherche en français (ex: "budget commune Marseille", "résultats élections municipales 2020")',
                ),
            }),
            execute: async (input) => {
              try {
                const datasets = await searchDataGouv(input.query, 5);
                return { datasets, count: datasets.length };
              } catch (err) {
                console.error("[ai-chat] searchDataGouv error:", err);
                return { datasets: [], count: 0, error: String(err) };
              }
            },
          }),
        }
      : {}),

    // ── Widget / chart rendering ─────────────────────────────────────────────
    ...(features.includes("widgets")
      ? {
          renderWidget: tool({
            description:
              "Affiche un graphique interactif. Utilise pour comparer visuellement les positions des candidats, montrer des statistiques de vote, ou visualiser des données structurées. Particulièrement utile quand tu as des données chiffrées à comparer (budgets, pourcentages, scores). Le frontend gère le rendu — tu fournis les données.",
            inputSchema: z.object({
              title: z.string().describe("Chart title"),
              chartType: z
                .enum(["bar", "pie", "radar", "line"])
                .describe(
                  "Type of chart: bar (comparison), pie (distribution), radar (multi-axis), line (trends)",
                ),
              data: z
                .array(
                  z.object({
                    label: z
                      .string()
                      .describe("Data point label (e.g. party name, category)"),
                    value: z.number().describe("Numeric value"),
                    color: z
                      .string()
                      .optional()
                      .describe("Optional hex color (e.g. #FF0000)"),
                  }),
                )
                .describe("Array of data points to visualize"),
              xAxisLabel: z.string().optional().describe("X-axis label"),
              yAxisLabel: z.string().optional().describe("Y-axis label"),
            }),
            execute: async (input) => ({
              widget: {
                type: "chart",
                chartType: input.chartType,
                title: input.title,
                data: input.data,
                xAxisLabel: input.xAxisLabel,
                yAxisLabel: input.yAxisLabel,
              },
            }),
          }),
        }
      : {}),

    // ── Always-on tools ──────────────────────────────────────────────────────
    suggestFollowUps: tool({
      description:
        "Génère 3 suggestions de questions de suivi pertinentes et concrètes. Les suggestions doivent approfondir le sujet discuté, explorer un angle connexe, ou comparer avec d'autres candidats/thèmes. Appelle cet outil à la FIN de chaque réponse. N'écris JAMAIS les suggestions en texte — utilise TOUJOURS cet outil.",
      inputSchema: z.object({
        suggestions: z
          .array(z.string())
          .length(3)
          .describe(
            "3 questions de suivi : une qui approfondit, une qui compare, une qui explore un thème connexe",
          ),
      }),
      execute: async (input) => {
        return { suggestions: input.suggestions };
      },
    }),

    presentOptions: tool({
      description:
        "Affiche des options cliquables pour l'utilisateur. Utilise au lieu d'écrire une liste numérotée ou des questions dans le texte. Mets la question dans le champ 'label' et les choix dans 'options'. N'écris PAS ces éléments dans ton texte — l'outil les affiche automatiquement comme des boutons.",
      inputSchema: z.object({
        label: z
          .string()
          .optional()
          .describe(
            'Titre optionnel au-dessus des options (ex : "Quel sujet t\'intéresse ?")',
          ),
        options: z
          .array(z.string())
          .min(2)
          .max(8)
          .describe("Les options à présenter comme boutons cliquables"),
      }),
      execute: async (input) => {
        return { label: input.label, options: input.options };
      },
    }),

    changeCandidates: tool({
      description:
        "Modifie la sélection de candidats/partis de l'utilisateur. Utilise quand l'utilisateur veut se concentrer sur certains partis, en ajouter ou en retirer de la comparaison.",
      inputSchema: z.object({
        partyIds: z
          .array(z.string())
          .describe("IDs des partis à ajouter, définir ou retirer"),
        operation: z
          .enum(["set", "add", "remove"])
          .describe(
            '"set" remplace la sélection, "add" ajoute, "remove" retire',
          ),
      }),
      execute: async (input) => {
        return {
          action: "changeCandidates",
          partyIds: input.partyIds,
          operation: input.operation,
        };
      },
    }),

    removeRestrictions: tool({
      description:
        "Supprime les filtres de commune ou de parti pour élargir la recherche au niveau national. Utilise quand l'utilisateur veut comparer au-delà de sa commune ou chercher des informations sur des partis non présents localement.",
      inputSchema: z.object({
        reason: z
          .string()
          .describe(
            "Raison de l'élargissement (ex: \"l'utilisateur veut comparer avec d'autres villes\")",
          ),
      }),
      execute: async (input) => {
        return { action: "removeRestrictions", reason: input.reason };
      },
    }),
  };
}
