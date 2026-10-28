import { expect, type Page, test } from "@playwright/test";
import { boardId, libraryRowAction, newBoard, openBoard } from "../fixtures/support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-templates-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const sectionHeaders = (page: Page) => page.locator(".section-header");

/**
 * The shared helper is typed for cards/inbox/trash, so Boards is opened here:
 * the drawer reopens on its last tab, which the first click may already be.
 */
async function openLibrary(page: Page, tab: "cards" | "boards"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

async function createBoard(page: Page): Promise<string> {
  await newBoard(page);
  return boardId(page);
}

/**
 * Gate A18: a template is duplication. Marking a board changes nothing it
 * holds; using it makes a *new* board with copies of its sections, cards and
 * placements, and the template is still exactly as it was afterwards.
 */
test("uses a saved board template as a new board and undoes it whole", async ({ page }) => {
  await page.goto(workspaceUrl("use"));
  await expect(cards(page)).toHaveCount(2);

  // A board with one card of its own, so "copied" has something to mean.
  const boardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);
  const sourceCardId = await cards(page).first().getAttribute("data-node-id");
  expect(sourceCardId).toBeTruthy();

  await page.getByTestId("library-tab-boards").click();
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Save as blueprint");
  await expect(page.getByTestId(`library-board-template-${boardId}`)).toHaveText(
    "\u00b7 blueprint",
  );

  // It now sits in the Templates group, above the board list.
  await expect(page.getByTestId("library-templates")).toBeVisible();
  await expect(page.getByTestId(`library-template-title-${boardId}`)).toHaveText("Board 2");
  await expect(page.getByTestId("library-templates-divider")).toBeVisible();

  // Use closes the drawer and lands on the copy, whose name cannot collide.
  await page.getByTestId(`library-template-use-${boardId}`).click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
  await expect(page.getByTestId("board-switcher")).toHaveAttribute(
    "aria-label",
    "Board: Board 2 2",
  );
  await expect(cards(page)).toHaveCount(1);

  // The card is a copy, not the same record.
  const copyCardId = await cards(page).first().getAttribute("data-node-id");
  expect(copyCardId).toBeTruthy();
  expect(copyCardId).not.toBe(sourceCardId);

  // The source is untouched: same single card, same name, still a template.
  await openBoard(page, boardId);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toHaveAttribute("data-node-id", sourceCardId);
  await openLibrary(page, "boards");
  await expect(page.getByTestId(`library-title-${boardId}`)).toHaveText("Board 2");
  await expect(page.getByTestId(`library-board-template-${boardId}`)).toHaveText(
    "\u00b7 blueprint",
  );
  await page.getByRole("button", { name: "Close library" }).click();

  // Duplication is one undoable batch, so the copy goes away in one step.
  await page.keyboard.press("Control+z");
  await page.getByTestId("board-switcher").click();
  await expect(
    page.getByTestId("board-switcher-menu").getByRole("menuitem", { name: "Board 2 2" }),
  ).toHaveCount(0);
});

/**
 * The built-in starters: offered in the same group, but generated in code only
 * when picked, so a workspace that ignores them never grows sample cards.
 */
test("generates a built-in starter board with its region", async ({ page }) => {
  await page.goto(workspaceUrl("starter"));
  await expect(cards(page)).toHaveCount(2);

  await openLibrary(page, "boards");
  await expect(page.getByTestId("library-templates")).toBeVisible();
  await expect(page.getByTestId("library-starter-title-notebook")).toHaveText("Notebook");
  await expect(page.getByTestId("library-starter-use-notebook")).toBeVisible();

  await page.getByTestId("library-starter-use-notebook").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
  await expect(page.getByTestId("board-switcher")).toHaveAttribute("aria-label", "Board: Notebook");

  // One region, three titled cards: one of each built-in type.
  await expect(sectionHeaders(page)).toHaveCount(1);
  await expect(cards(page)).toHaveCount(3);
  await expect(sectionHeaders(page).filter({ hasText: "Start here" })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "A note" })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "A concept" })).toHaveCount(1);
  await expect(cards(page).filter({ hasText: "A source" })).toHaveCount(1);

  // A board like any other: it persists.
  await page.reload();
  await expect(sectionHeaders(page)).toHaveCount(1);
  await expect(cards(page)).toHaveCount(3);
});
