# Unified Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate pipeline control, coverage report, chat debugging, and data quality warnings into a single tabbed admin dashboard at `/admin/dashboard/[secret]`.

**Architecture:** Backend-first — add chat metadata persistence and 3 new API endpoints, then build the frontend dashboard with 4 tabs extracting existing components. Each tab is an independent client component loaded lazily.

**Tech Stack:** Python (aiohttp, Firestore async), Next.js 16 (App Router, TypeScript), shadcn/ui, Tailwind CSS v4, lucide-react icons.

---

## File Structure

### Backend (modify)
- `CHATVOTE-BackEnd/src/websocket_app.py` — Add chat metadata persistence (response_time, source_count, model, errors, status)
- `CHATVOTE-BackEnd/src/aiohttp_app.py` — Add 3 new admin endpoints (chat-sessions list, chat-session detail, warnings)

### Frontend (create)
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/page.tsx` — Dashboard shell with tab router
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/overview-tab.tsx` — Warnings dashboard
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/pipeline-tab.tsx` — Extracted pipeline controls
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/coverage-tab.tsx` — Coverage tables
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/chat-sessions-tab.tsx` — Chat session list
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/chat-detail-panel.tsx` — Expanded session view
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/time-range-picker.tsx` — Shared time filter
- `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/warning-card.tsx` — Warning display card

### Frontend (modify)
- `CHATVOTE-FrontEnd/src/app/admin/data-sources/[secret]/page.tsx` — Replace with redirect to dashboard
- `CHATVOTE-FrontEnd/src/app/experiment/coverage/page.tsx` — Keep as-is (public read-only)

---

## Chunk 1: Backend — Chat Metadata Persistence

### Task 1: Persist chat debug metadata to Firestore

**Files:**
- Modify: `CHATVOTE-BackEnd/src/websocket_app.py`
- Modify: `CHATVOTE-BackEnd/src/firebase_service.py` (if needed for async write helper)

**Context:** Chat sessions are created by the frontend in Firestore `chat_sessions/{sessionId}`. The backend handles Socket.IO events and has access to response timing, source counts, model used, errors, and token counts. We need the backend to write these debug fields back to the existing Firestore documents.

- [ ] **Step 1: Add a helper to persist chat debug metadata**

In `websocket_app.py`, add near the top (after imports):

```python
async def _persist_chat_debug_metadata(
    session_id: str,
    response_time_ms: int,
    source_count: int,
    model_used: str,
    status: str,  # "success" | "error" | "partial"
    error_messages: list[str] | None = None,
    total_tokens: int = 0,
) -> None:
    """Write debug metadata to Firestore chat session document."""
    try:
        from google.cloud.firestore_v1 import AsyncClient
        doc_ref = async_db.collection("chat_sessions").document(session_id)
        await doc_ref.set({
            "debug": {
                "response_time_ms": response_time_ms,
                "source_count": source_count,
                "model_used": model_used,
                "status": status,
                "error_messages": error_messages or [],
                "total_tokens": total_tokens,
                "updated_at": firestore.SERVER_TIMESTAMP,
            }
        }, merge=True)
    except Exception as e:
        logger.warning(f"Failed to persist chat debug metadata for {session_id}: {e}")
```

- [ ] **Step 2: Instrument the chat response handler**

Find the `chat_response_complete` emission point in the handler (around `handle_chat_answer_request`). Before emitting `chat_response_complete`, capture timing and persist:

```python
import time

# At start of handler:
_start_time = time.monotonic()

# Before emitting chat_response_complete:
_elapsed_ms = int((time.monotonic() - _start_time) * 1000)

