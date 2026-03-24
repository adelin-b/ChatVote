#!/usr/bin/env node
/**
 * seed-ragflow — Create datasets, upload documents, and trigger parsing in RAGFlow.
 *
 * Usage:
 *   node scripts/seed-ragflow.mjs                    # Seed from local PDFs
 *   node scripts/seed-ragflow.mjs --skip-parse       # Upload only, don't auto-parse
 *   node scripts/seed-ragflow.mjs --dry-run          # Show what would be done
 *
 * Required env vars:
 *   RAGFLOW_API_URL  — RAGFlow server URL (default: http://localhost:9380)
 *   RAGFLOW_API_KEY  — API key (RAGFlow UI → avatar → API Keys)
 *
 * What it does:
 *   1. Creates two datasets in RAGFlow (if they don't exist):
 *      - "chatvote-manifestos" (laws chunking, GraphRAG enabled)
 *      - "chatvote-candidate-websites" (naive chunking, GraphRAG enabled)
 *   2. Uploads PDFs from CHATVOTE-BackEnd/firebase/firestore_data/dev/crawled_content/
 *   3. Triggers parsing (chunking + embedding + optional KG construction)
 *
 * Architecture note:
 *   RAGFlow's OpenAPI spec has 0 component schemas (issue #9835, PR #12722 rejected).
 *   This script uses raw fetch against the REST API — the Zod-validated client
 *   at src/lib/ai/ragflow/ is for the Next.js runtime, not standalone scripts.
 *
 * @see https://ragflow.io/docs/v0.24.0/http_api_reference
 * @see https://github.com/infiniflow/ragflow/issues/9835
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { basename, join, resolve } from "path";

// ── Load .env.local if env vars aren't set ───────────────────────────────────
const envLocalPath = resolve(import.meta.dirname, "../.env.local");
if (existsSync(envLocalPath) && !process.env.RAGFLOW_API_KEY) {
  const envContent = readFileSync(envLocalPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

const RAGFLOW_URL = process.env.RAGFLOW_API_URL ?? "http://localhost:9380";
const RAGFLOW_KEY = process.env.RAGFLOW_API_KEY;
const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_PARSE = process.argv.includes("--skip-parse");

const SEED_DATA_DIR = resolve(
  import.meta.dirname,
  "../../CHATVOTE-BackEnd/firebase/firestore_data/dev/crawled_content/candidates",
);

/**
 * Political entity types for GraphRAG extraction.
 * Must match knowledge-graph/config.ts POLITICAL_ENTITY_TYPES.
 */
const POLITICAL_ENTITY_TYPES = [
  "personnalite_politique",
  "parti_politique",
  "coalition",
  "institution",
  "election",
  "localisation",
  "theme",
  "media",
  "mandat",
  "liste_electorale",
];

const DATASETS = [
  {
    name: "chatvote-manifestos",
    chunk_method: "laws",
    description: "Programmes et manifestes de tous les partis (parsing structuré loi/article)",
    parser_config: {
      chunk_token_num: 512,
      auto_keywords: 3,
      layout_recognize: "DeepDOC",
      graphrag: { use_graphrag: true, method: "light", entity_types: POLITICAL_ENTITY_TYPES },
    },
  },
  {
    name: "chatvote-candidate-websites",
    chunk_method: "naive",
    description: "Sites web des candidats (contenu web crawlé)",
    parser_config: {
      chunk_token_num: 512,
      auto_keywords: 2,
      graphrag: { use_graphrag: true, method: "light", entity_types: POLITICAL_ENTITY_TYPES },
    },
  },
];

// ── API Helpers ──────────────────────────────────────────────────────────────

