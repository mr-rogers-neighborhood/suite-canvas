import { expect, type Page, test } from "@playwright/test";
import { cardByTitle, cards, createNote, newBoard, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-org");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

const boardTabs = (page: Page) => page.locator('[data-testid^="board-tab"]');

test("duplicates a card from its menu without linking the copy to the original", async ({
  page,
}) => {
  await page.goto(workspaceUrl("duplicate"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Original idea");
  await expect(cards(page)).toHaveCount(3);

  await cardByTitle(page, "Original idea").getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  await expect(cards(page)).toHaveCount(4);
  // The title itself was copied, so both cards read the same.
  await expect(page.locator(".card-title-editor").filter({ hasText: "Original idea" })).toHaveCount(
    2,
  );

  // The copy is what the duplicate action selects, which is also how we find it.
  const selected = page.locator('.react-flow__node.selected [data-testid="node-card"]');
  await expect(selected).toHaveCount(1);
  const copyId = await selected.getAttribute("data-node-id");
  expect(copyId).toBeTruthy();
  const copy = page.locator(`[data-testid="node-card"][data-node-id="${copyId}"]`);

  await copy.getByRole("button", { name: "Edit card title" }).dblclick();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Revised copy");
  await expect(copy.locator(".card-title-editor")).toHaveText("Revised copy");
  await page.keyboard.press("Escape");

  // Editing the copy leaves the original untouched: a duplicate is a new card,
  // not a second placement of the same one.
  await expect(copy.locator(".card-title-editor")).toHaveText("Revised copy");
  await expect(page.locator(".card-title-editor").filter({ hasText: "Original idea" })).toHaveCount(
    1,
  );
  await expect(cardByTitle(page, "Original idea")).toHaveCount(1);
  await expect(cardByTitle(page, "Revised copy")).toHaveCount(1);
});

test("moves a card to a second board and it leaves the first", async ({ page }) => {
  await page.goto(workspaceUrl("move-board"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Movable note");
  await expect(cards(page)).toHaveCount(3);

  await newBoard(page);
  await expect(boardTabs(page)).toHaveCount(2);
  // A new board opens empty; the card is still on the first one.
  await expect(cards(page)).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Boards" })
    .getByRole("button", { name: "Board 1", exact: true })
    .click();
  await expect(cards(page)).toHaveCount(3);

  await cardByTitle(page, "Movable note").getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Move to board" }).hover();
  const target = page.getByTestId("context-submenu").getByRole("menuitem", { name: "Board 2" });
  await expect(target).toBeVisible();
  await target.click();

  await expect(cards(page)).toHaveCount(2);
  await expect(cardByTitle(page, "Movable note")).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Boards" })
    .getByRole("button", { name: "Board 2", exact: true })
    .click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cardByTitle(page, "Movable note")).toHaveCount(1);
});

test("quick capture adds a card and opens its title, but not while an editor has focus", async ({
  page,
}) => {
  await page.goto(workspaceUrl("quick-capture"));
  await expect(cards(page)).toHaveCount(2);

  await page.keyboard.press("Control+Enter");
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);

  // The new card starts in the title, like the dock's New card does.
  await page.keyboard.type("Captured thought");
  await expect(cardByTitle(page, "Captured thought")).toHaveCount(1);

  // A focused text surface keeps the chord for itself: no card appears, and the
  // card's own editor keeps focus instead of the canvas stealing it.
  await page.keyboard.press("Control+Enter");
  await expect(cards(page)).toHaveCount(3);
  await expect(
    page.locator(".card-title-editor.ProseMirror-focused, .node-card-editor.ProseMirror-focused"),
  ).toHaveCount(1);

  // Nothing was typed into the card by the ignored chord either.
  await expect(cardByTitle(page, "Captured thought")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(3);
});
