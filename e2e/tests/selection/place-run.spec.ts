import { expect, type Page, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";
import { settleViewport } from "../fixtures/marquee";

/**
 * A placement run (ADR-0063): an ordered queue of cards, placed in one of four
 * shapes, with ordinary links for the three whose shape is a relationship. A run
 * is gesture state, so these tests assert what landed in the document — placements
 * and links — and that the run itself ends.
 *
 * This file runs on the hosted origin with the run's account, like the rest of the
 * gesture suite. On the plain dev origin the relay refuses the join
 * (`Join failed: 2 - Authentication failed`), so the page reports "Not syncing" and
 * carries the storage prompt — chrome that sits over the pane the gestures use.
 * (Moving here removes that chrome; it does not by itself make a held card land —
 * see the note on `placeHeld`.)
 */

test.use({ storageState: ACCOUNT_STATE });

let sequence = 0;
const workspaceUrl = (name: string) =>
  hostedUrl(`/?workspace=e2e-run-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const edges = (page: Page) => page.locator(".react-flow__edge");
/**
 * The library rows a run can actually place.
 *
 * A board is a row too: the inbox lists any board nothing portals to, and selecting
 * one places nothing. A raw row count is therefore one too many as soon as the board
 * the reader is on has no portal of its own, which is exactly the state these tests
 * leave it in — five rows, four cards, and an expectation of five that could never
 * hold.
 */
const placeableRows = (page: Page) =>
  page.locator('li[data-row-id]:not(:has([data-testid^="library-board-state-"]))');

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

/** Puts the held card down at a point on the empty board, away from the drawer. */
async function placeHeld(page: Page, offset: { dx: number; dy: number }): Promise<void> {
  // A plain press, which is what the canvas listens for: the held stack places on
  // `pointerdown`. This is deliberately not "move, then down/up" — that spelling
  // lands the card even when the product drops a click, and the drop is a defect
  // worth keeping visible (the app re-registers its window listener on every
  // render, and a press that arrives during that churn is lost).
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("board not visible");
  await page.mouse.click(
    board.x + board.width / 2 + offset.dx,
    board.y + board.height / 2 + offset.dy,
  );
}

test("a run arms itself: the stack is on the board before the pointer moves", async ({ page }) => {
  await page.goto(workspaceUrl("armed"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 1);
  await openSelection(page, "inbox");
  await page.getByTestId("library-selection-all").click();
  // The pointer is over the drawer, not the board: the run has to put the stack
  // somewhere visible itself, or starting a run looks like nothing happened.
  await page.getByTestId("library-run-thread").click();

  const board = await page.getByTestId("canvas-board").boundingBox();
  const stack = await page.getByTestId("held-stack").boundingBox();
  if (!board || !stack) throw new Error("the stack was not armed");

  expect(Math.abs(stack.x + stack.width / 2 - (board.x + board.width / 2))).toBeLessThan(4);
  expect(Math.abs(stack.y + stack.height / 2 - (board.y + board.height / 2))).toBeLessThan(4);
});

test("a thread is held as a stack and placed one card per click", async ({ page }) => {
  await page.goto(workspaceUrl("thread"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 2);
  await openSelection(page, "inbox");

  const total = await placeableRows(page).count();
  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-thread").click();

  // A thread draws relationships, so nothing is placed for the user: the run holds
  // the stack and says how much of it is left (ADR-0063 third amendment).
  await expect(page.getByTestId("held-stack")).toBeVisible();
  await expect(page.getByTestId("held-stack-count")).toHaveText(`${total} left`);
  // Nothing is placed for the user: an empty board stays empty until they click.
  await expect(cards(page)).toHaveCount(0);

  await placeHeld(page, { dx: -160, dy: -40 });
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("held-stack-count")).toHaveText(`${total - 1} left`);
  await expect(edges(page)).toHaveCount(0);

  await placeHeld(page, { dx: 160, dy: -40 });
  await expect(cards(page)).toHaveCount(2);
  // Two placed cards, one line: a chain links each card to the one before it.
  await expect(edges(page)).toHaveCount(1);

  // Each placement is its own undo, so an interrupted run peels back one at a time.
  await page.keyboard.press("Control+z");
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(1);
});

test("a fan is held too, and every spoke links to the first card", async ({ page }) => {
  await page.goto(workspaceUrl("fan"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 2);
  await openSelection(page, "inbox");

  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-fan").click();
  await expect(page.getByTestId("held-stack")).toBeVisible();

  // The hub first, then spokes on three sides of it: one directly above, one level to
  // its right, one below and to the right.
  await placeHeld(page, { dx: -240, dy: 120 });
  await placeHeld(page, { dx: -240, dy: -140 });
  await placeHeld(page, { dx: 240, dy: 120 });
  await placeHeld(page, { dx: 240, dy: 300 });

  await fitBoard(page);
  await expect(cards(page)).toHaveCount(4);
  // Three spokes and three lines: one per spoke, all leaving the hub. A fourth line
  // would be a chain link, which is the "web" this shape used to draw.
  await expect(edges(page)).toHaveCount(3);
  // A starburst leaves the dot facing each spoke, so the spoke above the hub departs
  // from its top dot while the ones beside it leave its right one.
  const starts = await page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map((path) => {
      const matrix = path.getScreenCTM();
      const start = path.getPointAtLength(0);
      const point = matrix ? new DOMPoint(start.x, start.y).matrixTransform(matrix) : start;
      return `${Math.round(point.x / 8)}:${Math.round(point.y / 8)}`;
    }),
  );
  expect(starts.length).toBe(3);
  expect(new Set(starts).size).toBeGreaterThan(1);
});

/**
 * A fan turned into a web because a click near a placed card's dot was still a link
 * gesture: the press meant for the next card armed a spoke from the card just put down,
 * and the press after it linked the two together.
 *
 * While a run holds cards, every click is a placement. The dots stay visible — they are
 * how a reader sees the shape they are making — but they are not a way to draw.
 */
test("a click on a dot while a run is live places, and draws nothing", async ({ page }) => {
  await page.goto(workspaceUrl("run-dot"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 2);
  await openSelection(page, "inbox");

  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-fan").click();
  await expect(page.getByTestId("held-stack")).toBeVisible();

  await placeHeld(page, { dx: -220, dy: -60 });
  await expect(cards(page)).toHaveCount(1);

  // The one card on the board, by its dot, while two are still in hand.
  const placed = await page.evaluate(() =>
    document
      .querySelector<HTMLElement>('[data-testid="node-card"]')
      ?.closest(".react-flow__node")
      ?.getAttribute("data-id"),
  );
  if (!placed) throw new Error("no card was placed");
  const dot = page.locator(
    `.react-flow__node[data-id="${placed}"] [data-testid="connector"][data-side="right"] [data-testid="connector-dot"]`,
  );
  const box = await dot.boundingBox();
  if (!box) throw new Error("the placed card has no right dot");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Nothing armed, nothing drawn: the hand is full.
  await expect(page.locator('[data-testid="connector"][data-armed="true"]')).toHaveCount(0);
  await expect(edges(page)).toHaveCount(0);

  await placeHeld(page, { dx: 220, dy: -60 });
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(2);
  // Two cards placed, one spoke: the run's own link, and no second one from the dot.
  await expect(edges(page)).toHaveCount(1);
});

test("an arrangement is bulk: one step, one undo, no lines", async ({ page }) => {
  await page.goto(workspaceUrl("dump"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 3);
  await openSelection(page, "inbox");

  const total = await placeableRows(page).count();
  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-place").click();

  // An arrangement makes no claim about relationships, so it is safe to lay out
  // for the user — and it lands in a single undo step.
  await expect(page.getByTestId("held-stack")).toHaveCount(0);
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(total);
  await expect(edges(page)).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await fitBoard(page);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByTestId("dock-inbox-count")).toHaveText(`${total}`);
});

test("Escape releases a held stack", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await expect(cards(page)).toHaveCount(2);
  await unplaceEverything(page, 2);
  await openSelection(page, "inbox");

  await page.getByTestId("library-selection-all").click();
  await page.getByTestId("library-run-thread").click();
  await expect(page.getByTestId("held-stack")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("held-stack")).toHaveCount(0);
  // The mode stays where the verb put it: the run ended, the tool did not.
  await expect(page.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "thread");
});
