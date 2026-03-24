# Admin Dashboard E2E Test Plan

## Application Overview

The Admin Dashboard is a protected single-page application located at /admin/dashboard/[secret]. It requires a valid secret validated against the backend via X-Admin-Secret header. The dashboard has four lazy-loaded tabs: Overview, Pipeline, Coverage, and Chat Sessions. A global time range picker (1h/24h/7d/30d/All time) is always visible in the header. The active tab is synced to the URL via the ?tab= query parameter. An older route /admin/data-sources/[secret] performs a server-side redirect to /admin/dashboard/[secret]?tab=pipeline. The base URL is http://localhost:3000 and the test secret is "test".

## Test Scenarios

### 1. Authentication and Access Control

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 1.1. Loading state appears before auth check resolves

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: The page briefly shows a 'Loading...' text centered on a gray background while the auth check is in flight

2. Wait for the auth check to complete


    - expect: The loading state disappears and the dashboard header with 'Admin Dashboard' title is rendered

#### 1.2. Invalid secret shows Unauthorized message

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/invalid-secret-xyz


    - expect: The page shows 'Unauthorized' in red text centered on a gray background
    - expect: No tab bar or dashboard content is rendered

#### 1.3. Valid secret renders the full dashboard

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: The page header displays 'Admin Dashboard'
    - expect: The time range picker select element is visible in the header
    - expect: The tab bar is visible with four buttons: Overview, Pipeline, Coverage, Chat Sessions
    - expect: The Overview tab is active by default with a blue bottom border

### 2. Tab Navigation and URL Sync

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 2.1. Default tab is Overview when no ?tab= param is present

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test (no ?tab= param)


    - expect: The Overview tab button has a blue bottom border indicating it is active
    - expect: Overview tab content is rendered with the three warning category sections

#### 2.2. Clicking Pipeline tab updates URL to ?tab=pipeline

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: Dashboard loads with Overview active

2. Click the 'Pipeline' tab button


    - expect: The URL changes to /admin/dashboard/test?tab=pipeline
    - expect: The Pipeline tab button becomes active with blue border
    - expect: Pipeline tab content is rendered

#### 2.3. Clicking Coverage tab updates URL to ?tab=coverage

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: Dashboard loads

2. Click the 'Coverage' tab button


    - expect: The URL changes to /admin/dashboard/test?tab=coverage
    - expect: The Coverage tab becomes active
    - expect: Coverage tab content is rendered

#### 2.4. Clicking Chat Sessions tab updates URL to ?tab=chats

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: Dashboard loads

2. Click the 'Chat Sessions' tab button


    - expect: The URL changes to /admin/dashboard/test?tab=chats
    - expect: The Chat Sessions tab becomes active
    - expect: Chat Sessions tab content with status filter is rendered

#### 2.5. Direct URL navigation to ?tab=pipeline loads Pipeline tab

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate directly to http://localhost:3000/admin/dashboard/test?tab=pipeline


    - expect: The Pipeline tab is active on initial render without any click
    - expect: Pipeline tab content loads

#### 2.6. Direct URL navigation to ?tab=coverage loads Coverage tab

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate directly to http://localhost:3000/admin/dashboard/test?tab=coverage


    - expect: The Coverage tab is active on initial render
    - expect: Coverage tab content loads immediately

#### 2.7. Direct URL navigation to ?tab=chats loads Chat Sessions tab

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate directly to http://localhost:3000/admin/dashboard/test?tab=chats


    - expect: The Chat Sessions tab is active on initial render
    - expect: Chat Sessions tab content loads immediately

#### 2.8. Unknown ?tab= value falls back to Overview

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=notavalidtab


    - expect: The Overview tab is active (fallback for unrecognized values)
    - expect: Overview tab content is rendered

#### 2.9. Tab bar contains exactly four tabs in correct order

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: The tab bar contains buttons in this exact order: 'Overview', 'Pipeline', 'Coverage', 'Chat Sessions'

### 3. Time Range Picker

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 3.1. Time range picker has all five options with 24h as default

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: The header contains a select element with options: 'Last 1h', 'Last 24h', 'Last 7d', 'Last 30d', 'All time'
    - expect: The default selected value is 'Last 24h'

