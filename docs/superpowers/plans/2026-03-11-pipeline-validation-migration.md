# Pipeline Validation & Migration Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the new data_pipeline end-to-end, remove superseded old scripts, and confirm chat + coverage + evals all work.

**Architecture:** Run pipeline via admin UI → validate Qdrant metadata with scripts → test chat via Socket.IO → update evals → remove old code → final regression.

**Tech Stack:** Python (aiohttp, qdrant-client, socketio), Next.js, Firebase emulators, Qdrant, Ollama

---

## Chunk 1: Environment & Pipeline Execution

### Task 1: Start Dev Environment

**Files:**
- Reference: `Makefile`

- [ ] **Step 1: Stop any existing services**

```bash
make stop 2>/dev/null || true
```

- [ ] **Step 2: Start full dev stack**

```bash
make dev
```

Expected: All services running — Frontend :3000, Backend :8080, Qdrant :6333, Firebase emulators :8081/:9099

- [ ] **Step 3: Health-check all services**

```bash
make check
```

Expected: All 4 services report healthy

---

### Task 2: Run Pipeline from Admin UI

**Files:**
- Reference: `CHATVOTE-FrontEnd/src/app/admin/data-sources/[secret]/page.tsx`
- Reference: `CHATVOTE-BackEnd/src/aiohttp_app.py` (lines 1271-1510)

- [ ] **Step 1: Get the admin secret from env**

```bash
grep ADMIN_UPLOAD_SECRET CHATVOTE-BackEnd/.env | head -1
```

- [ ] **Step 2: Enable the indexer node via API**

```bash
curl -s -X PUT http://localhost:8080/api/v1/admin/data-sources/config/indexer \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: ${SECRET}" \
  -d '{"enabled": true}' | python3 -m json.tool
```

Expected: `{"ok": true}`

- [ ] **Step 3: Trigger "Run All" via API**

```bash
curl -s -X POST http://localhost:8080/api/v1/admin/data-sources/run-all \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: ${SECRET}" \
  -d '{"force": true, "top_communes": 5}' | python3 -m json.tool
```

Use `top_communes: 5` for fast iteration. Expected: `{"ok": true}`

- [ ] **Step 4: Poll status until all nodes complete**

```bash
# Poll every 10s until no node is "running"
while true; do
  STATUS=$(curl -s http://localhost:8080/api/v1/admin/data-sources/status \
    -H "X-Admin-Secret: ${SECRET}")
  RUNNING=$(echo "$STATUS" | python3 -c "import sys,json; nodes=json.load(sys.stdin); print(sum(1 for n in nodes.values() if n.get('status')=='running'))")
  echo "Running nodes: $RUNNING"
  [ "$RUNNING" = "0" ] && break
  sleep 10
done
echo "All nodes complete"
```

- [ ] **Step 5: Check all nodes succeeded**

```bash
curl -s http://localhost:8080/api/v1/admin/data-sources/status \
  -H "X-Admin-Secret: ${SECRET}" | \
  python3 -c "
import sys, json
nodes = json.load(sys.stdin)
for nid, cfg in nodes.items():
    status = cfg.get('status', 'unknown')
    counts = cfg.get('counts', {})
    icon = '✅' if status == 'success' else '❌'
    print(f'{icon} {nid}: {status} — {counts}')
"
```

Expected: All nodes show ✅ success with non-zero counts

---

## Chunk 2: Qdrant Metadata Validation

### Task 3: Write Qdrant Validation Script

**Files:**
- Create: `CHATVOTE-BackEnd/scripts/validate_qdrant_metadata.py`

- [ ] **Step 1: Write the validation script**

