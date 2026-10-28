import { expect, type Page, test } from "@playwright/test";
import { boardId, boardIdOrNull, newBoard } from "../fixtures/support";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-escape-${name}-${Date.now()}-${++sequence}`;

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
 * There is no home board and no new-tab board any more. The workspace remembers
 * where you were, so reopening it — a reload, the launcher row, a second tab
 * without `?board=` — lands on that board instead of on the first one
 * (ADR-0064 amendment).
 */
test("reopens on the board you were last on", async ({ page }) => {
  await page.goto(workspaceUrl("last-board"));
  await expect(cards(page)).toHaveCount(2);
  const first = boardId(page);

  await newBoard(page);
  const second = boardId(page);
  expect(second).not.toBe(first);

  // A reload keeps the address bar's board, so the remembered one is the only
  // thing that can be doing the work here.
  const workspace = new URL(page.url()).searchParams.get("workspace") ?? "";
  await page.goto(`/?workspace=${workspace}`);
  await expect(cards(page)).toHaveCount(0);
  await expect.poll(() => boardIdOrNull(page)).toBe(second);
});
