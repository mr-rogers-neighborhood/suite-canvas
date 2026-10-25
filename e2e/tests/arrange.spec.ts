import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards } from "./support";

/**
 * Arrange is one gesture over a selection: align or distribute the cards that are
 * selected, as one undoable batch, without touching anything else on the board.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-arrange-${name}-${Date.now()}-${++sequence}`);

/** Select every card by pressing one and Shift-pressing the other. */
async function selectAll(page: Page): Promise<void> {
  const all = cards(page);
  await all.first().click();
  await all.nth(1).click({ modifiers: ["Shift"] });
}

async function cardY(page: Page, index: number): Promise<number> {
  const box = await cards(page).nth(index).boundingBox();
  if (!box) throw new Error("card is not measurable");
  return Math.round(box.y);
}

test("align top lines a selection up and one undo restores it", async ({ page }) => {
  await page.goto(workspaceUrl("align"));
  await expect(cards(page)).toHaveCount(2);
  // Two starters sit at the same y; move the second one down first, so there is
  // something to align.
  const second = cards(page).nth(1);
  const box = await second.boundingBox();
  if (!box) throw new Error("card is not measurable");
  await page.mouse.move(box.x + box.width * 0.35, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + 132, { steps: 10 });
  await page.mouse.up();
  const displaced = await cardY(page, 1);

  await selectAll(page);
  await cards(page)
    .nth(1)
    .click({ button: "right", position: { x: 40, y: 14 } });
  await page.getByRole("menuitem", { name: "Arrange" }).hover();
  await expect(page.getByTestId("context-submenu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Align top", exact: true }).click();

  await expect.poll(() => cardY(page, 1)).toBeLessThan(displaced - 60);
  const aligned = await cardY(page, 1);
  expect(Math.abs(aligned - (await cardY(page, 0)))).toBeLessThanOrEqual(2);

  // One undo step puts it back where the drag left it.
  await page.keyboard.press("Control+z");
  await expect.poll(() => cardY(page, 1)).toBeGreaterThan(displaced - 20);
});

test("distribute spaces three cards evenly along a row", async ({ page }) => {
  await page.goto(workspaceUrl("distribute"));
  await expect(cards(page)).toHaveCount(2);
  // A third card on the board, then a row with uneven gaps.
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
  await page.keyboard.press("Escape");
  await expect(cards(page)).toHaveCount(3);

  const positions = await cards(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().toJSON()),
  );
  const middle = positions[1];
  if (!middle) throw new Error("no middle card");
  await page.mouse.move(middle.x + middle.width * 0.35, middle.y + 12);
  await page.mouse.down();
  await page.mouse.move(middle.x + middle.width * 0.35 + 90, middle.y + 12, { steps: 10 });
  await page.mouse.up();

  const before = await cards(page).evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().x)),
  );
  const spread = Math.max(...before) - Math.min(...before);

  await cards(page).first().click();
  await cards(page)
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await cards(page)
    .nth(2)
    .click({ modifiers: ["Shift"] });
  await cards(page)
    .nth(1)
    .click({ button: "right", position: { x: 40, y: 14 } });
  await page.getByRole("menuitem", { name: "Arrange" }).hover();
  await page.getByRole("menuitem", { name: "Distribute horizontally" }).click();

  // Even spacing means the middle card is centred between the two extremes, and
  // the selection still spans the same width.
  await expect
    .poll(async () => {
      const now = await cards(page).evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().x)).sort((a, b) => a - b),
      );
      return now;
    })
    .not.toEqual(before.sort((a, b) => a - b));
  const after = await cards(page).evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().x)).sort((a, b) => a - b),
  );
  expect(Math.abs((after[2] ?? 0) - (after[0] ?? 0) - spread)).toBeLessThanOrEqual(2);
});

test("Arrange is not offered for a single card", async ({ page }) => {
  await page.goto(workspaceUrl("single"));
  await expect(cards(page)).toHaveCount(2);
  await cards(page).first().click();
  await cards(page)
    .first()
    .click({ button: "right", position: { x: 40, y: 14 } });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Arrange" })).toHaveCount(0);
});
