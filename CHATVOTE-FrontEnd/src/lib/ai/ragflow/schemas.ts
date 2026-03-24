/**
 * RAGFlow API Zod Schemas (v0.24.0)
 *
 * These schemas are hand-written from the official RAGFlow Python SDK types:
 *   https://github.com/infiniflow/ragflow/tree/main/sdk/python/ragflow_sdk/modules
 *
 * Why hand-written instead of auto-generated?
 *   - RAGFlow's OpenAPI spec at /openapi.json has 0 component schemas
 *     (all `responses: {}` are empty — auto-generated from Flask without annotations)
 *   - PR #12722 attempted to add Pydantic schemas but was closed without merging
 *     (CI failure — server couldn't start)
 *   - Issue #9835 tracks the request for proper OpenAPI schema support
 *   - No official JS/TS SDK exists (only Python SDK at sdk/python/)
 *
 * When RAGFlow ships proper schemas, replace these with codegen from:
 *   @hey-api/openapi-ts (recommended — Zod v4 plugin, handles empty responses)
 *   or Kubb (@kubb/plugin-zod — modular, supports zod/mini)
 *
 * @see https://github.com/infiniflow/ragflow/issues/9835
 * @see https://github.com/infiniflow/ragflow/pull/12722
 * @see https://ragflow.io/docs/v0.24.0/http_api_reference
 */

import { z } from "zod/v4";

// ── Common Response Wrapper ──────────────────────────────────────────────────
// All RAGFlow API responses follow this shape: { code: number, data: T, message: string }

export const RagflowResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    code: z.number(),
    data: dataSchema,
    message: z.string().default(""),
  });

// ── Dataset (Python SDK: sdk/python/ragflow_sdk/modules/dataset.py) ─────────

export const ParserConfigSchema = z.object({
  chunk_token_num: z.number().default(512),
  layout_recognize: z.string().default("DeepDOC"),
  task_page_size: z.number().default(12),
  auto_keywords: z.boolean().default(false),
  auto_questions: z.boolean().default(false),
  pages: z.array(z.tuple([z.number(), z.number()] as const)).optional(),
  raptor: z.record(z.string(), z.unknown()).optional(),
  graphrag: z.record(z.string(), z.unknown()).optional(),
});
export type ParserConfig = z.infer<typeof ParserConfigSchema>;

export const DatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().default(""),
  tenant_id: z.string().nullable().optional(),
  description: z.string().default(""),
  embedding_model: z.string().default(""),
  permission: z.string().default("me"),
  document_count: z.number().default(0),
  chunk_count: z.number().default(0),
  chunk_method: z.string().default("naive"),
  parser_config: ParserConfigSchema.optional().nullable(),
  pagerank: z.number().default(0),
  language: z.string().default("French"),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
});
export type Dataset = z.infer<typeof DatasetSchema>;

// ── Document (Python SDK: sdk/python/ragflow_sdk/modules/document.py) ────────

export const DocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  thumbnail: z.string().nullable().optional(),
  dataset_id: z.string().nullable().optional(),
  chunk_method: z.string().default("naive"),
  parser_config: ParserConfigSchema.optional().nullable(),
  source_type: z.string().default("local"),
  type: z.string().default(""),
  created_by: z.string().default(""),
  size: z.number().default(0),
  token_count: z.number().default(0),
  chunk_count: z.number().default(0),
  progress: z.number().default(0),
  progress_msg: z.string().default(""),
  process_begin_at: z.string().nullable().optional(),
  process_duration: z.number().default(0),
  run: z.string().default("0"),
  status: z.string().default("1"),
  meta_fields: z.record(z.string(), z.unknown()).default({}),
  create_time: z.string().optional(),
  update_time: z.string().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

// ── Chunk (Python SDK: sdk/python/ragflow_sdk/modules/chunk.py) ──────────────

export const ChunkSchema = z.object({
  id: z.string(),
  content: z.string().default(""),
  important_keywords: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  create_time: z.string().default(""),
  create_timestamp: z.number().default(0),
  dataset_id: z.string().nullable().optional(),
  document_name: z.string().default(""),
  document_keyword: z.string().default(""),
  document_id: z.string().default(""),
  available: z.boolean().default(true),
  // Retrieval result fields
  similarity: z.number().default(0),
  vector_similarity: z.number().default(0),
  term_similarity: z.number().default(0),
  positions: z.array(z.unknown()).default([]),
  doc_type: z.string().default(""),
});
export type Chunk = z.infer<typeof ChunkSchema>;

// ── Retrieval ────────────────────────────────────────────────────────────────

export const RetrievalRequestSchema = z.object({
  question: z.string(),
  dataset_ids: z.array(z.string()).optional(),
  top_k: z.number().default(6),
  similarity_threshold: z.number().default(0.2),
  vector_similarity_weight: z.number().default(0.3),
  use_kg: z.boolean().default(false),
});
export type RetrievalRequest = z.infer<typeof RetrievalRequestSchema>;

export const RetrievalChunkSchema = z.object({
  content: z.string().default(""),
  document_name: z.string().default(""),
  dataset_name: z.string().default(""),
  similarity: z.number().default(0),
  /** Alias for similarity — used by some consumers */
  similarity_score: z.number().default(0),
  vector_similarity: z.number().default(0),
  term_similarity: z.number().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type RetrievalChunk = z.infer<typeof RetrievalChunkSchema>;

// ── Knowledge Graph ──────────────────────────────────────────────────────────

export const KGNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  entity_type: z.string().default(""),
  description: z.string().default(""),
  pagerank: z.number().default(0),
});
export type KGNode = z.infer<typeof KGNodeSchema>;

export const KGEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().default(""),
  weight: z.number().default(0),
});
export type KGEdge = z.infer<typeof KGEdgeSchema>;

export const KnowledgeGraphSchema = z.object({
  nodes: z.array(KGNodeSchema).default([]),
  edges: z.array(KGEdgeSchema).default([]),
  mind_map: z.string().optional(),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

// ── Chunk Methods (from RAGFlow docs) ────────────────────────────────────────

export const ChunkMethodSchema = z.enum([
  "naive",
  "qa",
  "manual",
  "table",
  "paper",
  "book",
  "laws",
  "presentation",
  "one",
  "picture",
  "email",
  "tag",
  "knowledge_graph",
]);
export type ChunkMethod = z.infer<typeof ChunkMethodSchema>;
