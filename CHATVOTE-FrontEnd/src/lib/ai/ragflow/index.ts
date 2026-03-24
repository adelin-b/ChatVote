/**
 * RAGFlow API Client — Zod-validated, fully typed.
 *
 * @example
 *   import { ragflow } from "@lib/ai/ragflow";
 *   const datasets = await ragflow.listDatasets();
 *   const chunks = await ragflow.retrieve({ question: "transport policy" });
 */

export * as ragflow from "./client";
export * from "./schemas";
