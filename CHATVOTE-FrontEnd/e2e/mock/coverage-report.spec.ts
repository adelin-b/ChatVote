import { expect, test } from "../support/base-test";

test.describe("Coverage Report Page", () => {
  test.beforeEach(async ({ expectedErrors }) => {
    expectedErrors.push(/analytics/i);
    expectedErrors.push(/API key not valid/);
    expectedErrors.push(/permission-denied/);
    expectedErrors.push(/No matching allow statements/);
  });

  test("page loads with header and back arrow", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Back arrow link should point to /experiment
    await expect(page.locator('a[href="/experiment"]')).toBeVisible();
  });

  test("shows summary stat cards", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Stat card labels (DOM text is title case; CSS uppercase is display-only)
    await expect(
      page.getByText("Communes", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Parties", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Candidates", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Questions asked")).toBeVisible();
    await expect(page.getByText("Indexed chunks").first()).toBeVisible();
  });

  test("shows communes table", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Communes table header should exist
    await expect(page.getByText(/Communes \(\d+\)/)).toBeVisible();
    // Column headers (DOM text is title case, CSS uppercase is display-only)
    await expect(
      page.getByRole("columnheader", { name: "Commune" }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Lists", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Questions", { exact: true }).first(),
    ).toBeVisible();
  });

  test("shows parties table with manifesto indicators", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Parties section
    await expect(page.getByText(/Parties \(\d+\)/)).toBeVisible();
    await expect(
      page.getByText("Manifesto", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Indexed chunks").last()).toBeVisible();
  });

  test("shows candidates table with data availability columns", async ({
    page,
  }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Candidates section
    await expect(page.getByText(/Candidates \(\d+\)/)).toBeVisible();
    await expect(page.getByText("Candidate", { exact: true })).toBeVisible();
    await expect(page.getByText("Website", { exact: true })).toBeVisible();
    // Manifesto column appears twice (parties + candidates), check last
    const manifestoHeaders = page.getByText("Manifesto", { exact: true });
    await expect(manifestoHeaders.last()).toBeVisible();
  });

  test("sidebar is visible on desktop", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Icon sidebar has chat link
    await expect(page.locator('a[href="/chat"]').first()).toBeVisible();
  });

  test("communes table has sort buttons", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Sort buttons in communes header
    await expect(
      page.getByRole("button", { name: "Name" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Lists" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Questions" })).toBeVisible();
  });

  test("candidates table has sort buttons", async ({ page }) => {
    await page.goto("/experiment/coverage", { timeout: 30000 });
    await expect(page.getByText("Coverage Report")).toBeVisible({
      timeout: 15000,
    });
    // Candidates sort buttons
    await expect(page.getByRole("button", { name: "Commune" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Party" })).toBeVisible();
  });
});