```python
"""Validate Qdrant collections have correct metadata after pipeline run."""
import asyncio
import os
import sys
from qdrant_client import QdrantClient

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
ENV = os.getenv("ENV", "dev")

REQUIRED_FIELDS = {
    f"all_parties_{ENV}": [
        "namespace", "party_ids", "source_document", "document_name",
        "page", "chunk_index", "total_chunks",
    ],
    f"candidates_websites_{ENV}": [
        "namespace", "candidate_ids", "source_document",
        "candidate_name", "municipality_code",
        "page", "chunk_index", "total_chunks",
    ],
}

def validate():
    client = QdrantClient(url=QDRANT_URL)
    all_ok = True

    for collection, required in REQUIRED_FIELDS.items():
        try:
            info = client.get_collection(collection)
        except Exception as e:
            print(f"❌ Collection {collection} not found: {e}")
            all_ok = False
            continue

        count = info.points_count
        print(f"\n📦 {collection}: {count} chunks")

        if count == 0:
            print(f"  ⚠️  Empty collection!")
            all_ok = False
            continue

        # Sample up to 100 points
        points, _ = client.scroll(collection, limit=min(100, count), with_payload=True)

        missing_stats = {f: 0 for f in required}
        candidate_id_format_errors = 0

        for pt in points:
            meta = pt.payload.get("metadata", pt.payload)
            for field in required:
                if not meta.get(field):
                    missing_stats[field] += 1

            # Check candidate_id format
            if collection.startswith("candidates_websites"):
                ns = meta.get("namespace", "")
                if ns and not ns.startswith("cand-"):
                    candidate_id_format_errors += 1

        sampled = len(points)
        print(f"  Sampled: {sampled} chunks")

        for field, missing in missing_stats.items():
            pct = (sampled - missing) / sampled * 100
            icon = "✅" if missing == 0 else "⚠️"
            print(f"  {icon} {field}: {pct:.0f}% coverage ({missing} missing)")
            if missing > 0:
                all_ok = False

        if candidate_id_format_errors > 0:
            print(f"  ❌ {candidate_id_format_errors} candidate IDs don't match cand-* format")
            all_ok = False
        elif collection.startswith("candidates_websites"):
            print(f"  ✅ All candidate IDs match cand-{{commune}}-{{panel}} format")

    print(f"\n{'✅ ALL CHECKS PASSED' if all_ok else '❌ SOME CHECKS FAILED'}")
    return 0 if all_ok else 1

if __name__ == "__main__":
    sys.exit(validate())
```

- [ ] **Step 2: Run the validation script**

```bash
cd CHATVOTE-BackEnd && poetry run python scripts/validate_qdrant_metadata.py
```

Expected: All fields have 100% coverage, candidate IDs match format

- [ ] **Step 3: Commit the script**

```bash
git add CHATVOTE-BackEnd/scripts/validate_qdrant_metadata.py
git commit -m "chore: add Qdrant metadata validation script"
```

---

## Chunk 3: Chat E2E Validation

### Task 4: Write Chat Socket.IO Test Script

**Files:**
- Create: `CHATVOTE-BackEnd/scripts/validate_chat_e2e.py`

- [ ] **Step 1: Write the chat validation script**

```python
"""End-to-end chat test via Socket.IO — validates sources and streaming."""
import asyncio
import os
import sys
import socketio

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8080")

async def test_chat():
    sio = socketio.AsyncClient()
    results = {
        "connected": False,
        "session_init": False,
        "sources_ready": False,
        "got_chunks": 0,
        "response_complete": False,
        "sources": [],
        "errors": [],
    }

    @sio.event
    async def connect():
        results["connected"] = True
        print("✅ Connected to backend")

    @sio.on("chat_session_init_complete")
    async def on_init(data):
        results["session_init"] = True
        print(f"✅ Session initialized: {data.get('chat_id', 'unknown')}")

    @sio.on("sources_ready")
    async def on_sources(data):
        results["sources_ready"] = True
        sources = data if isinstance(data, list) else data.get("sources", [])
        results["sources"] = sources
        print(f"✅ Sources ready: {len(sources)} sources")

    @sio.on("party_response_chunk_ready")
    async def on_chunk(data):
        results["got_chunks"] += 1

    @sio.on("chat_response_complete")
    async def on_complete(data):
        results["response_complete"] = True
        print(f"✅ Response complete after {results['got_chunks']} chunks")

    @sio.on("error")
    async def on_error(data):
        results["errors"].append(str(data))
        print(f"❌ Error: {data}")

    try:
        await sio.connect(BACKEND_URL, transports=["websocket"])
        await asyncio.sleep(1)

        # Init session
        await sio.emit("chat_session_init", {"language": "fr"})
        await asyncio.sleep(2)

        # Send a question
        await sio.emit("chat_answer_request", {
            "question": "Quelles sont les propositions pour l'environnement ?",
            "party_ids": [],
        })

        # Wait for response (max 60s)
        for _ in range(60):
            if results["response_complete"]:
                break
            await asyncio.sleep(1)

        await sio.disconnect()
    except Exception as e:
        results["errors"].append(str(e))
        print(f"❌ Connection error: {e}")

    # Validate
    print("\n--- Validation ---")
    ok = True

    if not results["connected"]:
        print("❌ Failed to connect")
        ok = False

    if not results["response_complete"]:
        print("❌ Response never completed")
        ok = False

    if results["got_chunks"] == 0:
        print("❌ No response chunks received")
        ok = False
    else:
        print(f"✅ Got {results['got_chunks']} chunks")

    if results["sources"]:
        for src in results["sources"][:5]:
            src_meta = src if isinstance(src, dict) else {}
            has_id = bool(src_meta.get("candidate_id") or src_meta.get("party_id") or src_meta.get("namespace"))
            has_url = bool(src_meta.get("url"))
            print(f"  Source: id={'✅' if has_id else '❌'} url={'✅' if has_url else '⚠️'} — {src_meta.get('document_name', 'unnamed')}")
            if not has_id:
                ok = False
    elif results["sources_ready"]:
        print("⚠️  Sources event received but empty")

    if results["errors"]:
        print(f"❌ Errors: {results['errors']}")
        ok = False

    print(f"\n{'✅ CHAT E2E PASSED' if ok else '❌ CHAT E2E FAILED'}")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(asyncio.run(test_chat()))
```

