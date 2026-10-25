import { expect, type Locator, type Page, test } from "@playwright/test";
import { startBodyEdit } from "../interactions";
import { withOwnerKey } from "./ownerUrl";
import { cards, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-tour");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

const overlay = (page: Page) => page.getByTestId("tour-overlay");

/**
 * A card by its *title*, not by any text it contains: a step block shows the
 * title of the thing it points at, so a plain `hasText` would match the tour as
 * well as its target.
 */
const cardTitled = (page: Page, title: string) =>
  cards(page).filter({ has: page.locator(".card-title-editor", { hasText: title }) });

/**
 * Names one of the seeded cards. The seed places two cards apart, so a tour and
 * its target never cover each other the way two fresh notes can.
 */
async function renameCard(page: Page, index: number, title: string): Promise<void> {
  const card = cards(page).nth(index);
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const inspector = page.getByTestId("card-inspector");
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
  await page.keyboard.press("Escape");
  await inspector.getByTestId("inspector-close").click();
  await expect(cardTitled(page, title)).toHaveCount(1);
}

/** Two named cards, one to hold the tour and one to be pointed at. */
async function seedTourBoard(page: Page, tourTitle: string, targetTitle: string): Promise<void> {
  await renameCard(page, 0, targetTitle);
  await renameCard(page, 1, tourTitle);
}
const spotlight = (page: Page) => page.getByTestId("tour-spotlight");

/** Types `/step` at the caret and takes the row the menu offers. */
async function addStepBlock(page: Page): Promise<void> {
  await page.keyboard.type("/step");
  await page.getByTestId("slash-option").filter({ hasText: "Tour step" }).click();
  // The block is an atom, so the caret ends up in the text block after it.
  await page.keyboard.press("Enter");
}

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

/** Arms one block's picker and clicks a card on the canvas to anchor it. */
async function pickTarget(page: Page, block: Locator, targetTitle: string): Promise<void> {
  await block.getByTestId("tour-step-pick-target").click();
  await clickCard(page, cardTitled(page, targetTitle));
  await expect(block.getByTestId("tour-step-target")).toContainText(targetTitle);
}

/** The ring is measured from the DOM, so it lands on the target's own box. */
async function expectRingAround(page: Page, card: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const ring = await spotlight(page).boundingBox();
        const target = await card.boundingBox();
        if (!ring || !target) return "missing box";
        const deltas = [
          Math.abs(ring.x - target.x),
          Math.abs(ring.y - target.y),
          Math.abs(ring.width - target.width),
          Math.abs(ring.height - target.height),
        ];
        return deltas.every((delta) => delta <= 4)
          ? "on target"
          : `off target ${JSON.stringify(deltas)}`;
      },
      { timeout: 5_000 },
    )
    .toBe("on target");
}

/** Today, local: completion is recorded as a calendar day, not an instant. */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

test("presents a tour, spotlights its target and advances to the end", async ({ page }) => {
  await page.goto(workspaceUrl("present"));
  await expect(cards(page)).toHaveCount(2);
  await seedTourBoard(page, "Tour card", "Anchor card");

  const tour = cardTitled(page, "Tour card");
  await startBodyEdit(page, tour);
  await addStepBlock(page);
  await addStepBlock(page);
  await expect(tour.getByTestId("tour-step-block")).toHaveCount(2);

  const first = tour.getByTestId("tour-step-block").nth(0);
  const second = tour.getByTestId("tour-step-block").nth(1);
  await pickTarget(page, first, "Anchor card");
  await pickTarget(page, second, "Tour card");

  // Presenting opens the reader's overlay: the same surface the Steps panel
  // drives, without needing the panel open.
  await first.getByTestId("tour-step-present").click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(page.getByTestId("tour-step-index")).toHaveText("Step 1 of 2");
  await expect(spotlight(page)).toHaveCount(1);
  await expectRingAround(page, cardTitled(page, "Anchor card"));

  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-step-index")).toHaveText("Step 2 of 2");

  // Passing the last step finishes the tour and closes it.
  await page.getByTestId("tour-next").click();
  await expect(overlay(page)).toHaveCount(0);

  // Exit closes without finishing.
  await first.getByTestId("tour-step-present").click();
  await expect(overlay(page)).toHaveCount(1);
  await page.getByTestId("tour-exit").click();
  await expect(overlay(page)).toHaveCount(0);

  // Escape is the reader's way out of anything, and restores their camera.
  await first.getByTestId("tour-step-present").click();
  await expect(overlay(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toHaveCount(0);
});

test("keeps playing when the target is gone, and says so", async ({ page }) => {
  await page.goto(workspaceUrl("tombstone"));
  await expect(cards(page)).toHaveCount(2);
  await seedTourBoard(page, "Tombstone tour", "Fragile target");

  const tour = cardTitled(page, "Tombstone tour");
  await startBodyEdit(page, tour);
  await addStepBlock(page);
  const block = tour.getByTestId("tour-step-block").first();
  await pickTarget(page, block, "Fragile target");

  await block.getByTestId("tour-step-present").click();
  await expect(spotlight(page)).toHaveCount(1);
  await page.getByTestId("tour-exit").click();
  await expect(overlay(page)).toHaveCount(0);

  // Delete the thing the step points at, then play the tour again.
  await cardTitled(page, "Fragile target").getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await expect(cardTitled(page, "Fragile target")).toHaveCount(0);

  await block.getByTestId("tour-step-present").click();
  await expect(overlay(page)).toHaveCount(1);
  await expect(page.getByTestId("tour-tombstone")).toBeVisible();
  await expect(page.getByTestId("tour-step-index")).toHaveText("Step 1 of 1");
  // Nothing to outline, and the tour is still a tour.
  await expect(spotlight(page)).toHaveCount(0);
  await page.getByTestId("tour-next").click();
  await expect(overlay(page)).toHaveCount(0);
});

test("leaves a completion record on the tutorial card", async ({ page }) => {
  await page.goto(workspaceUrl("completion"));
  await expect(cards(page)).toHaveCount(2);
  await seedTourBoard(page, "Finished tour", "Read me");

  const tour = cardTitled(page, "Finished tour");
  await startBodyEdit(page, tour);
  await addStepBlock(page);
  const block = tour.getByTestId("tour-step-block").first();
  await pickTarget(page, block, "Read me");

  await block.getByTestId("tour-step-present").click();
  await page.getByTestId("tour-next").click();
  await expect(overlay(page)).toHaveCount(0);

  // Completion is a workspace value on the card, not localStorage: the Details
  // tab reads it back after the tour has closed (ADR-0054 §9).
  await tour.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const inspector = page.getByTestId("card-inspector");
  await inspector.getByTestId("card-panel-tab-details").click();
  await expect(inspector.getByLabel("Tour read")).toHaveValue(today());
});
