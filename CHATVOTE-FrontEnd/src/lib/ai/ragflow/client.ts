/**
 * RAGFlow Typed API Client (v0.24.0)
 *
 * A Zod-validated, fully typed client for the RAGFlow REST API.
 * Replaces the handmade fetch calls in the old ragflow-client.ts.
 *
 * Architecture:
 *   - Zod schemas (./schemas.ts) define the contract — derived from the Python SDK
 *   - This client validates all responses at runtime via .parse()
 *   - TypeScript types are inferred from Zod (single source of truth)
 *
 * Why not auto-generated?
 *   - RAGFlow's OpenAPI spec has 0 component schemas (issue #9835)
 *   - PR #12722 tried to add Pydantic schemas but wasn't merged
 *   - No official JS/TS SDK exists — only Python (sdk/python/)
 *   - When RAGFlow ships proper schemas, swap to @hey-api/openapi-ts codegen
 *
 * Configuration:
 *   RAGFLOW_API_URL — base URL (default: http://localhost:9380)
 *   RAGFLOW_API_KEY — Bearer token (RAGFlow UI → user avatar → API Keys)
 *
 * @see https://ragflow.io/docs/v0.24.0/http_api_reference
 * @see https://github.com/infiniflow/ragflow/tree/main/sdk/python/ragflow_sdk
 */

import { z } from "zod/v4";

import {
  type Chunk,
  type ChunkMethod,
  ChunkSchema,
  type Dataset,
  DatasetSchema,
  type Document,
  DocumentSchema,
  type KnowledgeGraph,
  KnowledgeGraphSchema,
  type ParserConfig,
  type RetrievalChunk,
  RetrievalChunkSchema,
} from "./schemas";

// ── Configuration ────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return process.env.RAGFLOW_API_URL ?? "http://localhost:9380";
}

function getApiKey(): string | undefined {
  return process.env.RAGFLOW_API_KEY;
}

const DEFAULT_TIMEOUT_MS = 15_000;

// ── Internal Helpers ─────────────────────────────────────────────────────────

class RagflowApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number,
    message: string,
  ) {
    super(`[ragflow] API error ${status} (code ${code}): ${message}`);
    this.name = "RagflowApiError";
  }
}