- [ ] **Step 2: Run the chat E2E test**

```bash
cd CHATVOTE-BackEnd && poetry run python scripts/validate_chat_e2e.py
```

Expected: Connected, sources received with valid IDs, streaming completed

- [ ] **Step 3: Commit**

```bash
git add CHATVOTE-BackEnd/scripts/validate_chat_e2e.py
git commit -m "chore: add chat E2E validation script"
```

---

## Chunk 4: Coverage Page & DeepEvals

### Task 5: Verify Coverage Page

- [ ] **Step 1: Check coverage page loads**

Open `http://localhost:3000/experiment/coverage` in browser or:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/experiment/coverage
```

Expected: 200

- [ ] **Step 2: Check coverage API endpoints return data**

```bash
curl -s http://localhost:8080/api/v1/experiment/candidate-coverage | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Candidates with coverage: {len(d)}')"

curl -s http://localhost:8080/api/v1/experiment/topic-stats | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Topic stats entries: {len(d)}')"
```

Expected: Non-zero counts

---

### Task 6: Audit & Update DeepEvals

**Files:**
- Modify: `CHATVOTE-BackEnd/tests/eval/test_pipeline_integrity.py`
- Modify: `CHATVOTE-BackEnd/tests/eval/compare_pipelines.py`
- Modify: `CHATVOTE-BackEnd/tests/eval/compare_pipelines_detailed.py`

- [ ] **Step 1: Grep for old pipeline references in eval tests**

```bash
cd CHATVOTE-BackEnd
grep -rn "generate_seed_from_csv\|seed_prod_firestore\|crawl_prod" tests/eval/ scripts/
```

- [ ] **Step 2: Fix any broken imports/references found**

Update imports to use `src.services.data_pipeline.*` where applicable.

- [ ] **Step 3: Run the eval test suite**

```bash
cd CHATVOTE-BackEnd && poetry run pytest tests/eval/ -v --tb=short 2>&1 | head -80
```

Fix any failures iteratively.

- [ ] **Step 4: Run unit tests**

```bash
cd CHATVOTE-BackEnd && poetry run pytest tests/test_*.py -v --tb=short 2>&1 | head -80
```

- [ ] **Step 5: Commit any eval fixes**

```bash
git add -u && git commit -m "fix: update eval tests for new data pipeline"
```

---

## Chunk 5: Old Code Removal & Final Regression

### Task 7: Remove Superseded Scripts

**Files:**
- Delete: `CHATVOTE-BackEnd/scripts/generate_seed_from_csv.py`
- Delete: `CHATVOTE-BackEnd/scripts/seed_prod_firestore.py`
- Delete: `CHATVOTE-BackEnd/scripts/crawl_prod.py`

- [ ] **Step 1: Check for imports of these scripts anywhere**

```bash
cd CHATVOTE-BackEnd
grep -rn "generate_seed_from_csv\|seed_prod_firestore\|crawl_prod" src/ tests/ scripts/ --include="*.py" | grep -v "^Binary"
```

- [ ] **Step 2: Remove superseded scripts**

```bash
git rm scripts/generate_seed_from_csv.py scripts/seed_prod_firestore.py scripts/crawl_prod.py
```

- [ ] **Step 3: Verify tests still pass**

```bash
poetry run pytest tests/test_*.py -v --tb=short 2>&1 | tail -20
```

- [ ] **Step 4: Commit removals**

```bash
git add -u && git commit -m "chore: remove old pipeline scripts superseded by data_pipeline service"
```

---

### Task 8: Final Regression

- [ ] **Step 1: Re-run Qdrant validation**

```bash
cd CHATVOTE-BackEnd && poetry run python scripts/validate_qdrant_metadata.py
```

Expected: ✅ ALL CHECKS PASSED

- [ ] **Step 2: Re-run chat E2E**

```bash
cd CHATVOTE-BackEnd && poetry run python scripts/validate_chat_e2e.py
```

Expected: ✅ CHAT E2E PASSED

- [ ] **Step 3: Verify coverage page still works**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/experiment/coverage
```

Expected: 200

- [ ] **Step 4: Final commit with any remaining fixes**

If needed, commit remaining changes.
