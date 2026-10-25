import { expect, type Locator, type Page, test } from "@playwright/test";
import { settleViewport } from "./marquee";
import { withOwnerKey } from "./ownerUrl";
import { cards } from "./support";

/**
 * What a drawn link does to the things around it. A link is a line, but it also
 * sits in a stack of layers: if its hit stroke or its painter order is wrong it
 * steals presses meant for a card, hides under a section, or stops following the
 * node it is attached to. These are the behaviours a user notices as "stuck".
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-behaviour-${name}-${Date.now()}-${++sequence}`);

const dotSelector = '[data-testid="connector-dot"], [data-testid="section-connector-dot"]';
const sectionLinkHit = (page: Page) => page.locator('[data-testid="section-link-hit"]');
const revealOf = (page: Page) =>
  page.locator('[data-testid="node-connectors"][data-revealed="true"]');

async function roomyPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.1; fy < 0.8; fy += 0.02) {
        for (let fx = 0.04; fx < 0.92; fx += 0.02) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          if (x + 360 > width - 4 || y + 320 > height - 4) continue;
          const samples = [
            [x + 3, y + 3],
            [x + 357, y + 3],
            [x + 3, y + 317],
            [x + 357, y + 317],
          ];
          const clear = samples.every(([sx, sy]) => {
            const element = document.elementFromPoint(offsetX + sx, offsetY + sy);
            return Boolean(element?.closest(".react-flow__pane"));
          });
          if (clear) return { x: offsetX + x, y: offsetY + y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );
  if (!point) throw new Error("no room on the pane");
  return point;
}

/**
 * A note on the left, a section holding nothing on the right, and a link from
 * the note's dot to a dot on the section — the case where a card *outside* the
 * section is wired to it.
 */
async function noteLinkedToSection(page: Page) {
  await page.goto(workspaceUrl("outside"));
  await expect(cards(page)).toHaveCount(2);

  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.press("Enter");

  const note = cards(page).first();
  await note.click();
  const section = page.locator(".section-region").first();
  const box = await section.boundingBox();
  if (!box) throw new Error("section is not measurable");

  // Section dots sit on the region's padded edge; hover it so they are up, then
  // drag a link from the note's right dot onto the section's left dot.
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await expect(page.getByTestId("section-connector-dot")).toHaveCount(4);
  const source = await note.locator(dotSelector).nth(1).boundingBox();
  const target = await page.getByTestId("section-connector-dot").nth(3).boundingBox();
  if (!source || !target) throw new Error("a dot is not measurable");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 20, source.y + 20, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  const link = sectionLinkHit(page).first();
  await expect(link).toHaveCount(1);
  // Nothing selected: the link is drawn, not highlighted.
  await page.mouse.click(box.x - 40, box.y + box.height / 2);
  await page.mouse.move(4, 4);
  await settleViewport(page);
  return { note, section, link, box };
}

/** The two drawn ends of a link path, in screen pixels. */
async function pathEnds(
  page: Page,
  selector: string,
): Promise<{ start: { x: number; y: number }; end: { x: number; y: number } }> {
  return page.evaluate((query) => {
    const path = document.querySelector<SVGPathElement>(query);
    if (!path) throw new Error(`no path for ${query}`);
    const matrix = path.getScreenCTM();
    const at = (length: number) => {
      const local = path.getPointAtLength(length);
      const screen = matrix ? new DOMPoint(local.x, local.y).matrixTransform(matrix) : local;
      return { x: screen.x, y: screen.y };
    };
    return { start: at(0), end: at(path.getTotalLength()) };
  }, selector);
}

/** The centre of an element, in screen pixels. */
async function centre(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error("element is not measurable");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const near = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.abs(left.x - right.x) <= 8 && Math.abs(left.y - right.y) <= 8;

/** The middle of a path, in screen pixels, so a press lands on the line itself. */
async function pathMidpoint(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.evaluate((query) => {
    const path = document.querySelector<SVGPathElement>(query);
    if (!path) throw new Error(`no path for ${query}`);
    const matrix = path.getScreenCTM();
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = matrix ? new DOMPoint(point.x, point.y).matrixTransform(matrix) : point;
    return { x: screen.x, y: screen.y };
  }, selector);
}

test("a card outside a section stays clickable, draggable and deselectable", async ({ page }) => {
  test.setTimeout(90_000);
  const { note } = await noteLinkedToSection(page);

  // Selecting the card still works, and reveals its own dots.
  await note.click();
  await expect(revealOf(page)).toHaveCount(1);
  await expect(note.locator(dotSelector).first()).toBeVisible();

  // Clicking empty canvas deselects it.
  const pane = await roomyPoint(page);
  await page.mouse.click(pane.x, pane.y);
  await expect(revealOf(page)).toHaveCount(0);

  // The card moves when dragged by its header, and the link leaves with it: the
  // anchored end is the card's own dot, wherever that dot has moved to.
  const before = await note.boundingBox();
  if (!before) throw new Error("card is not measurable");
  const dot = note.locator(dotSelector).nth(1);
  const dotBefore = await centre(dot);
  await page.mouse.move(before.x + before.width * 0.35, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width * 0.35 + 60, before.y + 96, { steps: 12 });
  await page.mouse.up();
  const moved = await note.boundingBox();
  if (!moved) throw new Error("card vanished");
  expect(Math.abs(moved.y - before.y)).toBeGreaterThan(30);
  const dotAfter = await centre(dot);
  expect(near(dotAfter, dotBefore)).toBe(false);
  await expect
    .poll(
      async () => near((await pathEnds(page, '[data-testid="section-link"]')).start, dotAfter),
      {
        message: "the link did not follow the card",
      },
    )
    .toBe(true);

  // And the line itself is still reachable: a click selects it, a right click
  // opens its menu.
  const mid = await pathMidpoint(page, '[data-testid="section-link-hit"]');
  await page.mouse.click(mid.x, mid.y);
  await expect(page.locator('[data-testid="section-link"].is-selected')).toHaveCount(1);
  await page.mouse.click(mid.x, mid.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
});

test("a link between two cards is selectable, movable and dismissable", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto(workspaceUrl("cards"));
  await expect(cards(page)).toHaveCount(2);

  const source = cards(page).first();
  const target = cards(page).nth(1);
  await source.click();
  const from = await source.locator(dotSelector).nth(1).boundingBox();
  if (!from) throw new Error("source dot is not measurable");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 3 });
  const to = await target.locator(dotSelector).nth(3).boundingBox();
  if (!to) throw new Error("target dot is not measurable");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();

  const edge = page.locator(".react-flow__edge").first();
  await expect(edge).toHaveCount(1);

  // Select it, then dismiss it by clicking the canvas.
  const mid = await pathMidpoint(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(mid.x, mid.y);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  const pane = await roomyPoint(page);
  await page.mouse.click(pane.x, pane.y);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);

  // Its own menu opens on a right click.
  await page.mouse.click(mid.x, mid.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  // Dragging a card carries the link along with it.
  const before = await edge.locator("path").first().getAttribute("d");
  const box = await target.boundingBox();
  if (!box) throw new Error("card is not measurable");
  await page.mouse.move(box.x + box.width * 0.35, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35 + 40, box.y + 92, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => edge.locator("path").first().getAttribute("d")).not.toBe(before);
});
