import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the A10 marquee regression specs.
 *
 * A marquee test needs a board it can reason about: a known number of cards at
 * known screen positions, so "the box only touches card 1" means exactly that.
 * Seed cards are created through the dock and dragged into a grid, because the
 * app has no fixture URL and inventing one would exercise a path users do not
 * take.
 */

export const cards = (page: Page) => page.locator('[data-testid="node-card"]');
export const selectedNodes = (page: Page) => page.locator(".react-flow__node.selected");

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const viewportTransform = (page: Page) =>
  page.evaluate(
    () => (document.querySelector(".react-flow__viewport") as HTMLElement | null)?.style.transform,
  );

/**
 * Waits until the viewport transform stops changing. React Flow fits the view
 * to the first card, and a drag or a measurement taken mid-animation is off by
 * the difference between the two scales.
 */
export async function settleViewport(page: Page): Promise<void> {
  // Long enough that a fit animation scheduled by the previous card has begun.
  await page.waitForTimeout(350);
  let previous = await viewportTransform(page);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.waitForTimeout(120);
    const next = await viewportTransform(page);
    if (next === previous && next !== undefined) return;
    previous = next;
  }
}

/** The viewport scale React Flow is currently painting at. */
async function viewportScale(page: Page): Promise<number> {
  const transform = await viewportTransform(page);
  const match = transform ? /scale\(([\d.]+)\)/.exec(transform) : null;
  return match?.[1] ? Number(match[1]) : 1;
}

/**
 * React Flow fits the view to the first card at up to `maxZoom`, which renders
 * one card 448 px wide — three of those do not fit a test viewport. Zoom out
 * until a card is a small, precisely clickable target.
 */
async function fitCards(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await viewportScale(page)) <= 0.8) return;
    const point = await emptyPanePoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(250);
  }
}

async function boardBox(page: Page): Promise<Box> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  return box;
}

/** Somewhere on the pane with no node, panel or overlay under it. */
export async function emptyPanePoint(page: Page): Promise<Point> {
  const box = await boardBox(page);
  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.9; fy > 0.1; fy -= 0.05) {
        for (let fx = 0.5; fx < 0.95; fx += 0.05) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          const element = document.elementFromPoint(offsetX + x, offsetY + y);
          if (element?.closest(".react-flow__pane")) return { x: offsetX + x, y: offsetY + y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

/** Cards of the board, in the order the grid places them. */
export function cardByTitle(page: Page, title: string) {
  return cards(page).filter({ hasText: title });
}

/**
 * Drags a card by its header to `target`. The header, not the body, because a
 * click into the body opens the rich-text editor instead of the drag surface.
 */
export async function dragCardTo(page: Page, title: string, target: Point): Promise<void> {
  const card = cardByTitle(page, title);
  await expect(card).toHaveCount(1);
  const box = await card.boundingBox();
  if (!box) throw new Error(`card "${title}" is not visible`);
  await page.mouse.move(box.x + 40, box.y + 14);
  await page.mouse.down();
  // React Flow starts the drag on the first move *after* pointer-down, measured
  // from that move; a one-pixel nudge first keeps the remaining delta exact.
  await page.mouse.move(box.x + 42, box.y + 16, { steps: 1 });
  await page.mouse.move(target.x + 42, target.y + 16, { steps: 8 });
  await page.mouse.up();
  // The tolerance absorbs the viewport scale, not a missed drag.
  await expect
    .poll(async () => {
      const moved = await card.boundingBox();
      return moved ? Math.abs(moved.x - target.x) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(6);
}

/** A note from the dock, titled and out of edit mode. */
export async function newNote(page: Page, title: string): Promise<void> {
  const before = await cards(page).count();
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.waitForTimeout(200);
  await page.keyboard.type(title);
  await page.keyboard.press("Escape");
  await expect(cards(page)).toHaveCount(before + 1);
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(0);
}

/** Clears the board's selection without touching the document. */
export async function clearSelection(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const point = await emptyPanePoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(selectedNodes(page)).toHaveCount(0);
}

/**
 * Slot positions for `count` cards, derived from the card size the app actually
 * renders: the fit zoom depends on the first card, so a hard-coded grid would
 * fall off the screen as soon as that changed.
 */
function gridSlots(board: Box, count: number, card: { width: number; height: number }): Point[] {
  const insetX = 48;
  const insetTop = 71;
  const insetBottom = 96;
  const gap = 24;
  const usableWidth = board.width - insetX * 2;
  const usableHeight = board.height - insetTop - insetBottom;
  const fitColumns = Math.max(1, Math.floor((usableWidth + gap) / (card.width + gap)));

  // Columns are chosen so the rows also fit: overlapping cards would make a
  // later drag start on whichever card happens to be on top, which measures the
  // fixture rather than the behaviour. A tall card needs more columns than the
  // width alone suggests.
  let columns = Math.min(count, fitColumns);
  while (columns < count && Math.ceil(count / columns) * (card.height + gap) - gap > usableHeight) {
    if (columns >= count) break;
    if (Math.floor((usableWidth + gap) / (card.width + gap)) < columns + 1) {
      // No room for another column; accept the overlap and let the caller's
      // assertions fail loudly rather than loop forever.
      break;
    }
    columns += 1;
  }

  const rows = Math.ceil(count / columns);
  const stepX = (usableWidth - card.width) / Math.max(columns - 1, 1);
  const stepY = (usableHeight - card.height) / Math.max(rows - 1, 1);
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(board.x + insetX + stepX * (index % columns)),
    y: Math.round(board.y + insetTop + stepY * Math.floor(index / columns)),
  }));
}

/**
 * Seeds `titles.length` cards into a grid and returns their boxes, so a marquee
 * can be aimed at an exact subset.
 */
export async function seedGrid(page: Page, titles: string[]): Promise<Map<string, Box>> {
  const board = await boardBox(page);
  const [firstTitle] = titles;
  if (!firstTitle) return new Map();

  // The first card establishes both the card size and the fitted viewport.
  await newNote(page, firstTitle);
  await settleViewport(page);
  await fitCards(page);
  await settleViewport(page);
  const first = await cardByTitle(page, firstTitle).boundingBox();
  if (!first) throw new Error(`card "${firstTitle}" is not visible`);
  const slots = gridSlots(board, titles.length, first);
  const slot = (index: number): Point => {
    const found = slots[index];
    if (!found) throw new Error(`no grid slot for card ${index}`);
    return found;
  };
  await dragCardTo(page, firstTitle, slot(0));

  for (const [index, title] of titles.slice(1).entries()) {
    await newNote(page, title);
    await dragCardTo(page, title, slot(index + 1));
  }

  await clearSelection(page);
  const boxes = new Map<string, Box>();
  for (const title of titles) {
    const box = await cardByTitle(page, title).boundingBox();
    if (!box) throw new Error(`card "${title}" is not visible`);
    boxes.set(title, box);
  }
  return boxes;
}

/** The tightest screen rectangle containing every given card. */
export function unionOf(boxes: Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The point just outside a card set's top-left corner, which is where a
 * "select everything" marquee has to start: a box drawn from the bottom-right
 * region selects nothing, and reading as "the app is broken" is exactly the
 * confusion this spec exists to remove.
 */
export function envelopeStart(boxes: Box[]): Point {
  const all = unionOf(boxes);
  return { x: Math.max(6, all.x - 24), y: Math.max(50, all.y - 24) };
}

/**
 * The same point, but outside any section region too: a section is a DOM layer
 * over the pane, so a pointer-down there never starts a marquee.
 */
export async function paneStartBefore(page: Page, boxes: Box[]): Promise<Point> {
  const regions = await page.locator('[data-testid^="section-region-"]').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  const all = unionOf([...boxes, ...regions]);
  const candidate = { x: Math.max(6, all.x - 24), y: Math.max(50, all.y - 24) };
  const onPane = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".react-flow__pane")),
    candidate,
  );
  if (onPane) return candidate;
  // A section that reaches the viewport edge leaves no room above or left of the
  // set; the far corner of the pane is the next best start.
  return emptyPanePoint(page);
}

