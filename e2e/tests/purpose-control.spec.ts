import { expect, type Locator, type Page, test } from "@playwright/test";
import { startBodyEdit } from "../interactions";
import { withOwnerKey } from "./ownerUrl";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-purpose");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

const purpose = (page: Page) => page.getByTestId("purpose-toggle");
const library = (page: Page) => page.getByTestId("library-drawer");
const overlay = (page: Page) => page.getByTestId("tour-overlay");

/**
 * Presses a point that genuinely belongs to a card: an open card grows over its
 * neighbours, so aiming at the centre can land on the card in front.
 */
async function clickCard(page: Page, card: Locator): Promise<void> {
  const box = await card.boundingBox();
  if (!box) throw new Error("the card is not measurable");
  const fractions: Array<[number, number]> = [
    [0.5, 0.5],
    [0.08, 0.08],
    [0.92, 0.08],
    [0.08, 0.92],
    [0.92, 0.92],
    [0.5, 0.06],
    [0.06, 0.5],
  ];
  for (const [fx, fy] of fractions) {
    const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
    const owns = await card.evaluate(
      (element, at) => element.contains(document.elementFromPoint(at.x, at.y)),
      point,
    );
    if (!owns) continue;
    await page.mouse.click(point.x, point.y);
    return;
  }
  throw new Error("every point of the target card is covered");
}

/**
 * Gives a card one step pointing at another. A tour is presentable only once it
 * has a step with a live target, and `present` is refused until a tour exists, so
 * the cycle needs one before it can be walked to the end.
 */
async function authorStep(page: Page, tourCard: Locator, targetTitle: string): Promise<void> {
  await startBodyEdit(page, tourCard);
  await page.keyboard.type("/step");
  await page.getByTestId("slash-option").filter({ hasText: "Tour step" }).click();
  // The block is an atom, so the caret ends up in the text block after it.
  await page.keyboard.press("Enter");

  const block = tourCard.getByTestId("tour-step-block").first();
  await block.getByTestId("tour-step-pick-target").click();
  await clickCard(page, cardByTitle(page, targetTitle));
  await expect(block.getByTestId("tour-step-target")).toContainText(targetTitle);
  await page.keyboard.press("Escape");
}

test("walks explore → run → record → present → explore", async ({ page }) => {
  await page.goto(workspaceUrl("cycle"));
  await expect(cards(page)).toHaveCount(2);

  const tourCardId = await cards(page).nth(1).getAttribute("data-node-id");
  const tourCard = page.locator(`[data-testid="node-card"][data-node-id="${tourCardId}"]`);
  await createNote(page, "Anchor card");
  await authorStep(page, tourCard, "Anchor card");

  // Explore is the resting state: the canvas is the canvas.
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");

  // Run means "I am about to place a set", and the set comes from the library.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
  await expect(library(page)).toBeVisible();
  await expect(page.getByTestId("library-selection")).toBeVisible();

  // Out of the drawer's way before the next purpose needs the canvas.
  await page.getByTestId("dock-library").click();
  await expect(library(page)).toHaveCount(0);

  // Record drops the tour it is about to capture.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "record");
  await expect(page.getByRole("button", { name: "Card type: Tutorial" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // A tour has to exist before the purpose can be entered, so the author opens it.
  await tourCard.getByTestId("card-type").click();
  await page.getByTestId("card-panel-tab-content").click();
  await expect(page.getByTestId("tutorial-steps")).toBeVisible();
  await page.getByTestId("tutorial-present").click();
  await expect(overlay(page)).toHaveCount(1);

  // The caption sits in the corner too, so this click is also the assertion that
  // it clears the widget stack: covering the control would trap a presentation.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "present");

  // Escape is the reader's way out of a takeover, and the purpose follows it:
  // presenting with no tour left is refused on the way in, so it cannot be a
  // state left behind on the way out either.
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveCount(0);
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
});
