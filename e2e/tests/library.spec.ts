import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { libraryRowAction } from "./support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-ws-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function createBoard(page: Page): Promise<string> {
  const before = await page.locator('[data-testid^="board-tab"]').count();
  await page.getByTestId("board-create").click();
  await expect(page.locator('[data-testid^="board-tab"]')).toHaveCount(before + 1);
  const testId = await page
    .locator('[data-testid^="board-tab"][aria-current="page"]')
    .getAttribute("data-testid");
  if (!testId) throw new Error("the new board has no tab");
  return testId.replace("board-tab-", "");
}

async function createNoteFromDock(page: Page): Promise<void> {
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
}

async function createSectionAroundCard(page: Page, index: number, title: string): Promise<void> {
  const card = cards(page).nth(index);
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 40, box.y + 60);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  const before = await page.locator(".section-header").count();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(before + 1);
  // Fill the title directly: the freshly created section owns this input.
  const input = page.getByTestId("section-title-input");
  await expect(input).toBeVisible();
  await input.fill(title);
  await input.press("Enter");
  await expect(page.locator(".section-header").nth(before)).toContainText(title);
}

/** Grows the sole section from its south-east handle so a subsection can fit. */
async function growSection(page: Page): Promise<void> {
  const handle = await page.getByTestId("section-handle-se").boundingBox();
  if (!handle) throw new Error("section handle not visible");
  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 144, handle.y + 124, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".section-region").first()).toBeVisible();
}

async function addTextField(page: Page, name: string): Promise<void> {
  // Metadata lives on the Details tab; blank cards open on Content.
  await page.getByTestId("card-panel-tab-details").click();
  await page.getByTestId("manage-types").click();
  await expect(page.getByTestId("type-settings")).toBeVisible();
  await page.getByLabel("New field name").fill(name);
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel(`Field name ${name}`)).toHaveValue(name);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("type-settings")).toHaveCount(0);
}

async function openLibrary(page: Page, tab: "inbox" | "cards" | "boards" | "trash"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

test("creates a titled card from the dock", async ({ page }) => {
  await page.goto(workspaceUrl("create"));
  await expect(cards(page)).toHaveCount(2);

  await createNoteFromDock(page);
  await expect(cards(page)).toHaveCount(3);

  // New cards land in the title, not the body.
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  // React StrictMode remounts the editor once in dev; let the focused instance
  // settle so the first keystrokes cannot land in the discarded one.
  await page.waitForTimeout(300);
  await page.keyboard.type("Field notes");
  await expect(page.locator(".card-title-editor").filter({ hasText: "Field notes" })).toHaveCount(
    1,
  );

  await openLibrary(page, "cards");
  await expect(page.getByTestId("library-drawer")).toContainText("Field notes");
});

test("removes a card to the inbox and places it back on the board", async ({ page }) => {
  await page.goto(workspaceUrl("inbox"));
  await expect(cards(page)).toHaveCount(2);

  const card = cards(page).first();
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Remove from board" }).click();

  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("dock-inbox-count")).toHaveText("1");

  await openLibrary(page, "inbox");
  const row = page.locator('[data-testid^="library-item-"]').first();
  await libraryRowAction(row, "Place on board");

  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("dock-inbox-count")).toHaveCount(0);
});

test("trashes a card and restores it to its board", async ({ page }) => {
  await page.goto(workspaceUrl("trash"));
  await expect(cards(page)).toHaveCount(2);

  const card = cards(page).first();
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await expect(cards(page)).toHaveCount(1);

  await openLibrary(page, "trash");
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(1);
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Restore");

  // Trash keeps the placement, so restoring puts the card back on its board.
  await page.getByTestId("library-tab-trash").click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
});

test("shares one card across boards and lists both in the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("shared"));
  await expect(cards(page)).toHaveCount(2);

  await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Place the same card on the new board from the Cards tab.
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);

  const card = cards(page).first();
  await card.getByTestId("card-type").click();
  await page.getByTestId("card-panel-tab-details").click();
  const boards = page.getByTestId("inspector-boards");
  await expect(boards).toContainText("Board 1");
  await expect(boards.locator("li")).toHaveCount(2);
});