await _persist_chat_debug_metadata(
    session_id=session_id,
    response_time_ms=_elapsed_ms,
    source_count=len(all_sources),
    model_used=getattr(llm, "model_name", "unknown"),
    status="success",
    total_tokens=0,  # TODO: extract from LLM callback if available
)
```

- [ ] **Step 3: Instrument error paths**

In exception handlers within the chat flow, persist error status:

```python
except Exception as e:
    _elapsed_ms = int((time.monotonic() - _start_time) * 1000)
    await _persist_chat_debug_metadata(
        session_id=session_id,
        response_time_ms=_elapsed_ms,
        source_count=0,
        model_used="unknown",
        status="error",
        error_messages=[f"{type(e).__name__}: {str(e)}"],
    )
    # ... existing error handling
```

- [ ] **Step 4: Verify syntax and test manually**

```bash
cd CHATVOTE-BackEnd && python3 -c "import ast; ast.parse(open('src/websocket_app.py').read()); print('OK')"
```

- [ ] **Step 5: Commit**

```bash
git add src/websocket_app.py
git commit -m "feat: persist chat debug metadata to Firestore (response time, sources, errors)"
```

---

## Chunk 2: Backend — Admin API Endpoints

### Task 2: Chat sessions list endpoint

**Files:**
- Modify: `CHATVOTE-BackEnd/src/aiohttp_app.py`

- [ ] **Step 1: Add GET /api/v1/admin/chat-sessions endpoint**

Add after the existing admin data-sources endpoints:

```python
async def admin_list_chat_sessions(request: web.Request) -> web.Response:
    """List chat sessions with pagination and filters."""
    if not _check_admin_secret(request):
        raise web.HTTPUnauthorized()

    limit = min(int(request.query.get("limit", "50")), 200)
    offset = int(request.query.get("offset", "0"))
    status_filter = request.query.get("status")  # success|error|partial
    municipality = request.query.get("municipality_code")
    since = request.query.get("since")  # ISO timestamp
    sort_by = request.query.get("sort_by", "updated_at")
    order = request.query.get("order", "desc")

    query = db.collection("chat_sessions")

    if municipality:
        query = query.where("municipality_code", "==", municipality)
    if status_filter:
        query = query.where("debug.status", "==", status_filter)

    direction = firestore.Query.DESCENDING if order == "desc" else firestore.Query.ASCENDING
    query = query.order_by(sort_by, direction=direction)

    if since:
        from datetime import datetime, timezone
        since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        query = query.where("updated_at", ">=", since_dt)

    # Fetch limit+1 to determine has_more
    docs = query.offset(offset).limit(limit + 1).stream()
    sessions = []
    async for doc in docs:
        data = doc.to_dict()
        data["session_id"] = doc.id
        sessions.append(data)

    has_more = len(sessions) > limit
    sessions = sessions[:limit]

    return web.json_response({
        "sessions": sessions,
        "total": len(sessions),
        "has_more": has_more,
        "offset": offset,
        "limit": limit,
    }, default=str)
```

- [ ] **Step 2: Register the route**

```python
app.router.add_get("/api/v1/admin/chat-sessions", admin_list_chat_sessions)
```

- [ ] **Step 3: Verify syntax**

```bash
python3 -c "import ast; ast.parse(open('src/aiohttp_app.py').read()); print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add src/aiohttp_app.py
git commit -m "feat: add admin chat-sessions list endpoint with pagination and filters"
```

### Task 3: Chat session detail endpoint

**Files:**
- Modify: `CHATVOTE-BackEnd/src/aiohttp_app.py`

- [ ] **Step 1: Add GET /api/v1/admin/chat-sessions/{session_id}**

```python
async def admin_get_chat_session(request: web.Request) -> web.Response:
    """Get full chat session detail including messages."""
    if not _check_admin_secret(request):
        raise web.HTTPUnauthorized()

    session_id = request.match_info["session_id"]
    doc = await async_db.collection("chat_sessions").document(session_id).get()
    if not doc.exists:
        raise web.HTTPNotFound()

    session_data = doc.to_dict()
    session_data["session_id"] = doc.id

    # Fetch messages subcollection
    messages = []
    msgs_query = async_db.collection("chat_sessions").document(session_id) \
        .collection("messages").order_by("created_at")
    async for msg_doc in msgs_query.stream():
        msg_data = msg_doc.to_dict()
        msg_data["id"] = msg_doc.id
        messages.append(msg_data)

    session_data["messages"] = messages
    return web.json_response(session_data, default=str)
