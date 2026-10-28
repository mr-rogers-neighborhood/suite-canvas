import { expect, type Page, test } from "@playwright/test";

/**
 * The status cursor (ADR-0064): the reader's pointer only grows a bubble once it
 * has a purpose or a gesture to announce. A plain exploring canvas keeps the
 * ordinary arrow, which is the whole point — a cursor that always talks is a
 * cursor nobody reads.
 */

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-cursor-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

/**
 * Moves the pointer onto the board, away from the pills. Two moves, because a
 * single jump can land before the layer has mounted its listener.
 */
async function pointAtBoard(page: Page): Promise<void> {
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("board not visible");
  const x = board.x + board.width / 2;
  const y = board.y + board.height * 0.66;
  await page.mouse.move(x - 60, y - 40);
  await page.mouse.move(x, y, { steps: 4 });
}

test("an exploring canvas keeps the ordinary arrow", async ({ page }) => {
  await page.goto(workspaceUrl("resting"));
  await expect(cards(page)).toHaveCount(2);

  await pointAtBoard(page);

  // No purpose, no gesture: nothing to say that the arrow does not already say.
  await expect(page.getByTestId("status-cursor")).toHaveCount(0);
});
