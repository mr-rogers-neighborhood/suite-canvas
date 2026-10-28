import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-run-shelf-${name}-${Date.now()}-${++sequence}`;

const drawer = (page: Page) => page.getByTestId("library-drawer");
const runBar = (page: Page) => page.getByTestId("placement-run");
/** Rows a run can place: a board is a row too, and there is nothing to place. */
const cardRows = (page: Page) =>
  drawer(page)
    .locator('[data-testid^="library-item-"]')
    .filter({ hasNot: page.locator('[data-testid^="library-board-state-"]') });

/**
 * The shelf goes away while the hands are busy.
 *
 * A run started from the library places every card where the reader aims, and the drawer
 * is exactly where they aim: it covered the middle of the board, so the first placement of
 * every sequence was a shot at a panel. It comes back when the hand is empty — the
 * sequence is over, and the next thing the reader wants is the shelf they took the cards
 * from (ADR-0063 amendment).
 */
test("a run puts the library away and brings it back when the hand is empty", async ({ page }) => {
  await page.goto(workspaceUrl("run"));
  await expect(page.getByTestId("node-card").first()).toBeVisible();
  await page.getByTestId("dock-library").click();
  await expect(drawer(page)).toBeVisible();

  // An unplaced card, which is what a run is made of.
  await page.getByTestId("library-new-card").click();
  await expect(cardRows(page)).toHaveCount(1);
  await page.getByTestId("library-select-toggle").click();
  await cardRows(page).first().click();
  await expect(page.getByTestId("library-selection")).toBeVisible();

  await page.getByTestId("library-run-thread").click();

  // Out of the way, with the run's own bar saying what is in hand.
  await expect(drawer(page)).toHaveCount(0);
  await expect(runBar(page)).toBeVisible();

  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("board not visible");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);

  // Empty handed: the run is over and the shelf is back where it was.
  await expect(runBar(page)).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
});

test("escape ends the run and the library returns", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await expect(page.getByTestId("node-card").first()).toBeVisible();
  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-new-card").click();
  await page.getByTestId("library-select-toggle").click();
  await cardRows(page).first().click();
  await page.getByTestId("library-run-thread").click();
  await expect(runBar(page)).toBeVisible();

  // Nothing placed, and nothing stranded: cancel is not a state the reader has to
  // clean up after.
  await page.keyboard.press("Escape");
  await expect(runBar(page)).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
});

/**
 * The same rule for a single drag: the drawer is what the ghost would be dropped *on*, so
 * it steps aside as soon as the press becomes a drag and comes back on release.
 */
test("dragging a row out fades the drawer and dropping it brings it back", async ({ page }) => {
  await page.goto(workspaceUrl("drag"));
  await expect(page.getByTestId("node-card").first()).toBeVisible();
  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-new-card").click();
  await expect(cardRows(page)).toHaveCount(1);

  const row = await cardRows(page).first().boundingBox();
  if (!row) throw new Error("row not visible");
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("board not visible");

  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(board.x + board.width * 0.5, board.y + board.height * 0.4, { steps: 12 });
  await expect(drawer(page)).toHaveCSS("opacity", "0");

  await page.mouse.up();
  // The drop landed, and the shelf is back for the next thing.
  await expect(page.getByTestId("node-card")).toHaveCount(3);
  await expect(drawer(page)).toHaveCSS("opacity", "1");
});
