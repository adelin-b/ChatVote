# Unified Admin Dashboard

## Goal

Consolidate the data-sources pipeline control panel, coverage report, chat session debugging, and data quality warnings into a single tabbed admin dashboard at `/admin/dashboard/[secret]`.

## Tabs

### Tab 1: Overview & Warnings
Health dashboard with three alert categories, each with severity tiers (critical/warning/info):

**Data Completeness**: candidates missing websites, parties missing manifestos, communes with zero chunks, chunks missing critical metadata (theme, municipality_code, namespace).

**Operational**: pipeline nodes in error or not run in >24h (per-node expected freshness), scraper failure rate, Qdrant collection anomalies.

**Chat Quality**: questions returning zero sources, high error rate per party/commune (>10%), slow responses (>30s).

Each warning: severity icon, count, description, link to relevant tab. Dismissable to reduce noise.

### Tab 2: Pipeline
Existing data-sources DAG control panel moved into a tab. No functional changes — same node controls, live progress, settings, polling.

### Tab 3: Coverage
Existing coverage tables moved into a tab, now auth-protected. Adds per-candidate chunk count column, color-coded cells (red=0, yellow=<5, green=5+), "missing only" filter. Public read-only version kept at `/experiment/coverage`.

### Tab 4: Chat Sessions
Paginated table: timestamp, session ID, municipality, question count, source count, status (success/error/partial), response time, model used. Filters: status, municipality, time range. Expandable detail panel showing: all messages, sources per response, error stack traces, token usage, raw socket events timeline. Polls every 10s for new sessions.

## Backend Changes

### New Endpoints (require X-Admin-Secret)
- `GET /api/v1/admin/chat-sessions` — paginated list with filters (limit, offset, status, municipality_code, since, sort_by, order)
- `GET /api/v1/admin/chat-sessions/{session_id}` — full session detail with messages, sources, errors, timing
- `GET /api/v1/admin/dashboard/warnings` — aggregated warnings across data/ops/chat quality

### Chat Metadata Persistence
Extend `save_chat_session` in websocket_app.py to persist: error_messages, response_time_ms, source_count, model_used, total_tokens, status (success/error/partial). Data already available in handlers, just not stored.

## Frontend Architecture

```
src/app/admin/dashboard/[secret]/
├── page.tsx                    # Shell: tab router, secret validation, time range picker
├── components/
│   ├── overview-tab.tsx        # Warnings dashboard
│   ├── pipeline-tab.tsx        # Extracted from data-sources page
│   ├── coverage-tab.tsx        # Extracted from coverage page
│   ├── chat-sessions-tab.tsx   # Session list with pagination
│   ├── chat-detail-panel.tsx   # Expanded session debug view
│   ├── time-range-picker.tsx   # Shared global filter
│   └── warning-card.tsx        # Reusable warning card
```

## Route Changes
- `/admin/data-sources/[secret]` → redirect to `/admin/dashboard/[secret]?tab=pipeline`
- `/experiment/coverage` → kept as public read-only (unchanged)
- Tab state synced to URL: `?tab=overview|pipeline|coverage|chats`

## Global UI
- Time range picker in top bar (24h/7d/30d/all) — affects warnings + chat tabs
- Warning badge count on Overview tab
- Responsive layout (desktop primary, tablet acceptable)