function headers(): Record<string, string> {
  const key = getApiKey();
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

/**
 * Make a validated API request to RAGFlow.
 * Parses the response with Zod — throws RagflowApiError on API-level errors,
 * throws ZodError on unexpected response shapes.
 */
async function request<T>(
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`;

  const res = await fetch(url, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new RagflowApiError(res.status, -1, `HTTP ${res.status}: ${text}`);
  }

  const json: unknown = await res.json();

  // RAGFlow wraps all responses in { code, data, message }
  const envelope = z
    .object({
      code: z.number(),
      data: z.unknown(),
      message: z.string().optional().default(""),
    })
    .parse(json);

  if (envelope.code !== 0) {
    throw new RagflowApiError(
      res.status,
      envelope.code,
      envelope.message || "Unknown error",
    );
  }

  // Parse the data field with the caller's schema
  return schema.parse(envelope.data);
}

/**
 * Upload files via multipart/form-data (no JSON body).
 */
async function uploadRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  formData: FormData,
  timeoutMs = 60_000,
): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`;
  const key = getApiKey();

  const res = await fetch(url, {
    method: "POST",
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new RagflowApiError(res.status, -1, `HTTP ${res.status}: ${text}`);
  }

  const json: unknown = await res.json();
  const envelope = z
    .object({
      code: z.number(),
      data: z.unknown(),
      message: z.string().optional().default(""),
    })
    .parse(json);

  if (envelope.code !== 0) {
    throw new RagflowApiError(
      res.status,
      envelope.code,
      envelope.message || "Upload failed",
    );
  }

  return schema.parse(envelope.data);
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Check if RAGFlow is configured (API key is set). */
export function isConfigured(): boolean {
  return !!getApiKey();
}

// ── Datasets ─────────────────────────────────────────────────────────────────

/** List all datasets. */
export async function listDatasets(
  page = 1,
  pageSize = 30,
): Promise<Dataset[]> {
  return request(
    "GET",
    `/datasets?page=${page}&page_size=${pageSize}`,
    z.array(DatasetSchema),
  );
}

/** Create a new dataset. */
export async function createDataset(params: {
  name: string;
  chunk_method?: ChunkMethod;
  embedding_model?: string;
  parser_config?: Partial<ParserConfig>;
  language?: string;
  description?: string;
}): Promise<Dataset> {
  return request("POST", "/datasets", DatasetSchema, params);
}

/** Update a dataset. */
export async function updateDataset(
  datasetId: string,
  params: Partial<
    Pick<Dataset, "name" | "description" | "embedding_model" | "chunk_method">
  >,
): Promise<Dataset> {
  return request("PUT", `/datasets/${datasetId}`, DatasetSchema, params);
}

/** Delete datasets by ID. */
export async function deleteDatasets(ids: string[]): Promise<void> {
  await request("DELETE", "/datasets", z.unknown(), { ids });
}

// ── Documents ────────────────────────────────────────────────────────────────

/** List documents in a dataset. */
export async function listDocuments(
  datasetId: string,
  params?: {
    page?: number;
    page_size?: number;
    keywords?: string;
    name?: string;
  },
): Promise<Document[]> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  if (params?.keywords) qs.set("keywords", params.keywords);
  if (params?.name) qs.set("name", params.name);
  const query = qs.toString() ? `?${qs.toString()}` : "";

  return request(
    "GET",
    `/datasets/${datasetId}/documents${query}`,
    z.array(DocumentSchema),
  );
}

/** Upload documents to a dataset (multipart file upload). */
export async function uploadDocuments(
  datasetId: string,
  files: Array<{ name: string; blob: Blob }>,
): Promise<Document[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("file", file.blob, file.name);
  }

  return uploadRequest(
    `/datasets/${datasetId}/documents`,
    z.array(DocumentSchema),
    formData,
  );
}

/** Update a document's metadata or parser config. */
export async function updateDocument(
  datasetId: string,
  documentId: string,
  params: Partial<
    Pick<Document, "name" | "chunk_method" | "parser_config" | "meta_fields">
  >,
): Promise<Document> {
  return request(
    "PUT",
    `/datasets/${datasetId}/documents/${documentId}`,
    DocumentSchema,
    params,
  );
}

/** Delete documents from a dataset. */
export async function deleteDocuments(
  datasetId: string,
  ids: string[],
): Promise<void> {
  await request("DELETE", `/datasets/${datasetId}/documents`, z.unknown(), {
    ids,
  });
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Trigger parsing of documents (chunking + embedding). */
export async function parseDocuments(
  datasetId: string,
  documentIds: string[],
): Promise<void> {
  await request("POST", `/datasets/${datasetId}/chunks`, z.unknown(), {
    document_ids: documentIds,
  });
}

/** Stop parsing of documents. */
export async function stopParsing(
  datasetId: string,
  documentIds: string[],
): Promise<void> {
  await request("DELETE", `/datasets/${datasetId}/chunks`, z.unknown(), {
    document_ids: documentIds,
  });
}

// ── Chunks ───────────────────────────────────────────────────────────────────

/** List chunks for a document. */
export async function listChunks(
  datasetId: string,
  documentId: string,
  params?: { page?: number; page_size?: number; keywords?: string },
): Promise<Chunk[]> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.page_size) qs.set("page_size", String(params.page_size));
  if (params?.keywords) qs.set("keywords", params.keywords);
  const query = qs.toString() ? `?${qs.toString()}` : "";

  return request(
    "GET",
    `/datasets/${datasetId}/documents/${documentId}/chunks${query}`,
    z.array(ChunkSchema),
  );
}