```

- [ ] **Step 2: Register the route**

```python
app.router.add_get("/api/v1/admin/chat-sessions/{session_id}", admin_get_chat_session)
```

- [ ] **Step 3: Commit**

```bash
git add src/aiohttp_app.py
git commit -m "feat: add admin chat-session detail endpoint with messages"
```

### Task 4: Dashboard warnings endpoint

**Files:**
- Modify: `CHATVOTE-BackEnd/src/aiohttp_app.py`

- [ ] **Step 1: Add GET /api/v1/admin/dashboard/warnings**

```python
async def admin_dashboard_warnings(request: web.Request) -> web.Response:
    """Aggregate warnings across data completeness, ops, and chat quality."""
    if not _check_admin_secret(request):
        raise web.HTTPUnauthorized()

    hours = int(request.query.get("hours", "24"))
    from datetime import datetime, timedelta, timezone
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    data_warnings = []
    ops_warnings = []
    chat_warnings = []

    try:
        # Data completeness
        candidates = [doc.to_dict() | {"id": doc.id} async for doc in async_db.collection("candidates").stream()]
        parties = [doc.to_dict() | {"id": doc.id} async for doc in async_db.collection("parties").stream()]

        no_website = [c for c in candidates if not c.get("has_website")]
        no_manifesto_parties = [p for p in parties if not p.get("manifesto_pdf_url")]
        no_manifesto_candidates = [c for c in candidates if not c.get("has_manifesto")]

        if no_website:
            data_warnings.append({
                "severity": "warning",
                "category": "data",
                "message": f"{len(no_website)} candidates missing websites",
                "count": len(no_website),
                "tab_link": "coverage",
            })
        if no_manifesto_parties:
            data_warnings.append({
                "severity": "warning",
                "category": "data",
                "message": f"{len(no_manifesto_parties)} parties missing manifestos",
                "count": len(no_manifesto_parties),
                "tab_link": "coverage",
            })

        # Qdrant collection checks
        try:
            for col_name in [PARTY_INDEX_NAME, CANDIDATES_INDEX_NAME]:
                info = qdrant_client.get_collection(col_name)
                if info.points_count == 0:
                    data_warnings.append({
                        "severity": "critical",
                        "category": "data",
                        "message": f"Qdrant collection {col_name} is empty",
                        "count": 0,
                        "tab_link": "pipeline",
                    })
        except Exception:
            pass

        # Ops warnings — pipeline node status
        nodes_snap = async_db.collection("pipeline_nodes")
        async for node_doc in nodes_snap.stream():
            node = node_doc.to_dict()
            if node.get("status") == "error":
                ops_warnings.append({
                    "severity": "critical",
                    "category": "ops",
                    "message": f"Pipeline node '{node_doc.id}' in error state: {node.get('last_error', 'unknown')}",
                    "count": 1,
                    "tab_link": "pipeline",
                })
            last_run = node.get("last_run_at")
            if last_run and hasattr(last_run, "timestamp"):
                age_hours = (datetime.now(timezone.utc) - last_run.replace(tzinfo=timezone.utc)).total_seconds() / 3600
                if age_hours > 48:
                    ops_warnings.append({
                        "severity": "warning",
                        "category": "ops",
                        "message": f"Pipeline node '{node_doc.id}' last ran {int(age_hours)}h ago",
                        "count": 1,
                        "tab_link": "pipeline",
                    })

        # Chat quality warnings
        error_count = 0
        zero_source_count = 0
        slow_count = 0
        total_sessions = 0

        chat_query = async_db.collection("chat_sessions") \
            .where("updated_at", ">=", since) \
            .order_by("updated_at", direction=firestore.Query.DESCENDING) \
            .limit(500)

        async for chat_doc in chat_query.stream():
            total_sessions += 1
            chat = chat_doc.to_dict()
            debug = chat.get("debug", {})
            if debug.get("status") == "error":
                error_count += 1
            if debug.get("source_count", -1) == 0:
                zero_source_count += 1
            if debug.get("response_time_ms", 0) > 30000:
                slow_count += 1

        if error_count > 0:
            chat_warnings.append({
                "severity": "critical" if error_count > total_sessions * 0.1 else "warning",
                "category": "chat",
                "message": f"{error_count} chat errors in last {hours}h",
                "count": error_count,
                "tab_link": "chats",
            })
        if zero_source_count > 0:
            chat_warnings.append({
                "severity": "warning",
                "category": "chat",
                "message": f"{zero_source_count} questions returned zero sources in last {hours}h",
                "count": zero_source_count,
                "tab_link": "chats",
            })
        if slow_count > 0:
            chat_warnings.append({
                "severity": "info",
                "category": "chat",
                "message": f"{slow_count} slow responses (>30s) in last {hours}h",
                "count": slow_count,
                "tab_link": "chats",
            })

    except Exception as e:
        logger.error(f"Error computing dashboard warnings: {e}", exc_info=True)

    counts = {
        "critical": sum(1 for w in data_warnings + ops_warnings + chat_warnings if w["severity"] == "critical"),
        "warning": sum(1 for w in data_warnings + ops_warnings + chat_warnings if w["severity"] == "warning"),
        "info": sum(1 for w in data_warnings + ops_warnings + chat_warnings if w["severity"] == "info"),
    }

    return web.json_response({
        "data": data_warnings,
        "ops": ops_warnings,
        "chat": chat_warnings,
        "counts": counts,
    })
