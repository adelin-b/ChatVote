// spec: e2e/mock/admin-dashboard.plan.md (section 2 — Tab Navigation and URL Sync)
// config: playwright.integration.config.ts (baseURL: http://localhost:3000)

import { test, expect } from "@playwright/test";

const SECRET = "test";
const BASE = `/admin/dashboard/${SECRET}`;

test.describe("Tab Navigation and URL Sync", () => {
  test("should navigate between all tabs and sync URL", async ({ page }) => {
    // 1. Default tab is Overview when no ?tab= param
    await page.goto(`/admin/dashboard/${SECRET}`);
    const overviewBtn = page.getByRole("button", { name: "Overview" });
    await expect(overviewBtn).toBeVisible({ timeout: 15000 });
    await expect(overviewBtn).toHaveClass(/border-blue-600/);

    // 2. Clicking Pipeline tab updates URL to ?tab=pipeline and shows pipeline content
    await page.getByRole("button", { name: "Pipeline" }).click();
    await expect(page).toHaveURL(/tab=pipeline/);
    await expect(page.getByRole("button", { name: "Pipeline" })).toHaveClass(/border-blue-600/);
    await expect(page.getByText("Population INSEE")).toBeVisible({ timeout: 15000 });

    // 2. Clicking Coverage tab updates URL to ?tab=coverage and shows coverage content
    await page.getByRole("button", { name: "Coverage" }).click();
    await expect(page).toHaveURL(/tab=coverage/);
    await expect(page.getByRole("button", { name: "Coverage" })).toHaveClass(/border-blue-600/);
    await expect(page.getByText("Communes")).toBeVisible({ timeout: 15000 });

    // 2. Clicking Chat Sessions tab updates URL to ?tab=chats and shows chat sessions content
    await page.getByRole("button", { name: "Chat Sessions" }).click();
    await expect(page).toHaveURL(/tab=chats/);
    await expect(page.getByRole("button", { name: "Chat Sessions" })).toHaveClass(/border-blue-600/);
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({ timeout: 10000 });

    // 2. Clicking Overview tab returns to overview and updates URL
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(page).toHaveURL(/tab=overview/);
    await expect(page.getByRole("button", { name: "Overview" })).toHaveClass(/border-blue-600/);

    // 3. Direct URL navigation to ?tab=pipeline shows pipeline content
    await page.goto(`${BASE}?tab=pipeline`);
    await expect(page.getByRole("button", { name: "Pipeline" })).toHaveClass(/border-blue-600/, {
      timeout: 15000,
    });
    await expect(page.getByText("Population INSEE")).toBeVisible({ timeout: 15000 });

    // 4. Direct URL navigation to ?tab=coverage shows coverage content
    await page.goto(`${BASE}?tab=coverage`);
    await expect(page.getByRole("button", { name: "Coverage" })).toHaveClass(/border-blue-600/, {
      timeout: 15000,
    });
    await expect(page.getByText("Communes")).toBeVisible({ timeout: 15000 });

    // 5. Direct URL navigation to ?tab=chats shows chat sessions content
    await page.goto(`${BASE}?tab=chats`);
    await expect(page.getByRole("button", { name: "Chat Sessions" })).toHaveClass(/border-blue-600/, {
      timeout: 15000,
    });
    await expect(page.getByText(/\d+ sessions?/)).toBeVisible({ timeout: 10000 });

    // 6. Time range picker shows 5 options and defaults to 24h
    await page.goto(`${BASE}?tab=overview`);
    const timeRangeSelect = page.getByRole("combobox").first();
    await expect(timeRangeSelect).toBeVisible({ timeout: 10000 });
    await expect(timeRangeSelect).toHaveValue("24");
    await expect(timeRangeSelect.getByRole("option", { name: "Last 1h" })).toBeAttached();
    await expect(timeRangeSelect.getByRole("option", { name: "Last 24h" })).toBeAttached();
    await expect(timeRangeSelect.getByRole("option", { name: "Last 7d" })).toBeAttached();
    await expect(timeRangeSelect.getByRole("option", { name: "Last 30d" })).toBeAttached();
    await expect(timeRangeSelect.getByRole("option", { name: "All time" })).toBeAttached();

    // 7. Old data-sources URL redirects to dashboard pipeline tab
    await page.goto(`/admin/data-sources/${SECRET}`);
    await expect(page).toHaveURL(/\/admin\/dashboard\/.*\?tab=pipeline/);
  });
});
