import { expect, test } from "../support/base-test";
import { sendMessage, setupChat } from "../support/test-helpers";

test.describe("Demographic Bubbles", () => {
  test.beforeEach(async ({ expectedErrors }) => {
    // Firebase analytics errors expected in test env
    expectedErrors.push(/analytics/i);
    expectedErrors.push(/API key not valid/);
    // System status listener permission denied
    expectedErrors.push(/permission-denied/);
  });

  test("demographic question appears after first assistant response", async ({
    page,
  }) => {
    await setupChat(page);
    await sendMessage(page, "What is your education policy?");
    // Wait for assistant response to appear
    await expect(page.getByText("Response chunk").first()).toBeVisible({
      timeout: 30000,
    });
    // Demographic bubble should appear with gender question
    await expect(
      page.getByText("Pour mieux répondre à vos préoccupations, vous êtes…"),
    ).toBeVisible({ timeout: 10000 });
    // Gender options should be visible
    await expect(page.getByRole("button", { name: "Femme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Homme" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Autre" })).toBeVisible();
    // Skip button should be visible
    await expect(page.getByRole("button", { name: "Passer" })).toBeVisible();
  });

  test('clicking a demographic option shows "Merci !"', async ({ page }) => {
    await setupChat(page);
    await sendMessage(page, "What is your education policy?");
    await expect(page.getByText("Response chunk").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("button", { name: "Femme" })).toBeVisible({
      timeout: 10000,
    });
    // Click "Femme"
    await page.getByRole("button", { name: "Femme" }).click();
    // Should show thank you
    await expect(page.getByText("Merci !")).toBeVisible({ timeout: 5000 });
    // Original options should disappear
    await expect(page.getByRole("button", { name: "Homme" })).not.toBeVisible();
  });

  test("skipping a demographic question hides it", async ({ page }) => {
    await setupChat(page);
    await sendMessage(page, "What is your education policy?");
    await expect(page.getByText("Response chunk").first()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByRole("button", { name: "Passer" })).toBeVisible({
      timeout: 10000,
    });
    // Click skip
    await page.getByRole("button", { name: "Passer" }).click();
    // Question should disappear
    await expect(
      page.getByText("Pour mieux répondre à vos préoccupations"),
    ).not.toBeVisible({ timeout: 5000 });
    // No "Merci !" either
    await expect(page.getByText("Merci !")).not.toBeVisible();
  });
});
