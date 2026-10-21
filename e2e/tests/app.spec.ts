import { expect, test } from "@playwright/test";

test("canvas app boots and renders the board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
});