#### 3.2. Changing time range to 1h triggers re-fetch of warnings with hours=1

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings to load


    - expect: Overview tab shows warnings fetched with hours=24

2. Change the time range select to 'Last 1h'


    - expect: A new network request is made to /api/v1/admin/dashboard/warnings?hours=1
    - expect: The warnings content refreshes

#### 3.3. Selecting All time uses hours=8760 in the warnings request

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test


    - expect: Overview tab loads

2. Change the time range select to 'All time'


    - expect: A network request is made to /api/v1/admin/dashboard/warnings?hours=8760 (the code maps timeRange=0 to hours=8760)
    - expect: Warnings content refreshes

#### 3.4. Changing time range while on Chat Sessions tab re-fetches sessions with a since parameter

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Sessions are listed

2. Change the time range select to 'Last 7d'


    - expect: A new request is made to /api/v1/admin/chat-sessions with a 'since' query parameter set to 7 days ago in ISO format
    - expect: The session list resets and reloads

### 4. Overview Tab - Warnings

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 4.1. Overview tab shows loading spinner while fetching warnings

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test while the warnings request is slow


    - expect: A spinning Loader2 icon and the text 'Loading warnings...' are displayed in the tab content area while the request is in-flight

#### 4.2. Three warning category sections are always rendered

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings to load


    - expect: Section headings are present: 'DATA COMPLETENESS', 'OPERATIONAL', 'CHAT QUALITY'
    - expect: Each section heading has a horizontal divider line

#### 4.3. Empty sections display 'No issues detected' italic message

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings to load


    - expect: Any section whose warning array is empty shows the italic text 'No issues detected.'

#### 4.4. Warning cards render correct severity styling

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings to load


    - expect: Critical warnings: red background (bg-red-50), red border, AlertCircle icon in red
    - expect: Warning-severity items: yellow background (bg-yellow-50), yellow border, AlertTriangle icon in yellow
    - expect: Info items: blue background (bg-blue-50), blue border, Info icon in blue

#### 4.5. Warning cards display a count badge when count is greater than zero

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings that have count > 0 to load


    - expect: Each such warning card shows a colored rounded badge with the numeric count
    - expect: The badge color matches the severity: red for critical, yellow for warning, blue for info

#### 4.6. Warning cards have a View button that navigates to the referenced tab

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings to load


    - expect: Each warning card has an underlined 'View' button at the right edge

2. Click the 'View' button on a warning whose tab_link is 'pipeline'


    - expect: The URL updates to include ?tab=pipeline
    - expect: The Pipeline tab becomes active and its content is visible

3. Navigate back to the Overview tab


    - expect: Overview content re-renders

4. Click the 'View' button on a warning whose tab_link is 'coverage'


    - expect: The URL updates to include ?tab=coverage
    - expect: The Coverage tab becomes active

#### 4.7. Summary pills appear for each non-zero severity count

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings with at least one critical and one warning-severity item


    - expect: A red pill 'N critical' is shown
    - expect: A yellow pill 'N warning' is shown

2. Navigate to http://localhost:3000/admin/dashboard/test when all warning arrays are empty


    - expect: The text 'No warnings — all systems healthy' is shown instead of any pills

#### 4.8. Critical count badge appears on the Overview tab button

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test when the API returns critical warnings


    - expect: The 'Overview' tab button shows a red rounded badge containing the critical warning count after the 'Overview' label

#### 4.9. No badge on Overview tab button when critical count is zero

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test when the API returns zero critical warnings


    - expect: The Overview tab button shows only the text 'Overview' with no numeric badge

#### 4.10. Refresh button re-fetches warnings

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test and wait for warnings to load


    - expect: A 'Refresh' button with a RefreshCw icon is visible at the top right of the warnings area

2. Click the 'Refresh' button


    - expect: A new request is made to /api/v1/admin/dashboard/warnings
    - expect: Warnings are re-rendered with fresh data

#### 4.11. API error state shows red box with Retry button

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test while the warnings endpoint returns a 500 error


    - expect: A red bordered error box is shown with the error message (e.g., 'Status 500')
    - expect: A 'Retry' button is present inside the error box