```

- [ ] **Step 2: Register the route**

```python
app.router.add_get("/api/v1/admin/dashboard/warnings", admin_dashboard_warnings)
```

- [ ] **Step 3: Verify syntax, commit**

```bash
python3 -c "import ast; ast.parse(open('src/aiohttp_app.py').read()); print('OK')"
git add src/aiohttp_app.py
git commit -m "feat: add admin dashboard warnings endpoint"
```

---

## Chunk 3: Frontend — Dashboard Shell & Tab Router

### Task 5: Create the dashboard page shell

**Files:**
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/page.tsx`

- [ ] **Step 1: Create the dashboard shell with tab routing**

```tsx
"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, Suspense } from "react";
import dynamic from "next/dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:8080";

const TABS = ["overview", "pipeline", "coverage", "chats"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview",
  pipeline: "Pipeline",
  coverage: "Coverage",
  chats: "Chat Sessions",
};

// Lazy load tab components
const OverviewTab = dynamic(() => import("./components/overview-tab"), { ssr: false });
const PipelineTab = dynamic(() => import("./components/pipeline-tab"), { ssr: false });
const CoverageTab = dynamic(() => import("./components/coverage-tab"), { ssr: false });
const ChatSessionsTab = dynamic(() => import("./components/chat-sessions-tab"), { ssr: false });

export default function AdminDashboard() {
  const params = useParams<{ secret: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const secret = params.secret;

  const initialTab = (searchParams.get("tab") as TabId) || "overview";
  const [activeTab, setActiveTab] = useState<TabId>(TABS.includes(initialTab) ? initialTab : "overview");
  const [warningCounts, setWarningCounts] = useState({ critical: 0, warning: 0, info: 0 });
  const [timeRange, setTimeRange] = useState(24); // hours
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Validate secret on mount
  useEffect(() => {
    fetch(`${API_URL}/api/v1/admin/data-sources/status`, {
      headers: { "X-Admin-Secret": secret },
    })
      .then((r) => setAuthorized(r.ok))
      .catch(() => setAuthorized(false));
  }, [secret]);

  const switchTab = useCallback(
    (tab: TabId) => {
      setActiveTab(tab);
      router.replace(`/admin/dashboard/${secret}?tab=${tab}`, { scroll: false });
    },
    [secret, router]
  );

  if (authorized === null) return <div className="p-8 text-center">Loading...</div>;
  if (!authorized) return <div className="p-8 text-center text-red-500">Unauthorized</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Admin Dashboard</h1>
        <div className="flex items-center gap-4">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value={1}>Last 1h</option>
            <option value={24}>Last 24h</option>
            <option value={168}>Last 7d</option>
            <option value={720}>Last 30d</option>
            <option value={0}>All time</option>
          </select>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b px-6 flex gap-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => switchTab(tab)}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {TAB_LABELS[tab]}
            {tab === "overview" && warningCounts.critical > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {warningCounts.critical}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6">
        <Suspense fallback={<div className="text-center py-8">Loading...</div>}>
          {activeTab === "overview" && (
            <OverviewTab secret={secret} apiUrl={API_URL} timeRange={timeRange} onWarningCounts={setWarningCounts} />
          )}
          {activeTab === "pipeline" && <PipelineTab secret={secret} apiUrl={API_URL} />}
          {activeTab === "coverage" && <CoverageTab secret={secret} apiUrl={API_URL} />}
          {activeTab === "chats" && (
            <ChatSessionsTab secret={secret} apiUrl={API_URL} timeRange={timeRange} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/page.tsx
git commit -m "feat: create admin dashboard shell with tab router"
```

