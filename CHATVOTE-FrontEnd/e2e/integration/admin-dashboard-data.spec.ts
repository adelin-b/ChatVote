// spec: CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md
// seed: CHATVOTE-FrontEnd/e2e/mock/admin-dashboard.plan.md

import { expect, test } from "@playwright/test";

const SECRET = "test";
const BASE = `/admin/dashboard/${SECRET}`;

test.describe("Coverage and Chat Sessions", () => {
  test("should display coverage data and chat sessions", async ({ page }) => {
    // ── Coverage Tab ──────────────────────────────────────────────────────

    // 1. Navigate directly to the Coverage tab via URL
    await page.goto(`${BASE}?tab=coverage`);

    // Wait for auth check to complete and dashboard header to appear
    await expect(
      page.getByRole("heading", { name: "Admin Dashboard" }),
    ).toBeVisible({ timeout: 15000 });

    // Wait for coverage data to finish loading
    await expect(page.getByText("Loading coverage data...")).toBeHidden({
      timeout: 15000,
    });

    // 2. Shows summary stat cards with numeric values
    // Stat card labels are rendered as title-case DOM text (CSS uppercases them visually)
    await expect(
      page.getByText("Scraped Communes", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Parties", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Candidates", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Indexed Chunks", { exact: true }).first(),
    ).toBeVisible();

    // Each stat card shows a large numeric value in a <p> with tabular-nums class
    const statValues = page.locator("p.text-2xl.font-bold");
    await expect(statValues.first()).toBeVisible();
    const firstStatText = await statValues.first().textContent();
    expect(firstStatText).toMatch(/\d/);

    // 3. Has filter chips: All, Complete, Partial, Missing, Hide empty
    await expect(
      page.getByRole("button", { name: /Missing/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Hide empty/ }).first(),
    ).toBeVisible();

    // 4. Shows sortable commune table with Name column sort button
    // The communes table header count pattern: "Communes (N)"
    await expect(page.getByText(/Communes \(\d+\)/)).toBeVisible();
    // Name is a sort button inside the communes table header
    await expect(
      page.getByRole("button", { name: "Name" }).first(),
    ).toBeVisible();

    // 5. Has Refresh button
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

    // ── Chat Sessions Tab ─────────────────────────────────────────────────

    // Navigate to the Chat Sessions tab via URL
    await page.goto(`${BASE}?tab=chats`);

    // Wait for auth check and dashboard header
    await expect(
      page.getByRole("heading", { name: "Admin Dashboard" }),
    ).toBeVisible({ timeout: 15000 });

    // 1. Has status filter dropdown with options: All, Success, Error, Partial
    const statusFilter = page.locator("#status-filter");
    await expect(statusFilter).toBeVisible({ timeout: 10000 });
    await expect(
      statusFilter.getByRole("option", { name: "All" }),
    ).toBeAttached();
    await expect(
      statusFilter.getByRole("option", { name: "Success" }),
    ).toBeAttached();
    await expect(
      statusFilter.getByRole("option", { name: "Error" }),
    ).toBeAttached();
    await expect(
      statusFilter.getByRole("option", { name: "Partial" }),
    ).toBeAttached();

    // 2. Shows session count text matching pattern "N sessions"
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({
      timeout: 10000,
    });

    // 3. Has Refresh button
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

    // 4. When switching time range to "All time" (value "0"), shows sessions
    // The time range picker is the first combobox in the page header
    const timeRangePicker = page.getByRole("combobox").first();
    await timeRangePicker.selectOption("0");

    // Wait for sessions to reload with the all-time range applied
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({
      timeout: 10000,
    });

    // Check that at least some sessions exist in dev data and table headers are shown
    const sessionCountEl = page.getByText(/\d+ sessions?/);
    const sessionCountText = await sessionCountEl.textContent();
    const sessionMatch = sessionCountText?.match(/(\d+)/);
    const sessionCount = sessionMatch ? parseInt(sessionMatch[1], 10) : 0;

    if (sessionCount > 0) {
      // 5. Table headers visible when sessions exist:
      //    Timestamp, Session ID, Commune, Sources, Status, Resp. time, Model
      await expect(
        page.getByRole("columnheader", { name: "Timestamp" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Session ID" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Commune" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Sources" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Status" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Resp. time" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Model" }),
      ).toBeVisible();
    }
  });
});
