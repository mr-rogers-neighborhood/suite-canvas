import { expect, type Page, test } from "@playwright/test";
import {
  type Box,
  beginMarquee,
  cardByTitle,
  dragCardTo,
  finishMarquee,
  type Point,
  selectedNodes,
  settleViewport,
  watchErrors,
} from "../fixtures/marquee";

let sequence = 0;
/** A blank board: `fresh=1` skips the two starter cards, so counts are exact. */
const workspaceUrl = () => `/?fresh=1&workspace=e2e-marquee-scope-${Date.now()}-${++sequence}`;

const sectionRegion = (page: Page) => page.locator(".section-region").first();

async function boxOf(locator: ReturnType<typeof sectionRegion>): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element is not visible");
  return box;
}

/** Somewhere the pane itself is the topmost element, so a click lands on canvas. */
async function barePanePoint(page: Page): Promise<Point> {
  const point = await page.evaluate(() => {
    const pane = document.querySelector(".react-flow__pane");
    const rect = pane?.getBoundingClientRect();
    if (!rect) return null;
    for (let fy = 0.15; fy < 0.95; fy += 0.05) {
      for (let fx = 0.05; fx < 0.95; fx += 0.05) {
        const x = Math.round(rect.x + rect.width * fx);
        const y = Math.round(rect.y + rect.height * fy);
        if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) {
          return { x, y };
        }
      }
    }
    return null;
  });
  if (!point) throw new Error("no bare pane point");
  return point;
}

/**
 * Clears every selection by clicking bare pane. `emptyPanePoint` is not enough
 * here: the pane contains the viewport, so a point over a section passes its
 * "is this the pane" test and the click lands on the section instead.
 */
async function deselect(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  const point = await barePanePoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(selectedNodes(page)).toHaveCount(0);
}

/** A note from the dock; the blur a caller needs is `deselect`'s job. */
async function addNote(page: Page, title: string): Promise<void> {
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.waitForTimeout(200);
  await page.keyboard.type(title);
  await page.keyboard.press("Escape");
  await expect(cardByTitle(page, title)).toHaveCount(1);
}

/** Selects a card and wraps it in a section, then waits for the frame. */
async function sectionAround(page: Page, title: string): Promise<void> {
  const card = await boxOf(cardByTitle(page, title));
  // The gutter beside the type glyph: a press the card owns. A press in the body
  // starts an editor, and the chord would be typed into it as a letter.
  await page.mouse.click(card.x + 24, card.y + 20);
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-region")).toHaveCount(1);
  await expect(page.locator(".section-header")).toHaveCount(1);
}

/** Which card titles the canvas currently reports as selected. */
async function selectedTitles(page: Page): Promise<string[]> {
  const titles: string[] = [];
  for (const node of await selectedNodes(page).all()) {
    titles.push((await node.locator(".card-title-editor").innerText()).trim());
  }
  return titles.sort();
}

/**
 * Pans the board down until there is room to place a card above the section.
 *
 * Zooming out cannot do this: it eases content toward the viewport centre, so a
 * frame that sits below centre moves *up* as the scale shrinks. Panning changes
 * only the translation, which is the one gesture that buys headroom.
 */
async function roomAbove(page: Page, needed: number): Promise<void> {
  const viewport = await page.evaluate(() => innerHeight);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const frame = await boxOf(sectionRegion(page));
    const missing = needed + 72 - frame.y;
    if (missing <= 0) return;
    const point = await barePanePoint(page);
    // Drag the pane down by what is missing, capped to the pane so the press
    // stays on the canvas.
    const distance = Math.min(missing, viewport / 2);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x, point.y + distance, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  }
  throw new Error("never made room above the section");
}

/**
 * The section frame, zoomed out until the whole of it is on screen. A marquee
 * that has to stay inside the frame needs both of its corners reachable, and a
 * board that fits one card is drawn at a zoom that puts a section off the edge.
 */
async function visibleFrame(page: Page): Promise<Box> {
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const frame = await boxOf(sectionRegion(page));
    const fits =
      frame.x >= 24 &&
      frame.y >= 64 &&
      frame.x + frame.width <= viewport.width - 24 &&
      frame.y + frame.height <= viewport.height - 24;
    if (fits) return frame;
    const point = await barePanePoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(300);
  }
  throw new Error("the section frame never fitted the viewport");
}

test("a marquee begun inside a section selects that section only, until it leaves", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto(workspaceUrl());
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await addNote(page, "Alpha");
  await settleViewport(page);
  await dragCardTo(page, "Alpha", { x: 260, y: 320 });
  await deselect(page);
  await sectionAround(page, "Alpha");

  // Beta is placed so its anchor sits above the frame — it is not a member —
  // while its body dips inside it: a box drawn over the frame touches Beta.
  await addNote(page, "Beta");
  const beta = await boxOf(cardByTitle(page, "Beta"));
  await roomAbove(page, beta.height);
  const seeded = await boxOf(sectionRegion(page));
  await dragCardTo(page, "Beta", {
    x: Math.round(seeded.x + seeded.width / 2 - beta.width / 2),
    y: Math.round(seeded.y - beta.height + 40),
  });
  await expect(page.locator(".section-header")).toContainText("1");
  await deselect(page);

  const frame = await visibleFrame(page);
  const insideStart: Point = { x: frame.x + 8, y: frame.y + frame.height - 8 };
  const insideEnd: Point = { x: frame.x + frame.width - 8, y: frame.y + 8 };

  // A box that starts and ends inside the frame sees only the frame's cards.
  await beginMarquee(page, insideStart, insideEnd);
  await finishMarquee(page);
  await expect.poll(() => selectedTitles(page)).toEqual(["Alpha"]);

  await deselect(page);

  // The same start, but the box leaves the frame: the scope lifts and the card
  // outside comes with it.
  const outside = await boxOf(cardByTitle(page, "Beta"));
  const leavingEnd: Point = { x: insideEnd.x, y: Math.max(64, Math.round(outside.y - 8)) };
  await beginMarquee(page, insideStart, leavingEnd);
  await finishMarquee(page);
  await expect.poll(() => selectedTitles(page)).toEqual(["Alpha", "Beta"]);

  // The pair is one selection, so dragging one card moves the other with it.
  // Grab the card inside the frame: it is the one guaranteed to be on screen
  // after the fit, and a drag needs a real pointer target.
  const grabbed = await boxOf(cardByTitle(page, "Alpha"));
  const betaBefore = await boxOf(cardByTitle(page, "Beta"));
  await page.mouse.move(grabbed.x + 40, grabbed.y + 14);
  await page.mouse.down();
  await page.mouse.move(grabbed.x + 42, grabbed.y + 16, { steps: 1 });
  await page.mouse.move(grabbed.x + 42, grabbed.y + 76, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await boxOf(cardByTitle(page, "Beta"))).y - betaBefore.y))
    .toBeGreaterThan(20);

  expect(errors).toEqual([]);
});
