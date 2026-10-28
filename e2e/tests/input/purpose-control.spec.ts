import { expect, type Locator, type Page, test } from "@playwright/test";
import { startBodyEdit } from "../../interactions";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-purpose");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

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
 * has a step with a live target, so a spec that presents one needs this first.
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

/**
 * The control is one button with one choice (ADR-0064 amendment).
 *
 * It used to cycle explore → run → explain, and the modifier map pointed Shift at "run".
 * Both went: a run needs a queue, and only the library has one to give, so offering it
 * here was a mode that sent the reader elsewhere to finish choosing — and a purpose
 * preview on Shift meant holding Shift to *thread* was read as "run". What is left is
 * `explain`, which a reader can choose on its own.
 */
test("turns explain on and off, and offers nothing else", async ({ page }) => {
  await page.goto(workspaceUrl("toggle"));
  await expect(cards(page)).toHaveCount(2);

  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  await expect(library(page)).toHaveCount(0);

  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explain");
  await expect(page.getByTestId("explain-panel")).toBeVisible();
  // Explain is a reading, not a queue: nothing opened a drawer to feed it.
  await expect(library(page)).toHaveCount(0);

  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  await expect(page.getByTestId("explain-panel")).toHaveCount(0);
});

test("a held modifier does not open the library or repaint the purpose", async ({ page }) => {
  await page.goto(workspaceUrl("modifiers"));
  await expect(cards(page)).toHaveCount(2);

  // Shift, Control and Alt belong to the relationship axis. Holding one must not open
  // the library or repaint the purpose button: a modifier is a gesture, not a mode.
  for (const key of ["Shift", "Control", "Alt"]) {
    await page.keyboard.down(key);
    await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
    await expect(library(page)).toHaveCount(0);
    await page.keyboard.up(key);
  }
});

test("presents from the tour card, and the widget is only the exit", async ({ page }) => {
  await page.goto(workspaceUrl("present"));
  await expect(cards(page)).toHaveCount(2);

  const tourCardId = await cards(page).nth(1).getAttribute("data-node-id");
  const tourCard = page.locator(`[data-testid="node-card"][data-node-id="${tourCardId}"]`);
  await createNote(page, "Anchor card");
  await authorStep(page, tourCard, "Anchor card");

  // Double-clicking the tour is the way in: the gesture names a tour by pointing
  // at it, which no mode button can do. Aimed at the card's header, because the
  // body is a live editor that swallows synthetic pointer events.
  await tourCard.dblclick({ position: { x: 8, y: 6 } });
  await expect(overlay(page)).toHaveCount(1);
  await expect(purpose(page)).toHaveAttribute("data-purpose", "present");

  // The widget is the exit, and it stays reachable while presenting: the caption
  // sits right of the widget stack, so covering the control would trap the takeover.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  await expect(overlay(page)).toHaveCount(0);
  // Stopped, not closed: the steps panel is still there, so the reader can carry on.
  await expect(page.getByTestId("tutorial-steps")).toHaveCount(1);
});
