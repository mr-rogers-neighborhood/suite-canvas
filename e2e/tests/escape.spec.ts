import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-escape-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const selectedNodes = (page: Page) => page.locator(".react-flow__node.selected");

async function openCardInfo(page: Page): Promise<void> {
  const box = await cards(page).first().boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await expect(selectedNodes(page)).toHaveCount(1);
}

/**
 * One Escape, one layer (`shell/escapeLayers` + the board's key chain).
 *
 * The failure this covers was not a missing dismissal but a doubled one: every
 * surface answered Escape with its own listener while the board's chain ran
 * underneath, so closing a panel also threw away the selection it described.
 */
test("Escape closes the inspector, then the selection, one at a time", async ({ page }) => {
  await page.goto(workspaceUrl("inspector"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await openCardInfo(page);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);
  // The panel is a view of the selection, so closing it is not deselecting: the
  // card is still selected and its connectors are still offered.
  await expect(selectedNodes(page)).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(selectedNodes(page)).toHaveCount(0);
});

test("Escape over the library closes the library, not the selection behind it", async ({
  page,
}) => {
  await page.goto(workspaceUrl("library"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await openCardInfo(page);
  await page.keyboard.press("Escape");
  await expect(selectedNodes(page)).toHaveCount(1);

  await page.getByTestId("dock-library").click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
  await expect(selectedNodes(page)).toHaveCount(1);
});

test("Escape over the command palette closes the palette only", async ({ page }) => {
  await page.goto(workspaceUrl("palette"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await openCardInfo(page);
  await page.keyboard.press("Escape");
  await expect(selectedNodes(page)).toHaveCount(1);

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await expect(selectedNodes(page)).toHaveCount(1);
});

test("the library clears its query before it closes", async ({ page }) => {
  await page.goto(workspaceUrl("query"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await page.getByTestId("dock-library").click();
  const search = page.getByTestId("library-search");
  await search.fill("Alpha");
  await expect(search).toHaveValue("Alpha");

  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.getByTestId("library-drawer")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
});