test("holds a card out of the drawer and drops it on the board", async ({ page }) => {
  await page.goto(workspaceUrl("hold"));
  await expect(cards(page)).toHaveCount(2);
  await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  await openLibrary(page, "cards");
  const row = page.locator('[data-testid^="library-item-"]').first();
  const box = await row.boundingBox();
  if (!box) throw new Error("library row not visible");

  await page.mouse.move(box.x + 30, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y - 60, { steps: 6 });
  await page.mouse.move(640, 300, { steps: 10 });
  await expect(page.getByTestId("library-hold-ghost")).toBeVisible();
  await page.mouse.up();

  await expect(cards(page)).toHaveCount(1);
  // Dropped roughly where the pointer was, not at the viewport centre.
  const placed = await cards(page).first().boundingBox();
  if (!placed) throw new Error("card not placed");
  expect(Math.abs(placed.x + placed.width / 2 - 640)).toBeLessThan(60);
});

test("deletes a board from the library and asks once", async ({ page }) => {
  await page.goto(workspaceUrl("board-delete-empty"));
  await expect(cards(page)).toHaveCount(2);
  const boardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Deletion lives in the library now; the tab strip only closes tabs.
  await openLibrary(page, "boards");
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Delete board\u2026");
  await expect(page.getByTestId("dialog")).toBeVisible();
  await page.getByTestId("dialog").getByRole("button", { name: "Unplace cards" }).click();

  await expect(page.locator('[data-testid^="board-tab"]')).toHaveCount(1);
  await expect(page.getByTestId(`library-item-${boardId}`)).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
});

test("asks before deleting a board with cards and keeps them in the library", async ({ page }) => {
  await page.goto(workspaceUrl("board-delete"));
  await expect(cards(page)).toHaveCount(2);
  const boardId = await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Put a card on the board so the delete has consequences.
  await openLibrary(page, "cards");
  await libraryRowAction(page.locator('[data-testid^="library-item-"]').first(), "Place on board");
  await expect(cards(page)).toHaveCount(1);

  await page.getByTestId("library-tab-boards").click();
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Delete board\u2026");
  await expect(page.getByTestId("dialog")).toBeVisible();
  await page.getByTestId("dialog").getByRole("button", { name: "Unplace cards" }).click();

  await expect(page.locator('[data-testid^="board-tab"]')).toHaveCount(1);
  // The card survives; it is simply no longer on the deleted board.
  await expect(page.getByTestId("dock-inbox-count")).toHaveCount(0);
  await openLibrary(page, "inbox");
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(0);
});

test("syncs card titles and title carets between clients", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = workspaceUrl("title-presence");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.locator(".card-title-editor")).toHaveCount(2);

  await createNoteFromDock(pageA);
  await expect(pageA.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  // React StrictMode remounts the editor once in dev; let the focused instance
  // settle so the first keystrokes cannot land in the discarded one.
  await pageA.waitForTimeout(300);
  await pageA.keyboard.type("Shared title");

  await expect(pageB.locator(".card-title-editor").filter({ hasText: "Shared title" })).toHaveCount(
    1,
  );
  // The caret renders in B's title editor, not its body.
  await expect(
    pageB
      .locator('[data-testid="node-card"]')
      .filter({ hasText: "Shared title" })
      .locator(".card-title-editor .ProseMirror-loro-cursor"),
  ).toHaveCount(1);
  // The title must let the caret badge escape instead of clipping it.
  await expect(
    pageB
      .locator('[data-testid="node-card"]')
      .filter({ hasText: "Shared title" })
      .locator(".card-title-editor p")
      .first(),
  ).toHaveCSS("overflow", "visible");
  // A title cursor must not also be rendered in the body editor.
  await expect(
    pageB
      .locator('[data-testid="node-card"]')
      .filter({ hasText: "Shared title" })
      .locator(".node-card-editor .ProseMirror-loro-cursor"),
  ).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test("still resolves a legacy ?doc= link to a workspace", async ({ page }) => {
  await page.goto(`/?doc=e2e-legacy-${Date.now()}`);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('[data-testid^="board-tab"]')).toHaveCount(1);
});

test("scopes the cards list to the active board", async ({ page }) => {
  await page.goto(workspaceUrl("scope"));
  await expect(cards(page)).toHaveCount(2);

  // The second card leaves the board, so scope has something to hide.
  await cards(page).nth(1).getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Remove from board" }).click();

  await openLibrary(page, "cards");
  const rows = page.locator('[data-testid^="library-item-"]');
  await expect(rows).toHaveCount(2);

  await expect(page.getByTestId("library-scope")).toBeVisible();
  await page.getByTestId("library-scope-board").click();
  await expect(rows).toHaveCount(1);

  await page.getByTestId("library-scope-all").click();
  await expect(rows).toHaveCount(2);

  // Inbox and Trash ignore scope, so they do not offer it.
  await page.getByTestId("library-tab-inbox").click();
  await expect(page.getByTestId("library-scope")).toHaveCount(0);
  await page.getByTestId("library-tab-trash").click();
  await expect(page.getByTestId("library-scope")).toHaveCount(0);
});

