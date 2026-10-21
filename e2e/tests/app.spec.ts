import { expect, test } from "@playwright/test";

test("canvas app boots and renders the board", async ({ page }) => {
  // A fresh workspace per run: the default one is shared state on the collab server.
  await page.goto(`/?workspace=e2e-boot-${Date.now()}`);
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await expect(page.getByTestId("dock-library")).toBeVisible();
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(1);
});