2. Click the 'Retry' button


    - expect: A new request is made to the warnings endpoint

### 5. Pipeline Tab

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 5.1. Pipeline tab renders all nine pipeline node cards

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for content to load


    - expect: Node cards are present for: population, candidatures, websites, pourquituvotes, seed, professions, scraper, crawl_scraper, indexer
    - expect: Each card shows the node label

#### 5.2. Each node card has a status indicator dot

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for nodes to load


    - expect: Idle nodes show a gray dot
    - expect: Running nodes show an amber pulsing dot
    - expect: Success nodes show a green dot
    - expect: Error nodes show a red dot

#### 5.3. Each node card has Run and Force buttons

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for nodes to load


    - expect: Each non-running node has a 'Run' button (Play icon) and a 'Force' button (RotateCcw icon) that are enabled

#### 5.4. Run and Force buttons are disabled when node is running

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and locate a node with status 'running'


    - expect: The Run button and Force button for that node are disabled
    - expect: A Stop button (Square icon) is shown for the running node

#### 5.5. Each node card has an enable/disable toggle switch

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for nodes to load


    - expect: Each node card contains a toggle switch element with role='switch'
    - expect: Enabled nodes have the toggle in the 'on' position (green background, aria-checked=true)
    - expect: Disabled nodes have the toggle in the 'off' position (gray background, aria-checked=false)

#### 5.6. Global controls section contains Stop All, Bust Cache, Clear All Data and Refresh buttons

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for content to load


    - expect: A 'Stop All' button is visible in the global controls area
    - expect: A 'Bust Cache' button is visible
    - expect: A 'Clear All Data' button is visible
    - expect: A 'Refresh' button is visible

#### 5.7. Node last run timestamp shows 'Never' if node has not been run

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and examine a node that has never been run (last_run_at is null)


    - expect: The node displays 'Never' for the last run timestamp
    - expect: The duration shows '--'

#### 5.8. Node last run timestamp shows formatted date if node has been run

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and examine a node that has been run at least once


    - expect: The node shows a date/time in DD/MM HH:MM:SS format
    - expect: A duration is shown (e.g., '5.2s' for short runs or '2m 30s' for longer ones)

#### 5.9. Scraper node settings panel shows scraper_backend dropdown

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for nodes to load


    - expect: The scraper node card has a settings expansion button

2. Click the settings expansion button on the scraper node


    - expect: A settings panel expands showing a 'scraper_backend' field
    - expect: The field is a dropdown with options: playwright, playwright-fast, firecrawl

#### 5.10. Pipeline tab auto-polls every 5 seconds

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=pipeline and wait for initial load


    - expect: After approximately 5 seconds, a new automatic request is made to the pipeline status endpoint without any user interaction

### 6. Coverage Tab

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 6.1. Coverage tab displays eight summary stat cards

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Eight stat cards are displayed in a grid with labels: Communes, Parties, Candidates, Lists, Questions, Chunks, Scraped, Indexed
    - expect: Each card shows a large numeric value

#### 6.2. Coverage tab renders three tables with correct section headings

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: A Communes table is shown with header 'Communes (N)'
    - expect: A Parties table is shown under a 'PARTIES — KNOWLEDGE BASE COVERAGE' section heading
    - expect: A Candidates table is shown under a 'CANDIDATES — DATA AVAILABILITY' section heading

#### 6.3. Communes table default sort is by question count descending

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Without any user interaction, the Communes table rows are ordered with the highest question_count at the top

#### 6.4. Communes table can be sorted by Name

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Sort buttons Name, Pop., Lists, Questions are visible in the Communes table header

2. Click the 'Name' sort button


    - expect: Rows are sorted alphabetically ascending by commune name

3. Click the 'Name' sort button again


    - expect: Sort direction reverses to descending

#### 6.5. Communes table can be sorted by Population and Lists

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Communes table is visible

2. Click the 'Pop.' sort button


    - expect: Rows are sorted by population descending

3. Click the 'Lists' sort button


    - expect: Rows are sorted by list_count descending