function headers() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${RAGFLOW_KEY}` };
}

async function api(method, path, body) {
  const res = await fetch(`${RAGFLOW_URL}/api/v1${path}`, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`RAGFlow API ${method} ${path}: ${json.message} (code ${json.code})`);
  }
  return json.data;
}

async function uploadFile(datasetId, filePath) {
  const fileName = basename(filePath);
  const fileBuffer = readFileSync(filePath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const res = await fetch(`${RAGFLOW_URL}/api/v1/datasets/${datasetId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${RAGFLOW_KEY}` },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(`Upload ${fileName}: ${json.message}`);
  }
  return json.data;
}

// ── Find PDFs ────────────────────────────────────────────────────────────────

function findPdfs(dir, maxPerCandidate = 5) {
  const results = [];
  try {
    const candidates = readdirSync(dir).filter((d) => {
      try { return statSync(join(dir, d)).isDirectory(); } catch { return false; }
    });

    for (const cand of candidates) {
      const pdfDir = join(dir, cand, "pdfs");
      try {
        const pdfs = readdirSync(pdfDir)
          .filter((f) => f.endsWith(".pdf"))
          .slice(0, maxPerCandidate);
        for (const pdf of pdfs) {
          results.push({ candidate: cand, path: join(pdfDir, pdf), name: pdf });
        }
      } catch { /* no pdfs dir */ }
    }
  } catch (err) {
    console.warn(`[seed-ragflow] Cannot read ${dir}: ${err.message}`);
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══ RAGFlow Seed ═══");
  console.log(`  URL:       ${RAGFLOW_URL}`);
  console.log(`  API Key:   ${RAGFLOW_KEY ? RAGFLOW_KEY.slice(0, 8) + "..." : "NOT SET"}`);
  console.log(`  Seed dir:  ${SEED_DATA_DIR}`);
  console.log(`  Dry run:   ${DRY_RUN}`);
  console.log(`  Skip parse: ${SKIP_PARSE}`);
  console.log();

  if (!RAGFLOW_KEY) {
    console.error("❌ RAGFLOW_API_KEY not set.");
    console.error("   1. Open http://localhost:8680");
    console.error("   2. Login → click avatar → API Keys → Create");
    console.error("   3. Set RAGFLOW_API_KEY in .env.local or export it");
    process.exit(1);
  }

  // 1. List existing datasets
  console.log("→ Checking existing datasets...");
  const existing = await api("GET", "/datasets?page=1&page_size=100");
  const existingNames = new Set((Array.isArray(existing) ? existing : []).map((d) => d.name));
  console.log(`  Found ${existingNames.size} existing dataset(s)`);

  // 2. Create datasets
  const datasetIds = {};
  for (const preset of DATASETS) {
    if (existingNames.has(preset.name)) {
      const ds = (Array.isArray(existing) ? existing : []).find((d) => d.name === preset.name);
      datasetIds[preset.name] = ds.id;
      console.log(`  ✓ "${preset.name}" already exists (id=${ds.id})`);
    } else if (DRY_RUN) {
      console.log(`  [dry-run] Would create "${preset.name}"`);
    } else {
      console.log(`  → Creating "${preset.name}"...`);
      const ds = await api("POST", "/datasets", preset);
      datasetIds[preset.name] = ds.id;
      console.log(`  ✓ Created "${preset.name}" (id=${ds.id})`);
    }
  }
  console.log();

  // 3. Find and upload PDFs
  const pdfs = findPdfs(SEED_DATA_DIR);
  console.log(`→ Found ${pdfs.length} PDFs to upload`);

  if (pdfs.length === 0) {
    console.warn("  ⚠ No PDFs found. Run 'make seed' first to populate seed data.");
    return;
  }

  const manifestoDatasetId = datasetIds["chatvote-manifestos"];
  if (!manifestoDatasetId && !DRY_RUN) {
    console.error("❌ Manifesto dataset not found");
    process.exit(1);
  }

  const uploadedDocIds = [];
  let uploaded = 0;
  let skipped = 0;

  for (const pdf of pdfs) {
    if (DRY_RUN) {
      console.log(`  [dry-run] Would upload: ${pdf.candidate}/${pdf.name}`);
      continue;
    }

    try {
      const docs = await uploadFile(manifestoDatasetId, pdf.path);
      const docIds = (Array.isArray(docs) ? docs : [docs]).map((d) => d.id).filter(Boolean);
      uploadedDocIds.push(...docIds);
      uploaded++;
      if (uploaded % 5 === 0 || uploaded === pdfs.length) {
        console.log(`  ✓ Uploaded ${uploaded}/${pdfs.length} (${pdf.candidate}/${pdf.name})`);
      }
    } catch (err) {
      // Duplicate or already uploaded — skip
      if (err.message.includes("Duplicate") || err.message.includes("exist")) {
        skipped++;
      } else {
        console.error(`  ✗ Failed: ${pdf.candidate}/${pdf.name}: ${err.message}`);
      }
    }
  }

  console.log(`  Uploaded: ${uploaded}, Skipped: ${skipped}, Total PDFs: ${pdfs.length}`);
  console.log();

  // 4. Trigger parsing
  if (!SKIP_PARSE && uploadedDocIds.length > 0 && !DRY_RUN) {
    console.log(`→ Triggering parsing for ${uploadedDocIds.length} documents...`);
    try {
      await api("POST", `/datasets/${manifestoDatasetId}/chunks`, {
        document_ids: uploadedDocIds,
      });
      console.log("  ✓ Parsing started (check RAGFlow UI for progress)");
    } catch (err) {
      console.error(`  ✗ Parse trigger failed: ${err.message}`);
    }
  } else if (SKIP_PARSE) {
    console.log("→ Skipping parse (--skip-parse)");
  }

  console.log();
  console.log("═══ Done ═══");
  console.log(`  RAGFlow UI: ${RAGFLOW_URL.replace("9380", "8680")}`);
  console.log("  Check dataset status in the RAGFlow Dashboard → Dataset tab");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
