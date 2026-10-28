import { expect, type Page, test } from "@playwright/test";
import { boardId, libraryRowAction, newBoard, openBoard } from "../fixtures/support";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-boards-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function createBoard(page: Page): Promise<string> {
  await newBoard(page);
  return boardId(page);
}

async function openLibrary(page: Page, tab: "cards" | "boards"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

/**
 * A board is not a claim and a tab is not a thing you can lose: leaving a board
 * and coming back — through the switcher, the library or a reload — finds every
 * card where it was (ADR-0064 amendment).
 */
test("keeps a board's cards when you leave it and come back", {
  tag: "@smoke",
}, async ({ page }) => {
  await page.goto(workspaceUrl("leave-and-return"));
  await expect(cards(page)).toHaveCount(2);
  const firstBoardId = boardId(page);

  const secondBoardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Give the board a card of its own, so "intact" means something.
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);

  // Leave it: the board that comes back is the one already open, and this one's
  // card is out of sight but never gone.
  await openBoard(page, firstBoardId);
  await expect(cards(page)).toHaveCount(2);

  // The library still lists it, and says it is not the board on screen.
  await page.getByTestId("library-tab-boards").click();
  await expect(page.getByTestId(`library-item-${secondBoardId}`)).toBeVisible();
  await expect(page.getByTestId(`library-board-state-${secondBoardId}`)).toHaveText("Closed");

  // Coming back through the library finds the card exactly where it was.
  await libraryRowAction(page.getByTestId(`library-item-${secondBoardId}`), "Open");
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId(`library-board-state-${secondBoardId}`)).toHaveText("Open");
});

test("reaches every board from the keyboard", { tag: "@smoke" }, async ({ page }) => {
  await page.goto(workspaceUrl("keyboard"));
  await expect(cards(page)).toHaveCount(2);
  const firstBoardId = boardId(page);

  const secondBoardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // The switcher is a menu, so the keys that role promises work: Down moves
  // between rows and Enter chooses one, without a pointer.
  await page.getByTestId("board-switcher").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("board-switcher-menu")).toBeVisible();
  // The list opens on the board on screen, so Down is the first other board.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => boardId(page)).not.toBe(secondBoardId);
  await expect(cards(page)).toHaveCount(2);
  expect(await boardId(page)).toBe(firstBoardId);
});

test("places a board as a portal without dropping it from the library", { tag: "@smoke" }, async ({
  page,
}) => {
  await page.goto(workspaceUrl("place"));
  await expect(cards(page)).toHaveCount(2);
  const firstBoardId = boardId(page);

  const secondBoardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Back to the first board, so placing the second one makes a portal there.
  await openBoard(page, firstBoardId);
  await expect(cards(page)).toHaveCount(2);

  await openLibrary(page, "boards");
  const rowsBefore = await page
    .locator("li[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
  await libraryRowAction(page.getByTestId(`library-item-${secondBoardId}`), "Place on board");
  await expect(page.getByTestId("portal-node")).toHaveCount(1);

  // The board is still one row, in the same place: placing is not a move. It
  // reads "Closed" because the board on screen is still the first one — the
  // state names where you are, not what you own.
  await expect(page.getByTestId(`library-item-${secondBoardId}`)).toBeVisible();
  await expect(page.getByTestId(`library-board-state-${secondBoardId}`)).toHaveText("Closed");
  const rowsAfter = await page
    .locator("li[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
  expect(rowsAfter).toEqual(rowsBefore);
});

test("unplaces one board's cards and leaves a shared card on the other", { tag: "@smoke" }, async ({
  page,
}) => {
  await page.goto(workspaceUrl("unplace"));
  await expect(cards(page)).toHaveCount(2);
  const firstBoardId = boardId(page);

  const secondBoardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // The same card now lives on both boards.
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);

  // The card also lives on the first board, so unplacing this board's copy
  // removes only this placement — the card stays where else it was.
  await page.getByTestId("library-tab-boards").click();
  await libraryRowAction(page.getByTestId(`library-item-${secondBoardId}`), "Unplace its cards");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByTestId(`library-board-state-${secondBoardId}`)).toHaveText("Open");

  await libraryRowAction(page.getByTestId(`library-item-${firstBoardId}`), "Open");
  await expect(cards(page)).toHaveCount(2);
});