test("filters the board-scoped list by section subtree and unsorted", async ({ page }) => {
  await page.goto(workspaceUrl("section-filter"));
  await expect(cards(page)).toHaveCount(2);

  await createSectionAroundCard(page, 0, "Research");
  // Room for a section that is genuinely inside the first one.
  await growSection(page);
  await createSectionAroundCard(page, 0, "Sub");

  await openLibrary(page, "cards");
  await page.getByTestId("library-scope-board").click();

  const rows = page.locator('[data-testid^="library-item-"]');
  await expect(rows).toHaveCount(2);
  // Row meta names the card's own (deepest) section, then the board.
  await expect(page.getByTestId("library-row-meta").first()).toContainText("Sub \u00b7 Board 1");

  const facets = page.locator('[data-testid^="facet-section-"]');
  await expect(facets).toHaveCount(3);

  // Selecting the parent includes the card that lives in its subsection.
  const research = facets.filter({ hasText: "Research" });
  await research.click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("library-row-meta")).toContainText("Sub \u00b7 Board 1");

  await research.click();
  await expect(rows).toHaveCount(2);

  await page.getByTestId("facet-section-__unsorted__").click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("library-row-meta")).toContainText("Unsorted");

  await page.getByTestId("clear-filters").click();
  await expect(rows).toHaveCount(2);
});

test("groups board cards by section with unsorted last", async ({ page }) => {
  await page.goto(workspaceUrl("group"));
  await expect(cards(page)).toHaveCount(2);

  await createSectionAroundCard(page, 0, "Research");

  await openLibrary(page, "cards");
  await page.getByTestId("library-scope-board").click();
  await page.getByTestId("library-group-toggle").click();

  // `library-group-toggle` also starts with "library-group-", so match the group sections only.
  const groups = page.locator('section[data-testid^="library-group-"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.first()).toContainText("Research");
  await expect(groups.first().locator('[data-testid^="library-item-"]')).toHaveCount(1);
  await expect(groups.last()).toContainText("Unsorted");
  await expect(groups.last().locator('[data-testid^="library-item-"]')).toHaveCount(1);
});

test("opens a library row in the inspector instead of expanding it", async ({ page }) => {
  await page.goto(workspaceUrl("row-panel"));
  await expect(cards(page)).toHaveCount(2);

  // A text field to edit from the inspector.
  await cards(page).first().getByTestId("card-type").click();
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await addTextField(page, "Status");
  await page.getByTestId("inspector-close").click();

  await openLibrary(page, "cards");
  await page.getByTestId("library-scope-board").click();
  await page.locator('[data-testid^="library-item-"]').first().click();

  const panel = page.getByTestId("card-inspector");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("card-panel")).toHaveAttribute("data-variant", "inspector");
  // The row is a list entry, never an editor of its own.
  await expect(page.getByTestId("library-row-panel")).toHaveCount(0);
  await expect(page.getByTestId("library-row-expand")).toHaveCount(0);

  // Metadata is on Details; the field write reaches the canvas card.
  await expect(panel.getByTestId("card-panel-tab-details")).toBeVisible();
  await panel.getByTestId("card-panel-tab-details").click();
  const status = panel.getByLabel("Status");
  await status.fill("active");
  await status.blur();

  const canvasCard = cards(page).first();
  await canvasCard.getByTestId("card-meta-toggle").click();
  await expect(canvasCard.getByTestId("card-meta")).toContainText("active");

  // Content edits the shared body the canvas card renders.
  await panel.getByTestId("card-panel-tab-content").click();
  await panel.getByTestId("card-panel-body").click();
  await expect(panel.getByTestId("card-panel-body")).toHaveAttribute("data-editing", "true");
  // React StrictMode remounts the editor once in dev; let the focused instance settle.
  await page.waitForTimeout(300);
  await page.keyboard.type("From the row");
  await expect(canvasCard.locator(".node-card-editor")).toContainText("From the row");

  // Working in the inspector and on the card dismissed the drawer, which is the
  // drawer behaving as one (a press outside closes it). The point of the step is
  // that it is still a list: closing and reopening shows rows, not a panel.
  await openLibrary(page, "cards");
  await page.getByLabel("Close library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
  await openLibrary(page, "cards");
  await expect(page.getByTestId("library-row-panel")).toHaveCount(0);
});