/** Shift-drags a box from just outside the set's top-left to just past its bottom-right. */
export async function marqueeOver(page: Page, boxes: Box[], steps = 16): Promise<void> {
  const all = unionOf(boxes);
  await beginMarquee(
    page,
    await paneStartBefore(page, boxes),
    { x: all.x + all.width + 12, y: all.y + all.height + 12 },
    steps,
  );
  await finishMarquee(page);
}

/**
 * Shift-drags a marquee from `from` to `to`. The caller decides whether to
 * release, cancel with Escape, or release outside the pane.
 */
export async function beginMarquee(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  await page.keyboard.down("Shift");
  // React Flow reads the selection key from its last render, so a press in the
  // same tick as the keypress is not a selection press yet.
  await page.waitForFunction(() => document.querySelector(".react-flow__pane.selection") !== null);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
}

export async function finishMarquee(page: Page): Promise<void> {
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

/**
 * The page is not blank and still responds: a card click selects it, Control+A
 * selects the board, Escape clears. This is the assertion the bug needed —
 * "the page broke" presented as a blank canvas, not as a thrown assertion.
 */
export async function expectPageInteractive(page: Page, cardCount: number): Promise<void> {
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(cardCount);

  // Keyboard first: React Flow's own selection shortcuts must still reach the
  // board after a marquee, which is where a stuck `marqueeActive` would show.
  await page.keyboard.press("Escape");
  await expect(selectedNodes(page)).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(selectedNodes(page)).toHaveCount(cardCount);
  await page.keyboard.press("Escape");
  await expect(selectedNodes(page)).toHaveCount(0);

  // Then the pointer: clicking a card must still select it and open its panel.
  // Clicking one card *inside* a live multi-selection is React Flow's group-drag
  // surface, so the selection is cleared above before this click. The last card,
  // because the outline panel can open over the first one.
  await cards(page)
    .last()
    .click({ position: { x: 40, y: 14 }, timeout: 5_000 });
  await expect(selectedNodes(page)).toHaveCount(1);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  // Leave the board as it was found: an open panel narrows the canvas, and a
  // later card click would then race the panel instead of testing the board.
  await page.getByTestId("inspector-close").click();
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);
}

/** Console errors and uncaught exceptions seen so far; empty when the page is healthy. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