---

## Chunk 4: Frontend — Pipeline & Coverage Tabs

### Task 6: Extract pipeline tab

**Files:**
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/pipeline-tab.tsx`
- Modify: `CHATVOTE-FrontEnd/src/app/admin/data-sources/[secret]/page.tsx` (redirect)

- [ ] **Step 1: Create pipeline-tab.tsx**

This wraps the existing data-sources page content. The simplest approach: extract the body of the existing page into a component that receives `secret` and `apiUrl` as props instead of reading them from params/env.

Read the existing `data-sources/[secret]/page.tsx` carefully. Extract everything inside the component function (state, effects, handlers, JSX) into a new `PipelineTab` component. Replace `useParams()` with props. Keep all existing functionality intact.

The component signature:

```tsx
"use client";

interface PipelineTabProps {
  secret: string;
  apiUrl: string;
}

export default function PipelineTab({ secret, apiUrl }: PipelineTabProps) {
  // ... all existing data-sources page logic, replacing:
  // - useParams<{ secret: string }>() → use props.secret
  // - API_URL constant → use props.apiUrl
  // Everything else stays identical
}
```

- [ ] **Step 2: Replace data-sources page with redirect**

```tsx
import { redirect } from "next/navigation";

export default function DataSourcesRedirect({ params }: { params: { secret: string } }) {
  redirect(`/admin/dashboard/${params.secret}?tab=pipeline`);
}
```

- [ ] **Step 3: Commit**

```bash
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/components/pipeline-tab.tsx
git add CHATVOTE-FrontEnd/src/app/admin/data-sources/\[secret\]/page.tsx
git commit -m "feat: extract pipeline tab and redirect old data-sources route"
```

### Task 7: Create coverage tab

**Files:**
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/coverage-tab.tsx`

- [ ] **Step 1: Create coverage-tab.tsx**

This fetches coverage data from the backend and renders sortable tables. Since the dashboard is a client component, we fetch via the backend API rather than using Admin SDK directly.

```tsx
"use client";

import { useState, useEffect } from "react";

interface CoverageTabProps {
  secret: string;
  apiUrl: string;
}

interface CandidateRow {
  id: string;
  name: string;
  commune: string;
  has_website: boolean;
  has_manifesto: boolean;
  chunks: number;
}

interface PartyRow {
  id: string;
  name: string;
  chunk_count: number;
  has_manifesto: boolean;
}

interface CommuneRow {
  code: string;
  name: string;
  list_count: number;
  question_count: number;
}

// Fetch coverage data from backend API
// Uses /api/v1/experiment/topic-stats for chunk counts
// and /api/v1/admin/dashboard/coverage for entity data
```

