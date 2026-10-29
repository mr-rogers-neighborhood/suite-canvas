import { expect, type Page, test } from "@playwright/test";
import { skipAlphaNotice } from "../fixtures/support";

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const sectionHeaders = (page: Page) => page.locator(".section-header");

/**
 * The built-in starters are generated in code only when picked, so a workspace
 * that ignores them never grows sample cards. The launcher is where a reader
 * picks one now; the library lists boards, not blueprints.
 */
test("generates a built-in starter board with its region", async ({ page }) => {
  await skipAlphaNotice(page);
  await page.goto("/");
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();

  await page.getByTestId("launcher-template").selectOption("notebook");
  await page.getByTestId("launcher-new").click();

  // One region, three titled cards: one of each built-in type.
  await expect(sectionHeaders(page)).toHaveCount(1);
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(3);
  await expect(sectionHeaders(page).filter({ hasText: "Start here" })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "A note" })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "A concept" })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "A source" })).toHaveCount(1);

  // A board like any other: it persists.
  await page.reload();
  await expect(sectionHeaders(page)).toHaveCount(1);
  await expect(cards(page)).toHaveCount(3);
});
