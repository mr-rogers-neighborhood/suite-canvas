import { expect, type Locator, type Page, test } from "@playwright/test";
import { selectCard } from "../../interactions";
import { cards, workspaceIdFactory } from "../fixtures/support";

/**
 * Recording is a purpose that writes (ADR-0064 §9): entering it brings the tour
 * it will fill, and a click on a card is a step rather than a selection. These
 * tests assert what landed in the tutorial's body, because the control cannot
 * tell a recorded step from a selected card on its own.
 */

const id = workspaceIdFactory("e2e-record");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

const purpose = (page: Page) => page.getByTestId("purpose-toggle");
const library = (page: Page) => page.getByTestId("library-drawer");
const overlay = (page: Page) => page.getByTestId("tour-overlay");
const stepCount = (page: Page) => page.getByTestId("tutorial-step-count");
const stepRows = (page: Page) => page.getByTestId("tutorial-step-row");
const inspector = (page: Page) => page.getByTestId("card-inspector");
const cardById = (page: Page, cardId: string): Locator =>
  page.locator(`[data-testid="node-card"][data-node-id="${cardId}"]`);

/**
 * Titles a seeded card through the same title overlay a reader uses. The steps a
 * recording writes name their targets by title, so a titled card is what makes
 * "this step points at that card" assertable at all.
 */
async function renameCard(page: Page, card: Locator, title: string): Promise<void> {
  await card.getByRole("button", { name: "Edit card title" }).dblclick();
  const focusedTitle = page.locator(".card-title-editor.ProseMirror-focused");
  await expect(focusedTitle).toHaveCount(1);
  await page.keyboard.type(title);
  // A title commits on Enter: it is single-line, and Escape belongs to the canvas
  // rather than the editor, so pressing it here would leave the caret in place.
  await page.keyboard.press("Enter");
  await expect(focusedTitle).toHaveCount(0);
}

/** Enters `record` the way the control walks it: through `run`, then out of the drawer. */
async function enterRecord(page: Page): Promise<void> {
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
  await page.getByTestId("dock-library").click();
  await expect(library(page)).toHaveCount(0);
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "record");
}

/**
 * Walk the purpose control back to the resting state.
 *
 * The cycle is four values wide now (explore → run → record → explain → explore), so
 * leaving record takes two clicks and passes through `explain` on the way. The steps
 * that follow need explore: a click there is a selection, not a captured step.
 */
async function leaveToExplore(page: Page): Promise<void> {
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explain");
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
}

/** The Steps list of the tour recording fills, opened through its own card. */
async function openSteps(page: Page, tourCard: Locator): Promise<void> {
  await tourCard.getByTestId("card-type").click();
  await page.getByTestId("card-panel-tab-content").click();
  await expect(page.getByTestId("tutorial-steps")).toBeVisible();
}

test("a click while recording is a step of the tour it opened", async ({ page }) => {
  await page.goto(workspaceUrl("steps"));
  await expect(cards(page)).toHaveCount(2);
  const first = await cards(page).nth(0).getAttribute("data-node-id");
  const second = await cards(page).nth(1).getAttribute("data-node-id");
  if (!first || !second) throw new Error("the seeded cards have no ids");
  await renameCard(page, cardById(page, first), "Alpha");
  await renameCard(page, cardById(page, second), "Beta");

  await enterRecord(page);

  // Record brings its destination: one tutorial card, its Steps list open and
  // empty. Two entries must not mint two cards, so this is also the count check.
  await expect(cards(page)).toHaveCount(3);
  const tourCard = page
    .locator('[data-testid="node-card"]')
    .filter({ has: page.getByRole("button", { name: "Card type: Tutorial" }) });
  await expect(tourCard).toHaveCount(1);
  await expect(page.getByTestId("tutorial-steps")).toBeVisible();
  await expect(stepCount(page)).toHaveText("0 steps");

  // The panel is a drawer over the canvas, and the clicks this test records are
  // on the board, so it steps out of the way first.
  await page.getByRole("button", { name: "Close card info" }).click();
  await expect(inspector(page)).toHaveCount(0);

  // Two clicks on two cards are two steps — and no card is selected by them.
  await selectCard(page, cardById(page, first));
  await selectCard(page, cardById(page, second));
  await expect(inspector(page)).toHaveCount(0);

  await openSteps(page, tourCard);
  await expect(stepCount(page)).toHaveText("2 steps");
  await expect(stepRows(page)).toHaveCount(2);
  // The steps name the cards that were clicked, in the order they were clicked.
  await expect(stepRows(page).nth(0)).toContainText("Alpha");
  await expect(stepRows(page).nth(1)).toContainText("Beta");

  // Leaving the purpose ends the capture but keeps what it wrote: the cycle goes
  // record → explain → explore, and it never passes through `present`, which belongs
  // to a tour and to the reader who opens one (ADR-0064 §10, §11).
  await leaveToExplore(page);
  await expect(overlay(page)).toHaveCount(0);

  // Explore means a click is a selection again, and the tour is untouched.
  await selectCard(page, cardById(page, first));
  await expect(inspector(page)).toBeVisible();
  await page.getByRole("button", { name: "Close card info" }).click();
  await openSteps(page, tourCard);
  await expect(stepCount(page)).toHaveText("2 steps");
});

test("a second entry opens the tour it already has instead of a second card", async ({ page }) => {
  await page.goto(workspaceUrl("reopen"));
  await expect(cards(page)).toHaveCount(2);

  await enterRecord(page);
  await expect(cards(page)).toHaveCount(3);
  await expect(stepCount(page)).toHaveText("0 steps");

  // Out of record and back in: the board keeps one tutorial, because the steps
  // of one timeline cannot be split across two cards.
  await leaveToExplore(page);

  await enterRecord(page);
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByTestId("tutorial-steps")).toBeVisible();
  await expect(stepCount(page)).toHaveText("0 steps");
});