/** Add a chunk manually. */
export async function addChunk(
  datasetId: string,
  documentId: string,
  content: string,
  keywords?: string[],
): Promise<Chunk> {
  return request(
    "POST",
    `/datasets/${datasetId}/documents/${documentId}/chunks`,
    ChunkSchema,
    { content, important_keywords: keywords },
  );
}

/** Update a chunk's content. */
export async function updateChunk(
  datasetId: string,
  documentId: string,
  chunkId: string,
  params: {
    content?: string;
    important_keywords?: string[];
    available?: boolean;
  },
): Promise<Chunk> {
  return request(
    "PUT",
    `/datasets/${datasetId}/documents/${documentId}/chunks/${chunkId}`,
    ChunkSchema,
    params,
  );
}

/** Delete chunks. */
export async function deleteChunks(
  datasetId: string,
  documentId: string,
  chunkIds: string[],
): Promise<void> {
  await request(
    "DELETE",
    `/datasets/${datasetId}/documents/${documentId}/chunks`,
    z.unknown(),
    { chunk_ids: chunkIds },
  );
}

// ── Retrieval ────────────────────────────────────────────────────────────────

/**
 * Search across datasets using hybrid retrieval (BM25 + vector).
 * This is the main RAG search endpoint used by the chat pipeline.
 */
export async function retrieve(params: {
  question: string;
  dataset_ids?: string[];
  top_k?: number;
  similarity_threshold?: number;
  vector_similarity_weight?: number;
  use_kg?: boolean;
}): Promise<RetrievalChunk[]> {
  const body = {
    question: params.question,
    dataset_ids: params.dataset_ids,
    top_k: params.top_k ?? 6,
    similarity_threshold: params.similarity_threshold ?? 0.2,
    vector_similarity_weight: params.vector_similarity_weight ?? 0.3,
    use_kg: params.use_kg ?? false,
  };

  // The retrieval endpoint wraps chunks in { chunks: [...] }
  const result = await request(
    "POST",
    "/retrieval",
    z.object({ chunks: z.array(RetrievalChunkSchema) }),
    body,
  );

  return result.chunks;
}

// ── Knowledge Graph ──────────────────────────────────────────────────────────

/** Get the knowledge graph for a dataset. */
export async function getKnowledgeGraph(
  datasetId: string,
): Promise<KnowledgeGraph> {
  return request(
    "GET",
    `/datasets/${datasetId}/knowledge_graph`,
    KnowledgeGraphSchema,
  );
}

/** Trigger knowledge graph construction for a dataset. */
export async function buildKnowledgeGraph(datasetId: string): Promise<void> {
  await request("POST", `/datasets/${datasetId}/run_graphrag`, z.unknown());
}

/** Check knowledge graph construction status. */
export async function getKnowledgeGraphStatus(
  datasetId: string,
): Promise<{ status: string; progress: number }> {
  return request(
    "GET",
    `/datasets/${datasetId}/trace_graphrag`,
    z.object({
      status: z.string().default(""),
      progress: z.number().default(0),
    }),
  );
}

/** Delete the knowledge graph for a dataset. */
export async function deleteKnowledgeGraph(datasetId: string): Promise<void> {
  await request(
    "DELETE",
    `/datasets/${datasetId}/knowledge_graph`,
    z.unknown(),
  );
}

// ── RAPTOR ───────────────────────────────────────────────────────────────────

/** Trigger RAPTOR multi-hop summarization for a dataset. */
export async function buildRaptor(datasetId: string): Promise<void> {
  await request("POST", `/datasets/${datasetId}/run_raptor`, z.unknown());
}

/** Check RAPTOR construction status. */
export async function getRaptorStatus(
  datasetId: string,
): Promise<{ status: string; progress: number }> {
  return request(
    "GET",
    `/datasets/${datasetId}/trace_raptor`,
    z.object({
      status: z.string().default(""),
      progress: z.number().default(0),
    }),
  );
}
