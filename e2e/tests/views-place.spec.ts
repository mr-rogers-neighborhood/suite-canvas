import { expect, type Page, test } from "@playwright/test";
import { settleViewport } from "./marquee";
import { withOwnerKey } from "./ownerUrl";

/**
 * A run's sources ([ADR-0063](../docs/decisions/0063-placement-is-a-mode-too.md) §6):
 * every place a set of cards can come from hands the engine an ordered list and
 * nothing else. This covers the one that is a *query* — a saved view's result —
 * because its order is the thing that can silently differ from the list.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-viewplace-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const edges = (page: Page) => page.locator(".react-flow__edge");
// The trigger is named by the active view once one is saved, so it is addressed by
// its test id; a role name would stop matching the moment the view is applied.
const viewsButton = (page: Page) => page.getByTestId("views-menu-button");

async function removeAllFromBoard(page: Page): Promise<void> {
  await page.keyboard.press("Control+a");
  const box = await cards(page).first().boundingBox();
  if (!box) throw new Error("no card to press");
  await page.mouse.click(box.x + 40, box.y + 14, { button: "right" });
  await page.getByRole("menuitem", { name: "Remove from board" }).click();
  await expect(cards(page)).toHaveCount(0);
}

async function fitBoard(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fit View" }).click();
  await settleViewport(page);
}

test("a saved view's result places as a run, in the view's own order", async ({ page }) => {
  await page.goto(workspaceUrl("place"));
  await expect(cards(page)).toHaveCount(2);
  await removeAllFromBoard(page);

  // A view over every note, saved from the library's own controls: a view is
  // exactly what those controls express (ADR-0043).
  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  await page.getByTestId("facet-type-note").click();
  await expect(page.getByTestId("facet-type-note")).toHaveAttribute("data-active", "true");

  await viewsButton(page).click();
  await page.getByTestId("views-save").click();
  await page.getByTestId("views-save-input").fill("Everything");
  await page.getByTestId("views-save-commit").click();
  await expect(viewsButton(page)).toContainText("Everything");

  // Thread mode, then place the view's cards. The query is read on the click, so
  // the run follows the view rather than a list captured when it was saved.
  await page.getByTestId("link-mode-toggle").click();
  await expect(page.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "thread");

  await viewsButton(page).click();
  await expect(page.getByTestId("views-menu")).toBeVisible();
  await page.locator('[data-testid^="views-place-"]').first().click();

  await fitBoard(page);
  await expect(cards(page)).toHaveCount(2);
  await expect(edges(page)).toHaveCount(1);
});
