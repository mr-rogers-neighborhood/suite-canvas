import { expect, type Locator, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-refs-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const cardTitled = (page: Page, title: string) => cards(page).filter({ hasText: title });
const activeTab = (page: Page) => page.locator('[data-testid^="board-tab"][aria-selected="true"]');

/** Opens the inspector from the card header, away from the editors. */
async function openInspector(page: Page, card = cards(page).first()): Promise<void> {
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  // Blank cards open on Content; links and properties live on Details.
  await page.getByTestId("card-panel-tab-details").click();
}

async function closeInspector(page: Page): Promise<void> {
  await page.getByTestId("inspector-close").click();
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);
}

/** Gives a seeded (untitled) card a name, so rows can be asserted by text. */
async function renameCard(page: Page, card: Locator, title: string): Promise<void> {
  await openInspector(page, card);
  await page.getByTestId("card-panel-title").click();
  const editor = page.locator(".card-inspector .card-title-editor.ProseMirror-focused");
  await expect(editor).toHaveCount(1);
  await page.keyboard.type(title);
  await expect(editor).toContainText(title);
  await closeInspector(page);
}

async function createBoard(page: Page): Promise<void> {
  const before = await page.locator('[role="tab"][data-testid^="board-tab"]').count();
  await page.getByTestId("board-create").click();
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(before + 1);
}

async function openLibrary(page: Page, tab: "cards" | "inbox"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

async function closeLibrary(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close library" }).click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
}

/** Places a card from the library onto the active board. */
async function placeFromLibrary(page: Page, title: string): Promise<void> {
  await openLibrary(page, "cards");
  const row = page.locator('[data-testid^="library-item-"]').filter({ hasText: title }).first();
  await row.getByRole("button", { name: "Place" }).click();
  await closeLibrary(page);
}

/** Drags one connector dot onto another; handles can register a beat late. */
async function connectCards(page: Page): Promise<void> {
  const from = cards(page).nth(0).locator('[data-testid="connector-dot"]').nth(1);
  const to = cards(page).nth(1).locator('[data-testid="connector-dot"]').nth(3);
  const edge = page.locator(".react-flow__edge");

  await expect(async () => {
    const [source, target] = await Promise.all([from.boundingBox(), to.boundingBox()]);
    if (!source || !target) throw new Error("connectors not visible");
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 14,
    });
    await page.mouse.up();
    await expect(edge).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

test("links through a card property and navigates to the source", async ({ page }) => {
  await page.goto(workspaceUrl("property"));
  await expect(cards(page)).toHaveCount(2);

  await renameCard(page, cards(page).nth(0), "Alpha");
  await renameCard(page, cards(page).nth(1), "Beta");

  // A `card` field's name is the relation, so the link is the property's value.
  await openInspector(page, cardTitled(page, "Alpha"));
  await page.getByTestId("manage-types").click();
  await page.getByLabel("New field name").fill("Related");
  await page.getByLabel("New field kind").selectOption("card");
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel("Field name Related")).toHaveValue("Related");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByLabel("Related").last().fill("Beta");
  await page.getByTestId("card-option").filter({ hasText: "Beta" }).click();
  await expect(page.getByTestId("card-picker-selected")).toHaveText("Beta");
  await closeInspector(page);

  // The chip counts linked cards, so both ends of the pair report one.
  await expect(cardTitled(page, "Beta").getByTestId("card-link-count")).toContainText("1");
  await expect(cardTitled(page, "Alpha").getByTestId("card-link-count")).toContainText("1");

  // Place the target on a second board, so the row has somewhere to navigate.
  await createBoard(page);
  await placeFromLibrary(page, "Beta");
  await expect(cards(page)).toHaveCount(1);

  await openInspector(page, cards(page).first());
  await expect(page.getByTestId("inspector-link-count")).toContainText("1");
  const row = page.getByTestId("links-in").getByTestId("link-row");
  await expect(row).toContainText("Related");
  await expect(row).toContainText("Alpha");

  await row.click();
  await expect(activeTab(page)).toHaveText("Board 1");
  await expect(cards(page)).toHaveCount(2);
});

test("lists a drawn arrow with its board and switches board when clicked", async ({ page }) => {
  await page.goto(workspaceUrl("arrow"));
  await expect(cards(page)).toHaveCount(2);
  await renameCard(page, cards(page).nth(0), "Alpha");
  await renameCard(page, cards(page).nth(1), "Beta");

  // Draw on a second board: the arrow belongs to the board it was drawn on.
  await createBoard(page);
  await placeFromLibrary(page, "Alpha");
  await placeFromLibrary(page, "Beta");
  await expect(cards(page)).toHaveCount(2);
  await connectCards(page);

  // Board 1 knows about the drawing without being where it lives.
  await page.locator('[data-testid^="board-tab"]').first().click();
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cardTitled(page, "Alpha"));
  // Alpha is the source end, so the arrow reads as an outgoing link.
  const row = page.getByTestId("links-out").getByTestId("link-row");
  await expect(row).toContainText("Beta");
  await expect(row).toContainText("Board 2");

  await row.click();
  await expect(activeTab(page)).toHaveText("Board 2");
  await expect(cards(page)).toHaveCount(2);
});

test("shows the empty state and hides the count for a fresh card", async ({ page }) => {
  await page.goto(workspaceUrl("empty"));
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByTestId("card-link-count")).toHaveCount(0);

  await openInspector(page, cards(page).first());
  await expect(page.getByTestId("card-links")).toBeVisible();
  await expect(page.getByTestId("links-empty")).toHaveText(
    "No links yet. Type @ in a card, or draw an arrow between two cards.",
  );
  await expect(page.getByTestId("links-in")).toHaveCount(0);
  await expect(page.getByTestId("links-out")).toHaveCount(0);
  await expect(page.getByTestId("link-row")).toHaveCount(0);
});
