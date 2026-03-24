/**
 * RAGFlow REST API client — backward-compatible re-export.
 *
 * The implementation has moved to @lib/ai/ragflow/ (Zod-validated, fully typed).
 * This file re-exports the old public API surface for existing consumers.
 *
 * Prefer importing from "@lib/ai/ragflow" directly for new code:
 *   import { ragflow } from "@lib/ai/ragflow";
 *   const chunks = await ragflow.retrieve({ question: "..." });
 */

import { ragflow, type RetrievalChunk } from "./ragflow";

// ── Re-export types expected by existing consumers ───────────────────────────

export type { RetrievalChunk as RagflowChunk } from "./ragflow";
export type { Dataset as RagflowDataset } from "./ragflow";

// ── Re-export functions with old signatures ──────────────────────────────────

/**
 * Search RAGFlow knowledge base.
 * @deprecated Use `ragflow.retrieve()` from "@lib/ai/ragflow" instead.
 */
export async function searchRagflow(
  query: string,
  datasetIds?: string[],
  topK = 6,
  similarityThreshold = 0.2,
  useKg = false,
): Promise<RetrievalChunk[]> {
  if (!ragflow.isConfigured()) return [];
  try {
    return await ragflow.retrieve({
      question: query,
      dataset_ids: datasetIds,
      top_k: topK,
      similarity_threshold: similarityThreshold,
      use_kg: useKg,
    });
  } catch (err) {
    console.error("[ragflow] Search error:", err);
    return [];
  }
}

/**
 * List all datasets.
 * @deprecated Use `ragflow.listDatasets()` from "@lib/ai/ragflow" instead.
 */
export async function listDatasets() {
  if (!ragflow.isConfigured()) return [];
  try {
    return await ragflow.listDatasets();
  } catch (err) {
    console.error("[ragflow] List datasets error:", err);
    return [];
  }
}

/**
 * Create a dataset.
 * @deprecated Use `ragflow.createDataset()` from "@lib/ai/ragflow" instead.
 */
export async function createDataset(
  name: string,
  chunkMethod = "naive",
  _language = "French",
) {
  if (!ragflow.isConfigured()) return null;
  try {
    return await ragflow.createDataset({
      name,
      chunk_method: chunkMethod as "naive",
    });
  } catch (err) {
    console.error("[ragflow] Create dataset error:", err);
    return null;
  }
}
