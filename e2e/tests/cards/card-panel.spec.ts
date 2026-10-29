import { expect, type Page, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";
import { selectCard } from "../fixtures/support";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-panel-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

const BODY_PLACEHOLDER = "Begin writing, or type / for commands.";

/** Details holds the metadata; an empty card opens on Content instead. */
async function showDetails(page: Page): Promise<void> {
  await page.getByTestId("card-panel-tab-details").click();
  await expect(page.getByTestId("card-panel-details")).toBeVisible();
}

/** Opens the inspector with a click on the card header, and leaves nothing focused. */
async function openCardInfo(page: Page, card = cards(page).first()): Promise<void> {
  await selectCard(page, card);
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
  await showDetails(page);

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

test("splits the inspector into Details and Content tabs", async ({ page }) => {
  await page.goto(workspaceUrl("tabs"));
  await expect(cards(page)).toHaveCount(2);

  await openCardInfo(page);
  const detailsTab = page.getByTestId("card-panel-tab-details");
  const contentTab = page.getByTestId("card-panel-tab-content");
  await expect(detailsTab).toHaveText("Details");
  await expect(contentTab).toHaveText("Content");

  // A blank card starts where the writing happens, not under the metadata. The tab says so with
  // aria-selected, which is the attribute a tablist uses; aria-current belongs to navigation.
  await expect(page.getByTestId("card-panel-body")).toBeVisible();
  await expect(page.getByTestId("card-panel-details")).toHaveCount(0);
  // The body is a surface of its own, not bare text.
  await expect(page.getByTestId("card-panel-body")).toHaveCSS("border-top-width", "1px");

  await detailsTab.click();
  await expect(detailsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("card-panel-details")).toBeVisible();
  await expect(page.getByTestId("type-picker")).toBeVisible();
  await expect(page.getByTestId("card-panel-body")).toHaveCount(0);

  // Edit opens the card full-canvas, which lands on the body with the caret in it.
  await page.getByTestId("inspector-edit").click();
  await expect(page.getByTestId("card-focus")).toBeVisible();
  await expect(
    page.locator(".card-focus .card-panel-body .node-card-editor.ProseMirror-focused"),
  ).toHaveCount(1);
  // The drawer is gone; the same tabs now live on the focus surface.
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);

  await page.getByTestId("card-focus-back").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
});

test("shows the empty-body placeholder on the card and in the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("placeholder"));
  await expect(cards(page)).toHaveCount(2);

  const card = cards(page).first();
  const canvasPlaceholder = card.locator(".node-card-editor p.is-editor-empty");
  await expect(canvasPlaceholder).toHaveAttribute("data-placeholder", BODY_PLACEHOLDER);

  await openCardInfo(page, card);
  const panelPlaceholder = page.locator(".card-inspector .card-panel-body p.is-editor-empty");
  await expect(panelPlaceholder).toHaveAttribute("data-placeholder", BODY_PLACEHOLDER);

  // The decoration is what paints the copy; the body itself stays empty.
  const painted = await panelPlaceholder.evaluate(
    (element) => getComputedStyle(element, "::before").content,
  );
  expect(painted).toContain(BODY_PLACEHOLDER);
});

test("syncs panel text and a caret to a peer's canvas card", async ({ browser }) => {
  const contextA = await browser.newContext({ storageState: ACCOUNT_STATE });
  const contextB = await browser.newContext({ storageState: ACCOUNT_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = hostedUrl(workspaceUrl("two-clients"));
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