#### 6.6. Parties table default sort is by chunk count descending

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Parties table rows are ordered with the highest chunk_count at the top by default

#### 6.7. Parties table manifesto column shows check/cross icons

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Parties with has_manifesto=true show a green check icon in the Manifesto column
    - expect: Parties with has_manifesto=false show a gray X icon

#### 6.8. Candidates table Website and Scraped columns show check/cross icons

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Candidates with has_website=true show a green check in the Website column
    - expect: Candidates with has_scraped=true show a green check in the Scraped column
    - expect: Missing values show a gray X icon

#### 6.9. Chunk count badges use red/yellow/green color coding

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: Rows with chunk_count=0 show a red badge (bg-red-100 text-red-700)
    - expect: Rows with 1-4 chunks show a yellow badge (bg-yellow-100 text-yellow-700)
    - expect: Rows with 5+ chunks show a green badge (bg-green-100 text-green-700)

#### 6.10. Show missing only checkbox filters all three tables simultaneously

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: The 'Show missing only' checkbox is unchecked by default
    - expect: All communes, parties and candidates are shown

2. Check the 'Show missing only' checkbox


    - expect: Communes table shows only communes with list_count=0
    - expect: Parties table shows only parties with chunk_count=0
    - expect: Candidates table shows only candidates where has_website=false AND has_scraped=false
    - expect: The count shown in each table header updates to the filtered total

3. Uncheck the 'Show missing only' checkbox


    - expect: All rows are visible again in all three tables

#### 6.11. Coverage Refresh button re-fetches all data

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage and wait for data to load


    - expect: A Refresh button with RefreshCw icon is visible

2. Click the Refresh button


    - expect: A new request is made to /api/coverage
    - expect: Coverage data is re-rendered

#### 6.12. Coverage API error shows error state with Retry button

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=coverage while the /api/coverage endpoint returns a non-200 response


    - expect: An error message is shown in a red bordered box
    - expect: A 'Retry' button is present

2. Click Retry


    - expect: A new request is made to /api/coverage

### 7. Chat Sessions Tab

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 7.1. Chat Sessions tab loads with session table and toolbar

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for data to load


    - expect: A status filter labeled 'Status:' with a select element is shown
    - expect: A session count text ('N sessions') is shown
    - expect: A Refresh button is visible
    - expect: A table with columns: (chevron), Timestamp, Session ID, Commune, Sources, Status, Resp. time, Model is rendered

#### 7.2. Status filter has correct options and defaults to All

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats


    - expect: The Status select has options: All, Success, Error, Partial
    - expect: The default selected value is 'All'

#### 7.3. Filtering by Error status re-fetches with status=error

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Sessions are loaded with status=all

2. Change the Status dropdown to 'Error'


    - expect: A new request is made to /api/v1/admin/chat-sessions with status=error
    - expect: The session list resets and only error sessions are shown
    - expect: All visible status dots are red

#### 7.4. Filtering by Success status re-fetches with status=success

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Initial sessions loaded

2. Change the Status dropdown to 'Success'


    - expect: A new request is made to /api/v1/admin/chat-sessions with status=success
    - expect: All visible status dots are green

#### 7.5. Filtering by Partial status re-fetches with status=partial

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Initial sessions loaded

2. Change the Status dropdown to 'Partial'


    - expect: A new request is made to /api/v1/admin/chat-sessions with status=partial
    - expect: All visible status dots are yellow

#### 7.6. Session rows show all expected columns

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Each row shows a ChevronRight expand icon
    - expect: Timestamp in DD/MM HH:MM:SS format
    - expect: Truncated session ID (first 12 chars + ellipsis) in monospace font
    - expect: Commune name or em-dash if absent
    - expect: Source count or em-dash
    - expect: Status dot (green/red/yellow/gray) plus status text
    - expect: Response time or em-dash
    - expect: Model name in monospace or em-dash

#### 7.7. Clicking a session row expands the detail panel

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Session rows are listed with ChevronRight icons

2. Click on any session row


    - expect: The row's chevron icon changes to ChevronDown
    - expect: A 'Session Detail' panel appears inline below the row spanning all columns
    - expect: The panel header shows the full session ID and a close X button
    - expect: A loading spinner is shown while fetching detail data

