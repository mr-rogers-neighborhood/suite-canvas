import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-ws-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function createBoard(page: Page): Promise<void> {
  const before = await page.locator('[role="tab"][data-testid^="board-tab"]').count();
  await page.getByTestId("board-create").click();
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(before + 1);
}

async function openLibrary(page: Page, tab: "inbox" | "cards" | "trash"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

test("creates a titled card from the dock", async ({ page }) => {
  await page.goto(workspaceUrl("create"));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("dock-type-note").click();
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
  await row.getByRole("button", { name: "Place" }).click();

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
  await page
    .locator('[data-testid^="library-item-"]')
    .first()
    .getByRole("button", { name: "Restore" })
    .click();

  // Trash keeps the placement, so restoring puts the card back on its board.
  await page.getByTestId("library-tab-trash").click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
});

test("shares one card across boards and lists both in the footer", async ({ page }) => {
  await page.goto(workspaceUrl("shared"));
  await expect(cards(page)).toHaveCount(2);

  await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Place the same card on the new board from the Cards tab.
  await openLibrary(page, "cards");
  await page
    .locator('[data-testid^="library-item-"]')
    .first()
    .getByRole("button", { name: "Place" })
    .click();
  await expect(cards(page)).toHaveCount(1);

  const card = cards(page).first();
  await card.getByTestId("card-footer-toggle").click();
  const footer = card.getByTestId("card-footer");
  await expect(footer).toContainText("Board 1");
  await expect(footer).toContainText("this board");
  await expect(footer.locator("li")).toHaveCount(2);
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

test("deletes an empty board without asking", async ({ page }) => {
  await page.goto(workspaceUrl("board-delete-empty"));
  await expect(cards(page)).toHaveCount(2);
  await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Nothing to lose, so no confirmation dialog.
  await page.getByLabel(/^Delete /).click();
  await expect(page.getByTestId("dialog")).toHaveCount(0);
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(1);
  await expect(cards(page)).toHaveCount(2);
});

test("asks before deleting a board with cards and keeps them in the library", async ({ page }) => {
  await page.goto(workspaceUrl("board-delete"));
  await expect(cards(page)).toHaveCount(2);
  await createBoard(page);
  await expect(cards(page)).toHaveCount(0);

  // Put a card on the board so the delete has consequences.
  await openLibrary(page, "cards");
  await page
    .locator('[data-testid^="library-item-"]')
    .first()
    .getByRole("button", { name: "Place" })
    .click();
  await expect(cards(page)).toHaveCount(1);

  await page.getByLabel(/^Delete /).click();
  await expect(page.getByTestId("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep cards" }).click();

  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(1);
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

  await pageA.getByTestId("dock-type-note").click();
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

  await contextA.close();
  await contextB.close();
});

test("still resolves a legacy ?doc= link to a workspace", async ({ page }) => {
  await page.goto(`/?doc=e2e-legacy-${Date.now()}`);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(1);
});
