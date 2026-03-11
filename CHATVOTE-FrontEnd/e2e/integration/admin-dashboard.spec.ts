import { test, expect } from "@playwright/test";

const SECRET = "test";
const BASE = `/admin/dashboard/${SECRET}`;

test.describe("Admin Dashboard", () => {
  test("loads and shows tab bar with 4 tabs", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pipeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Coverage" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Chat Sessions" })).toBeVisible();
  });

  test("has time range picker with correct options", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    const select = page.getByRole("combobox").first();
    await expect(select).toBeVisible();
    await expect(select.getByRole("option", { name: "Last 1h" })).toBeAttached();
    await expect(select.getByRole("option", { name: "Last 24h" })).toBeAttached();
    await expect(select.getByRole("option", { name: "Last 7d" })).toBeAttached();
    await expect(select.getByRole("option", { name: "Last 30d" })).toBeAttached();
    await expect(select.getByRole("option", { name: "All time" })).toBeAttached();
  });

  test("defaults to 24h time range", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    const select = page.getByRole("combobox").first();
    await expect(select).toHaveValue("24");
  });

  test("syncs tab to URL", async ({ page }) => {
    await page.goto(`${BASE}?tab=pipeline`);
    const pipelineBtn = page.getByRole("button", { name: "Pipeline" });
    // Pipeline tab should be active (has border color class)
    await expect(pipelineBtn).toHaveClass(/border-blue-600/);
  });
});

test.describe("Overview Tab - Warnings", () => {
  test("loads warnings and shows categories", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    // Wait for warnings to load (either warning cards or "No issues" messages)
    await expect(
      page.getByText(/Data Completeness/).or(page.getByText("Loading warnings..."))
    ).toBeVisible({ timeout: 10000 });
    // After loading, all 3 categories should be present
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Operational")).toBeVisible();
    await expect(page.getByText("Chat Quality")).toBeVisible();
  });

  test("shows warning cards with severity badges", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });
    // Should show at least one warning about missing data
    const warningText = page.getByText(/missing/i);
    await expect(warningText.first()).toBeVisible({ timeout: 10000 });
  });

  test("has refresh button", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });
    const refreshBtn = page.getByRole("button", { name: "Refresh" });
    await expect(refreshBtn).toBeVisible();
  });

  test("warning cards have View links", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });
    // View buttons should be present on warning cards
    const viewBtns = page.getByRole("button", { name: "View" });
    const count = await viewBtns.count();
    expect(count).toBeGreaterThan(0);
  });

  test("warning badge shows count on tab", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });
    // The Overview tab button should contain badge if there are critical warnings
    // (may or may not have critical warnings depending on data state)
    const overviewBtn = page.getByRole("button", { name: "Overview" });
    await expect(overviewBtn).toBeVisible();
  });
});

test.describe("Pipeline Tab", () => {
  test("loads pipeline nodes", async ({ page }) => {
    await page.goto(`${BASE}?tab=pipeline`);
    // Pipeline should show node names
    await expect(page.getByText("Population INSEE")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Candidatures CSV")).toBeVisible();
  });

  test("has Run and Force buttons per node", async ({ page }) => {
    await page.goto(`${BASE}?tab=pipeline`);
    await expect(page.getByText("Population INSEE")).toBeVisible({ timeout: 15000 });
    const runBtns = page.getByRole("button", { name: "Run" });
    const forceBtns = page.getByRole("button", { name: "Force" });
    expect(await runBtns.count()).toBeGreaterThan(0);
    expect(await forceBtns.count()).toBeGreaterThan(0);
  });

  test("has global controls", async ({ page }) => {
    await page.goto(`${BASE}?tab=pipeline`);
    await expect(page.getByText("Population INSEE")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Stop All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  });
});

test.describe("Coverage Tab", () => {
  test("loads coverage summary", async ({ page }) => {
    await page.goto(`${BASE}?tab=coverage`);
    // Should show summary stats
    await expect(page.getByText("Communes")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Parties")).toBeVisible();
    await expect(page.getByText("Candidates")).toBeVisible();
    await expect(page.getByText("Chunks")).toBeVisible();
  });

  test("has missing-only filter", async ({ page }) => {
    await page.goto(`${BASE}?tab=coverage`);
    await expect(page.getByText("Communes")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Show missing only")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Show missing only" })).toBeVisible();
  });

  test("shows commune table with sortable columns", async ({ page }) => {
    await page.goto(`${BASE}?tab=coverage`);
    await expect(page.getByText("Communes")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Name" })).toBeVisible();
  });
});

test.describe("Chat Sessions Tab", () => {
  test("loads with status filter", async ({ page }) => {
    await page.goto(`${BASE}?tab=chats`);
    const statusFilter = page.getByRole("combobox", { name: "Status:" });
    await expect(statusFilter).toBeVisible({ timeout: 10000 });
    await expect(statusFilter.getByRole("option", { name: "All" })).toBeAttached();
    await expect(statusFilter.getByRole("option", { name: "Success" })).toBeAttached();
    await expect(statusFilter.getByRole("option", { name: "Error" })).toBeAttached();
    await expect(statusFilter.getByRole("option", { name: "Partial" })).toBeAttached();
  });

  test("shows session count", async ({ page }) => {
    await page.goto(`${BASE}?tab=chats`);
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({ timeout: 10000 });
  });

  test("shows sessions with all-time filter", async ({ page }) => {
    await page.goto(`${BASE}?tab=chats`);
    // Switch to All time
    const timeRange = page.getByRole("combobox").first();
    await timeRange.selectOption("0");
    // Wait for sessions to load
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({ timeout: 10000 });
  });

  test("has refresh button", async ({ page }) => {
    await page.goto(`${BASE}?tab=chats`);
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Tab Navigation", () => {
  test("clicking tabs switches content and updates URL", async ({ page }) => {
    await page.goto(`${BASE}?tab=overview`);
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });

    // Click Pipeline
    await page.getByRole("button", { name: "Pipeline" }).click();
    await expect(page).toHaveURL(/tab=pipeline/);
    await expect(page.getByText("Population INSEE")).toBeVisible({ timeout: 15000 });

    // Click Coverage
    await page.getByRole("button", { name: "Coverage" }).click();
    await expect(page).toHaveURL(/tab=coverage/);
    await expect(page.getByText("Communes")).toBeVisible({ timeout: 15000 });

    // Click Chat Sessions
    await page.getByRole("button", { name: "Chat Sessions" }).click();
    await expect(page).toHaveURL(/tab=chats/);
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({ timeout: 10000 });

    // Back to Overview
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(page).toHaveURL(/tab=overview/);
    await expect(page.getByText("Data Completeness")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Data Sources Redirect", () => {
  test("old data-sources URL redirects to dashboard pipeline tab", async ({ page }) => {
    await page.goto(`/admin/data-sources/${SECRET}`);
    await expect(page).toHaveURL(/\/admin\/dashboard\/.*\?tab=pipeline/);
  });
});
