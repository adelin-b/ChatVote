// spec: e2e/mock/admin-dashboard.plan.md
// seed: e2e/mock/admin-dashboard.plan.md

import { test, expect } from "@playwright/test";

const SECRET = "test";
const BASE = `/admin/dashboard/${SECRET}`;

const MOCK_WARNINGS_WITH_DATA = {
  data: [
    {
      severity: "warning",
      category: "data_completeness",
      message: "5 candidates are missing a website URL",
      count: 5,
      tab_link: "coverage",
    },
    {
      severity: "critical",
      category: "data_completeness",
      message: "3 parties are missing their election manifesto",
      count: 3,
      tab_link: "coverage",
    },
  ],
  ops: [
    {
      severity: "info",
      category: "operational",
      message: "2 pipeline nodes have missing configuration",
      count: 2,
      tab_link: "pipeline",
    },
  ],
  chat: [],
  counts: { critical: 1, warning: 1, info: 1 },
};

const MOCK_WARNINGS_EMPTY = {
  data: [],
  ops: [],
  chat: [],
  counts: { critical: 0, warning: 0, info: 0 },
};

test.describe("Overview Tab - Warnings", () => {
  test("should display warning categories and cards", async ({ page }) => {
    // Mock auth check endpoint so the dashboard authorizes successfully
    await page.route("**/api/v1/admin/data-sources/status", (route) =>
      route.fulfill({ status: 200, json: { status: "ok" } }),
    );

    // Mock warnings endpoint with data containing "missing" messages
    await page.route("**/api/v1/admin/dashboard/warnings**", (route) =>
      route.fulfill({ json: MOCK_WARNINGS_WITH_DATA }),
    );

    // 1. Navigate — loading state appears then 3 warning categories load
    await page.goto(`${BASE}?tab=overview`);

    // Wait for all three warning category section headings to appear
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Operational")).toBeVisible();
    await expect(page.getByText("Chat Quality")).toBeVisible();

    // 2. Warning cards appear with severity styling — backend returns warnings about missing websites and manifestos
    const firstMissingText = page.getByText(/missing/i).first();
    await expect(firstMissingText).toBeVisible();

    // 3. Each warning card shows a count badge and message text containing "missing"
    await expect(
      page.getByText("5 candidates are missing a website URL"),
    ).toBeVisible();
    await expect(
      page.getByText("3 parties are missing their election manifesto"),
    ).toBeVisible();
    // Count badges: numeric values rendered as rounded badge spans
    await expect(page.getByText("5")).toBeVisible();
    await expect(page.getByText("3")).toBeVisible();

    // 4. Warning cards have "View" buttons that navigate to the relevant tab
    const viewButtons = page.getByRole("button", { name: "View" });
    await expect(viewButtons.first()).toBeVisible();
    const viewCount = await viewButtons.count();
    expect(viewCount).toBeGreaterThan(0);

    // Click the View button on the ops warning (tab_link: "pipeline") — last View button
    await viewButtons.last().click();
    await expect(page).toHaveURL(/tab=pipeline/);

    // Navigate back to overview to continue verifying remaining items
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 15000,
    });

    // 5. Refresh button is present and clickable
    const refreshBtn = page.getByRole("button", { name: "Refresh" });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // After clicking refresh, warnings should still be visible (re-fetched with mock)
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 10000,
    });

    // 6. Summary pills show warning counts (counts: critical:1, warning:1, info:1)
    await expect(page.getByText("1 warning")).toBeVisible();
  });

  test("shows loading state before warnings are fetched", async ({ page }) => {
    // Mock auth check
    await page.route("**/api/v1/admin/data-sources/status", (route) =>
      route.fulfill({ status: 200, json: { status: "ok" } }),
    );

    // Delay the warnings response so the loading spinner is visible
    await page.route("**/api/v1/admin/dashboard/warnings**", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.fulfill({ json: MOCK_WARNINGS_WITH_DATA });
    });

    await page.goto(`${BASE}?tab=overview`);

    // Loading spinner text should appear while request is in-flight
    await expect(page.getByText("Loading warnings...")).toBeVisible({
      timeout: 5000,
    });

    // After response arrives, warning categories should render
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 10000,
    });
  });

  test("shows summary pills for each non-zero severity count", async ({
    page,
  }) => {
    // Mock auth check
    await page.route("**/api/v1/admin/data-sources/status", (route) =>
      route.fulfill({ status: 200, json: { status: "ok" } }),
    );

    // Mock warnings with counts: critical:1, warning:1, info:1
    await page.route("**/api/v1/admin/dashboard/warnings**", (route) =>
      route.fulfill({ json: MOCK_WARNINGS_WITH_DATA }),
    );

    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 15000,
    });

    // Summary pills for each severity
    await expect(page.getByText("1 critical")).toBeVisible();
    await expect(page.getByText("1 warning")).toBeVisible();
    await expect(page.getByText("1 info")).toBeVisible();
  });

  test("shows healthy state message when no warnings exist", async ({
    page,
  }) => {
    // Mock auth check
    await page.route("**/api/v1/admin/data-sources/status", (route) =>
      route.fulfill({ status: 200, json: { status: "ok" } }),
    );

    // Mock warnings endpoint returning empty arrays
    await page.route("**/api/v1/admin/dashboard/warnings**", (route) =>
      route.fulfill({ json: MOCK_WARNINGS_EMPTY }),
    );

    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 15000,
    });

    // Each section should display "No issues detected." for empty arrays
    const noIssuesTexts = page.getByText("No issues detected.");
    const noIssuesCount = await noIssuesTexts.count();
    expect(noIssuesCount).toBeGreaterThan(0);

    // No severity pills — instead shows the all-healthy message
    await expect(
      page.getByText("No warnings — all systems healthy"),
    ).toBeVisible();
  });

  test("when backend returns errors, shows error state with Retry button", async ({
    page,
  }) => {
    // Mock auth check
    await page.route("**/api/v1/admin/data-sources/status", (route) =>
      route.fulfill({ status: 200, json: { status: "ok" } }),
    );

    // Mock warnings endpoint returning a 500 error
    await page.route("**/api/v1/admin/dashboard/warnings**", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" }),
    );

    await page.goto(`${BASE}?tab=overview`);

    // Error message text should appear (component shows "Status 500")
    await expect(page.getByText(/Status 500/)).toBeVisible({
      timeout: 15000,
    });

    // Retry button should be present inside the red error box
    const retryBtn = page.getByRole("button", { name: "Retry" });
    await expect(retryBtn).toBeVisible();

    // Clicking Retry triggers a new request — now returns success
    await page.route("**/api/v1/admin/dashboard/warnings**", (route) =>
      route.fulfill({ json: MOCK_WARNINGS_WITH_DATA }),
    );
    await retryBtn.click();

    // After successful retry, warning categories should render
    await expect(page.getByText("Data Completeness")).toBeVisible({
      timeout: 10000,
    });
  });
});
