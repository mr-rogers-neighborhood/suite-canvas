import { expect, type Page, test } from "@playwright/test";
import { settleViewport } from "./marquee";
import { withOwnerKey } from "./ownerUrl";

/**
 * A placement run (ADR-0063): an ordered queue of cards, placed in one of four
 * shapes, with ordinary links for the three whose shape is a relationship. A run
 * is gesture state, so these tests assert what landed in the document — placements
 * and links — and that the run itself ends.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-run-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const edges = (page: Page) => page.locator(".react-flow__edge");
const rows = (page: Page) => page.locator("li[data-row-id]");

/** Creates a note from the dock and closes whatever it opened. */
async function createNote(page: Page): Promise<void> {
  const before = await cards(page).count();
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
  await expect(cards(page)).toHaveCount(before + 1);
  await page.keyboard.press("Escape");
}

/**
 * Selects every card and takes the selection off the board. The bulk verb lives in
 * the card context menu, so the press is a right-click on one of the selection.
 */
async function removeAllFromBoard(page: Page): Promise<void> {
  await page.keyboard.press("Control+a");
  const box = await cards(page).first().boundingBox();
  if (!box) throw new Error("no card to press");
  await page.mouse.click(box.x + 40, box.y + 14, { button: "right" });
  await page.getByRole("menuitem", { name: "Remove from board" }).click();
  await expect(cards(page)).toHaveCount(0);
}

/**
 * Fits the whole board in view. A run spreads cards out, and React Flow renders
 * only what is on screen, so counting nodes means seeing them first.
 */
async function fitBoard(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fit View" }).click();
  await settleViewport(page);
}

/** Opens the drawer on a tab and turns selection mode on. */
async function openSelection(page: Page, tab = "cards"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await page.getByTestId("library-select-toggle").click();
}

/**
 * Creates `count` notes and takes every card off the board, so the library holds a
 * queue to place. The seeded cards come too — a run over a set does not care whose
 * cards they are, and the assertions read the real count rather than assuming one.
 */
async function unplaceEverything(page: Page, count: number): Promise<void> {
  const seeded = await cards(page).count();
  for (let index = 0; index < count; index += 1) await createNote(page);
  await expect(cards(page)).toHaveCount(seeded + count);
  await removeAllFromBoard(page);
}

test("threading a selection places a chain and links it, in one undo per card", async ({
  page,
}) => {
  await page.goto(workspaceUrl("thread"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 4);

  await openSelection(page, "inbox");
  await expect(rows(page)).toHaveCount(6);
  await rows(page).nth(0).click();
  await rows(page)
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("library-selection-count")).toHaveText("2 selected");

  await page.getByTestId("library-run-thread").click();
  await fitBoard(page);

  await expect(cards(page)).toHaveCount(2);
  // A thread links each card to the one before it, so two cards are one link.
  await expect(edges(page)).toHaveCount(1);
  // The run reports progress while it lasts, and ends when the queue empties.
  await expect(page.getByTestId("placement-run")).toHaveCount(0);

  // One undo step per card: the second card comes off, then the first.
  await page.keyboard.press("Control+z");
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(1);
  await expect(edges(page)).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(0);
});

test("webbing a selection draws every link from the first card", async ({ page }) => {
  await page.goto(workspaceUrl("web"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 3);
  await openSelection(page, "inbox");

  const total = await rows(page).count();
  await page.getByTestId("library-selection-all").click();
  await expect(page.getByTestId("library-selection-count")).toHaveText(`${total} selected`);
  await page.getByTestId("library-run-web").click();
  await fitBoard(page);

  // Every card is placed, and every spoke leaves the *first* one: a web is n-1
  // links from one origin, not a chain.
  await expect(cards(page)).toHaveCount(total);
  await expect(edges(page)).toHaveCount(total - 1);
  const ends = await page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map((path) => {
      const matrix = path.getScreenCTM();
      const start = path.getPointAtLength(0);
      const point = matrix ? new DOMPoint(start.x, start.y).matrixTransform(matrix) : start;
      return { x: Math.round(point.x), y: Math.round(point.y) };
    }),
  );
  // One distinct starting point, because a web keeps its origin.
  const starts = new Set(
    ends.map((point) => `${Math.round(point.x / 8)}:${Math.round(point.y / 8)}`),
  );
  expect(starts.size).toBe(1);
});

test("a pattern run draws a tree", async ({ page }) => {
  await page.goto(workspaceUrl("pattern"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 3);
  await openSelection(page, "inbox");

  const total = await rows(page).count();
  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-pattern").click();
  await fitBoard(page);

  await expect(cards(page)).toHaveCount(total);
  // A pattern links each card to its parent: a tree of n is n-1 lines, but unlike a
  // web they do not all leave one origin.
  await expect(edges(page)).toHaveCount(total - 1);
});

test("a place run dumps cards and draws no links", async ({ page }) => {
  await page.goto(workspaceUrl("dump"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 3);
  await openSelection(page, "inbox");

  const total = await rows(page).count();
  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-place").click();
  await fitBoard(page);

  await expect(cards(page)).toHaveCount(total);
  // A dump is a dump: the mode whose shape is not a relationship draws nothing.
  await expect(edges(page)).toHaveCount(0);
});

test("a run places one card at a time and can be stopped", async ({ page }) => {
  await page.goto(workspaceUrl("stop"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 4);
  await openSelection(page, "inbox");

  const total = await rows(page).count();
  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-thread").click();
  await fitBoard(page);

  // Every card placed, every one linked to the previous, and the run then ends on
  // its own rather than waiting to be dismissed.
  await expect(cards(page)).toHaveCount(total);
  await expect(edges(page)).toHaveCount(total - 1);
  await expect(page.getByTestId("placement-run")).toHaveCount(0);
});

test("Escape ends a live run instead of placing the rest", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 3);
  await openSelection(page, "inbox");

  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-thread").click();
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(5);

  // Escape is the exit every mode shares: it ends the run and leaves the mode
  // where the verb put it, rather than leaving a queue armed behind it.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("placement-run")).toHaveCount(0);
  await expect(page.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "thread");
});