The component should render three sortable tables (communes, parties, candidates) with color-coded cells for chunk counts (red=0, yellow=<5, green=5+) and a "show missing only" toggle filter.

Note: We may need a new backend endpoint `GET /api/v1/admin/dashboard/coverage` that returns the same data `coverage-data.ts` currently fetches server-side. Alternatively, fetch from the existing `/api/v1/experiment/topic-stats` endpoint plus add a candidates/parties list endpoint. Decide during implementation based on what data is available.

- [ ] **Step 2: Commit**

```bash
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/components/coverage-tab.tsx
git commit -m "feat: add coverage tab with sortable tables and color-coded chunk counts"
```

---

## Chunk 5: Frontend — Chat Sessions & Overview Tabs

### Task 8: Create chat sessions tab

**Files:**
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/chat-sessions-tab.tsx`
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/chat-detail-panel.tsx`

- [ ] **Step 1: Create chat-sessions-tab.tsx**

Paginated table fetching from `GET /api/v1/admin/chat-sessions`. Columns: timestamp, session ID (truncated), municipality, question count, source count, status (color dot), response time, model. Filters for status and municipality. Clicking a row expands the detail panel. Polls every 10s for new sessions.

- [ ] **Step 2: Create chat-detail-panel.tsx**

Expandable panel showing: all messages (question/response pairs), sources per response with IDs, error messages with stack traces, token usage, response timing. Fetches from `GET /api/v1/admin/chat-sessions/{session_id}`.

- [ ] **Step 3: Commit**

```bash
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/components/chat-sessions-tab.tsx
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/components/chat-detail-panel.tsx
git commit -m "feat: add chat sessions tab with detail panel and live polling"
```

### Task 9: Create overview/warnings tab

**Files:**
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/overview-tab.tsx`
- Create: `CHATVOTE-FrontEnd/src/app/admin/dashboard/[secret]/components/warning-card.tsx`

- [ ] **Step 1: Create warning-card.tsx**

Reusable card component displaying: severity icon (red circle=critical, yellow triangle=warning, blue info=info), count badge, message text, and a "View" link that switches to the relevant tab.

- [ ] **Step 2: Create overview-tab.tsx**

Fetches from `GET /api/v1/admin/dashboard/warnings?hours={timeRange}`. Renders three sections: Data Completeness, Operational, Chat Quality. Each section shows a list of warning cards. Summary counts at the top. Calls `onWarningCounts` prop to update the tab badge. Refreshes when timeRange changes.

- [ ] **Step 3: Commit**

```bash
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/components/overview-tab.tsx
git add CHATVOTE-FrontEnd/src/app/admin/dashboard/\[secret\]/components/warning-card.tsx
git commit -m "feat: add overview tab with warnings dashboard"
```

---

## Chunk 6: Integration & Final Polish

### Task 10: End-to-end verification

- [ ] **Step 1: Start dev environment**

```bash
make dev
```

- [ ] **Step 2: Navigate to dashboard**

Open `http://localhost:3000/admin/dashboard/{SECRET}?tab=overview`

Verify:
- All 4 tabs render without errors
- Overview shows warnings (or empty state)
- Pipeline tab works identically to old page
- Coverage tab shows tables with data
- Chat sessions tab lists sessions (may be empty if no debug metadata yet)

- [ ] **Step 3: Test old route redirect**

Navigate to `http://localhost:3000/admin/data-sources/{SECRET}` — should redirect to dashboard pipeline tab.

- [ ] **Step 4: Test public coverage still works**

Navigate to `http://localhost:3000/experiment/coverage` — should still work without auth.

- [ ] **Step 5: Send a test chat and verify debug metadata**

Use the chat E2E validation script:
```bash
cd CHATVOTE-BackEnd && poetry run python scripts/validate_chat_e2e.py
```

Then check the chat sessions tab — should show the new session with debug metadata.

- [ ] **Step 6: Commit any remaining fixes**

```bash
git add -u
git commit -m "fix: dashboard integration fixes"
```
