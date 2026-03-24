# Pipeline Validation & Old Code Migration

## Goal

Validate the new data_pipeline end-to-end (admin UI → Firestore seed → Qdrant indexing → chat RAG), update evals, remove superseded old scripts, and confirm everything works in dev.

## Phases

### Phase 1: Start Dev Environment
- `make dev` — Qdrant, Firebase emulators, backend, frontend
- Health-check all services

### Phase 2: Run Pipeline from Admin UI
- Open `/admin/data-sources/{secret}`
- Enable all nodes including indexer
- "Run All" — verify DAG order execution completes
- Check Qdrant dashboard for populated collections

### Phase 3: Validate Qdrant Metadata
- Script: query `all_parties_dev` + `candidates_websites_dev`
- Assert every chunk has: `namespace`, `party_ids`/`candidate_ids`, `source_document`, `url`
- Verify `candidate_id` format: `cand-{commune_code}-{panel_number}`
- Print summary stats (collection sizes, metadata coverage %)

### Phase 4: Verify Coverage Page
- Load `/experiment/coverage`
- Check communes, parties, candidates render with chunk counts
- Verify data matches Qdrant actual counts

### Phase 5: Test Chat End-to-End
- Script: connect via Socket.IO, send question, collect streamed response
- Assert sources contain valid `candidate_id`/`party_id` references
- Assert source URLs are present
- Assert streaming completes without error

### Phase 6: Update DeepEvals
- Audit `tests/eval/` for old pipeline references
- Update to use new pipeline output format
- Run evals, fix failures

### Phase 7: Remove Old Pipeline Code
- Delete superseded scripts:
  - `scripts/generate_seed_from_csv.py` → replaced by `data_pipeline/seed.py`
  - `scripts/seed_prod_firestore.py` → replaced by seed node
  - `scripts/crawl_prod.py` → replaced by scraper/crawl_scraper nodes
- Update any imports referencing removed files
- Verify no breakage

### Phase 8: Final Regression
- Re-run pipeline + chat test after removals
- Confirm clean state

## Success Criteria
- All pipeline nodes complete without error
- Qdrant collections populated with correct metadata
- Chat responses include source-backed answers with valid IDs
- Coverage page renders accurate data
- All evals pass
- No references to removed scripts remain