#### 7.8. Session detail panel displays metadata and debug info badges

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Click a session row and wait for detail data to load


    - expect: Created and Updated timestamps are shown
    - expect: A blue pill shows the model used
    - expect: A colored pill shows the status (green for success, red for error, yellow for partial)
    - expect: Gray pills show response time, source count, and token count (if > 0)

#### 7.9. Session detail panel shows error messages when present

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Click a session row that has error_messages in its debug data and wait for detail to load


    - expect: A red bordered box labeled 'Errors:' is shown
    - expect: Each error message is displayed as a preformatted text block

#### 7.10. Session detail panel shows messages with role labels

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Click a session row and wait for detail data to load


    - expect: A 'MESSAGES (N)' heading is shown
    - expect: User messages have blue background (bg-blue-50) and 'USER' label in blue uppercase
    - expect: Assistant messages have white background and 'ASSISTANT' label in gray uppercase
    - expect: Each message shows its timestamp and content text

#### 7.11. Sources toggle on assistant messages expands and collapses source list

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Click a session row that has assistant messages with sources attached and wait for detail to load


    - expect: A 'N source(s)' toggle button with ChevronRight is shown below each relevant message

2. Click the sources toggle


    - expect: The source list expands showing cards with source ID, score, and text snippet (max 3 lines)
    - expect: The toggle icon changes to ChevronDown

3. Click the toggle again


    - expect: The source list collapses

#### 7.12. Clicking the X button in the detail panel collapses it

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Click a session row to expand the detail panel


    - expect: Detail panel is open with an X close button

2. Click the X close button


    - expect: The detail panel collapses
    - expect: The session row's icon reverts to ChevronRight

#### 7.13. Only one session detail panel open at a time

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for at least two sessions to load


    - expect: Multiple session rows are listed

2. Click the first session row


    - expect: First session detail panel opens

3. Click a different second session row


    - expect: Second session detail panel opens
    - expect: The first session detail panel is now closed

#### 7.14. Clicking an already-expanded row collapses it

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Click a session row to expand it


    - expect: Detail panel is open

2. Click the same row again


    - expect: The detail panel collapses and the row returns to ChevronRight state

#### 7.15. Refresh button resets and reloads the session list

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for sessions to load


    - expect: Sessions loaded, Refresh button visible

2. Click the Refresh button


    - expect: A new request is made to /api/v1/admin/chat-sessions with offset=0
    - expect: The list is refreshed from the beginning

#### 7.16. Load more button appears and appends more sessions

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats when there are more than 50 sessions available


    - expect: A 'Load more' button appears at the bottom of the session table

2. Click the 'Load more' button


    - expect: A new request is sent to /api/v1/admin/chat-sessions with offset=50
    - expect: Additional rows are appended after the existing ones
    - expect: Session count in the toolbar increases

#### 7.17. Empty state shown when no sessions match filter

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Apply a status filter that returns zero sessions from the API


    - expect: The table is replaced by a white box with the centered message 'No chat sessions found.'
    - expect: The toolbar shows '0 sessions'

#### 7.18. Chat Sessions tab auto-polls every 10 seconds

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/dashboard/test?tab=chats and wait for initial load


    - expect: After approximately 10 seconds, a new automatic request is made to /api/v1/admin/chat-sessions without user interaction

### 8. Data Sources Redirect

**Seed:** `CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md`

#### 8.1. Old /admin/data-sources/test route redirects to dashboard pipeline tab

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/data-sources/test


    - expect: The browser is redirected server-side to /admin/dashboard/test?tab=pipeline
    - expect: The Pipeline tab is active and its content renders

#### 8.2. Old route redirect correctly preserves the secret segment

**File:** `CHATVOTE-FrontEnd/e2e/integration/admin-dashboard.spec.ts`

**Steps:**

1. Navigate to http://localhost:3000/admin/data-sources/anysecret


    - expect: The redirect target URL is /admin/dashboard/anysecret?tab=pipeline
    - expect: The secret 'anysecret' is preserved in the redirect destination URL
