import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { libraryRowAction } from "./support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-boards-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const tabs = (page: Page) => page.locator('[data-testid^="board-tab"]');

async function selectedBoardId(page: Page): Promise<string> {
  const testId = await page
    .locator('[data-testid^="board-tab"][aria-current="page"]')
    .getAttribute("data-testid");
  if (!testId) throw new Error("no board tab is selected");
  return testId.replace("board-tab-", "");
}

async function createBoard(page: Page): Promise<string> {
  const before = await tabs(page).count();
  await page.getByTestId("board-create").click();
  await expect(tabs(page)).toHaveCount(before + 1);
  return selectedBoardId(page);
}

async function openLibrary(page: Page, tab: "cards" | "boards"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

/**
 * Gate A13: a tab is a view of a board, not a claim on it. Closing one asks
 * nothing and writes nothing, and the board — with its cards — is waiting in
 * the library.
 */
test("closes a board tab with no prompt and reopens it from the library", async ({ page }) => {
  await page.goto(workspaceUrl("close"));
  await expect(cards(page)).toHaveCount(2);

  const boardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Give the board a card of its own, so "intact" means something.
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);

  // Close: no dialog, one tab left, and the board's card is out of sight.
  await page.getByTestId(`board-close-${boardId}`).click();
  await expect(page.getByTestId("dialog")).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(1);
  await expect(cards(page)).toHaveCount(2);

  // The library still lists it, marked closed.
  await page.getByTestId("library-tab-boards").click();
  await expect(page.getByTestId(`library-board-state-${boardId}`)).toHaveText("Closed");
  await expect(page.getByTestId(`library-item-${boardId}`)).toBeVisible();

  // Reopening gives it a tab again and its card is still there.
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Open");
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.getByTestId(`library-board-state-${boardId}`)).toHaveText("Open");
  await expect(cards(page)).toHaveCount(1);
});

test("reaches every board's close control from the keyboard", async ({ page }) => {
  await page.goto(workspaceUrl("keyboard"));
  await expect(cards(page)).toHaveCount(2);

  const boardId = await createBoard(page);
  await expect(tabs(page)).toHaveCount(2);

  // The strip is a navigation of buttons, not a tablist, because a per-board close
  // control cannot live inside a strict tablist (ADR-0064 amendment). Buttons are in
  // the tab order, so closing is reachable without a pointer.
  const close = page.getByTestId(`board-close-${boardId}`);
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tabs(page)).toHaveCount(1);
});

test("places a board as a portal without dropping it from the library", async ({ page }) => {
  await page.goto(workspaceUrl("place"));
  await expect(cards(page)).toHaveCount(2);
  const firstBoardId = await selectedBoardId(page);

  const boardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Back to the first board, so placing the second one makes a portal there.
  await page.getByTestId(`board-tab-${firstBoardId}`).click();
  await expect(cards(page)).toHaveCount(2);

  await openLibrary(page, "boards");
  const rowsBefore = await page
    .locator("li[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Place on board");
  await expect(page.getByTestId("portal-node")).toHaveCount(1);

  // The board is still one row, in the same place: placing is not a move.
  await expect(page.getByTestId(`library-item-${boardId}`)).toBeVisible();
  await expect(page.getByTestId(`library-board-state-${boardId}`)).toHaveText("Open");
  const rowsAfter = await page
    .locator("li[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
  expect(rowsAfter).toEqual(rowsBefore);
});

test("unplaces one board's cards and leaves a shared card on the other", async ({ page }) => {
  await page.goto(workspaceUrl("unplace"));
  await expect(cards(page)).toHaveCount(2);
  const firstBoardId = await selectedBoardId(page);

  const boardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // The same card now lives on both boards.
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);

  // The card also lives on the first board, so unplacing this board's copy
  // removes only this placement — the card stays where else it was.
  await page.getByTestId("library-tab-boards").click();
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Unplace its cards");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByTestId(`library-board-state-${boardId}`)).toHaveText("Open");

  await libraryRowAction(page.getByTestId(`library-item-${firstBoardId}`), "Open");
  await expect(cards(page)).toHaveCount(2);
});
