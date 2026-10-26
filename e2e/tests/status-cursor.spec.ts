import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

/**
 * The status cursor (ADR-0064): the reader's pointer only grows a bubble once it
 * has a purpose or a gesture to announce. A plain exploring canvas keeps the
 * ordinary arrow, which is the whole point — a cursor that always talks is a
 * cursor nobody reads.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-cursor-${name}-${Date.now()}-${++sequence}`);

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

test("the reader's own pointer stays a plain arrow, and the pill says it instead", async ({
  page,
}) => {
  await page.goto(workspaceUrl("thread"));
  await expect(cards(page)).toHaveCount(2);

  const toggle = page.getByTestId("link-mode-toggle");
  await expect(toggle).toHaveAttribute("data-mode", "place");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "thread");

  await pointAtBoard(page);

  // The bubble used to appear here too, repeating the pill under the pointer in the
  // same colours (ADR-0064 amendment). The pill is the statement; the pointer is a
  // pointer.
  await expect(page.getByTestId("status-cursor")).toHaveCount(0);

  // The words are not lost, they are one interaction away: the pill's label names the
  // mode it is in and the mode it would switch to.
  await expect(toggle).toHaveAttribute("data-mode", "thread");
  await expect(toggle).toHaveAttribute("title", /Thread mode/);
});

test("a run's count lives in the widget bar, not on the pointer", async ({ page }) => {
  await page.goto(workspaceUrl("run"));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  await page.getByTestId("library-select-toggle").click();
  await page.getByTestId("library-selection-all").click();

  const selected = Number(
    (await page.getByTestId("library-selection-count").textContent())?.match(/\d+/)?.[0] ?? "0",
  );
  expect(selected).toBeGreaterThan(0);

  await page.getByTestId("library-run-thread").click();
  await expect(page.getByTestId("held-stack")).toBeVisible();

  await pointAtBoard(page);

  // The count lives in the widget bar, where it was always also drawn: with the local
  // cursor withdrawn there is no second copy to keep in step, and the bar is also the
  // place the run is steered from.
  await expect(page.getByTestId("placement-run-count")).toHaveText(`0 / ${selected}`);
  await expect(page.getByTestId("status-cursor")).toHaveCount(0);
});
