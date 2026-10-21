import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-panel-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

/** Opens the inspector with a click on the card header, not the editors. */
async function openCardInfo(page: Page, card = cards(page).first()): Promise<void> {
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
}

/** Creates a section around the first card; the inspector stays open. */
async function createSectionAroundFirstCard(page: Page, title: string): Promise<void> {
  await openCardInfo(page);
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(page.locator(".section-header")).toContainText(title);
}

test("edits the body in the inspector and shows it on the canvas card", async ({ page }) => {
  await page.goto(workspaceUrl("body"));
  await expect(cards(page)).toHaveCount(2);

  const card = cards(page).first();
  await openCardInfo(page, card);

  // Clicking the read-only body moves the editable surface into the panel.
  await page.getByTestId("card-panel-body").click();
  const panelEditor = page.locator(".card-inspector .node-card-editor.ProseMirror-focused");
  await expect(panelEditor).toHaveCount(1);

  await page.keyboard.type("Typed from the panel");
  await expect(page.locator(".card-inspector .node-card-editor")).toContainText(
    "Typed from the panel",
  );
  await expect(card.getByTestId("card-body")).toContainText("Typed from the panel");

  // The canvas editor for the same card stays read-only while the panel owns it.
  await expect(card.locator(".node-card-editor")).toHaveAttribute("contenteditable", "false");

  // The title is editable from the panel too, with the same exclusivity.
  await page.getByTestId("card-panel-title").click();
  await expect(page.locator(".card-inspector .card-title-editor.ProseMirror-focused")).toHaveCount(
    1,
  );
  await page.keyboard.type("Panel title");
  await expect(card.locator(".card-title-editor")).toContainText("Panel title");
});

test("shows the section breadcrumb and keeps the card visible when focused", async ({ page }) => {
  await page.goto(workspaceUrl("where"));
  await expect(cards(page)).toHaveCount(2);

  await createSectionAroundFirstCard(page, "Research");
  // Creating a section moves focus to the canvas; reopen the panel.
  await openCardInfo(page);

  const crumb = page.getByTestId("inspector-section");
  await expect(crumb).toContainText("Research");
  await expect(page.getByTestId("inspector-boards")).toContainText("Research");

  const card = cards(page).first();
  const before = await card.boundingBox();
  if (!before) throw new Error("card not visible");

  await crumb.click();

  await expect(card).toBeVisible();
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  const after = await card.boundingBox();
  if (!after) throw new Error("card disappeared after focusing its section");
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.y).toBeGreaterThanOrEqual(0);
});

test("syncs panel text and a caret to a peer's canvas card", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = workspaceUrl("two-clients");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(pageA)).toHaveCount(2);
  await expect(cards(pageB)).toHaveCount(2);

  await openCardInfo(pageA, cards(pageA).first());
  await pageA.getByTestId("card-panel-body").click();
  await expect(pageA.locator(".card-inspector .node-card-editor.ProseMirror-focused")).toHaveCount(
    1,
  );
  await pageA.keyboard.type("Panel to peer");

  // The peer reads the shared body in its own canvas editor.
  const peerCard = cards(pageB).first();
  await expect(peerCard.getByTestId("card-body")).toContainText("Panel to peer");

  // Presence is published from the panel, and the caret is content-anchored, so
  // it renders in the peer's canvas card.
  await expect(peerCard.getByTestId("presence-avatar")).toBeVisible();
  await expect(peerCard.locator(".ProseMirror-loro-cursor")).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});
