import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-escape-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const selectedNodes = (page: Page) => page.locator(".react-flow__node.selected");

async function openCardInfo(page: Page): Promise<void> {
  const box = await cards(page).first().boundingBox();
  if (!box) throw new Error("card not visible");
  // The gutter beside the type glyph, not the title: clicking the title starts
  // editing it, and an editor owns the first Escape, which is the layer this test
  // is not about.
  await page.mouse.click(box.x + 24, box.y + 24);
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

/**
 * The panel covers a third of the canvas exactly when the reader is aiming under
 * it: a link drawn from a dot runs its preview beneath the drawer, and the card it
 * is aimed at is usually one the drawer is over. The fade is paint only, because
 * a panel that stopped taking presses would hand a release to the canvas.
 */
test("the inspector fades while a link is drawn and comes back", async ({ page }) => {
  await page.goto(workspaceUrl("fade"));
  await expect(cards(page)).toHaveCount(2);
  await openCardInfo(page);

  const drawer = page.getByTestId("card-inspector");
  await expect(drawer).toHaveCSS("opacity", "1");

  const first = cards(page).first();
  await first.click();
  const dot = await first.getByTestId("connector-dot").nth(1).boundingBox();
  if (!dot) throw new Error("cannot measure a dot");
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(dot.x + 60, dot.y + 40, { steps: 6 });

  await expect(drawer).toHaveCSS("opacity", "0.3");
  // Still a panel, not a hole: it takes the press that would fall through.
  await expect(drawer).toBeVisible();

  await page.mouse.up();
  await expect(drawer).toHaveCSS("opacity", "1");
});

/**
 * Past the last dismissal Escape is a climb, not a no-op: the chosen purpose walks
 * back to its default, so a reader who armed a tool an hour ago has a way out that is
 * not hunting for the control again.
 */
test("Escape with nothing left to close walks the purpose back to explore", async ({ page }) => {
  await page.goto(workspaceUrl("modes"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const purpose = page.getByTestId("purpose-toggle");
  await expect(purpose).toHaveAttribute("data-purpose", "explore");

  await purpose.click();
  await expect(purpose).toHaveAttribute("data-purpose", "explain");
  // A purpose is a choice that outlives the gesture, so nothing above the ladder
  // owns it: this press is the rung itself.
  await page.keyboard.press("Escape");
  await expect(purpose).toHaveAttribute("data-purpose", "explore");
});
