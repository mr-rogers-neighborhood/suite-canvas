import { expect, type Page, test } from "@playwright/test";
import { beginMarquee, finishMarquee } from "../fixtures/marquee";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards } from "../fixtures/support";

/**
 * A link is selected, moved and deleted like the entities around it, and a link
 * that touches a section is drawn by the canvas rather than by React Flow — so
 * each of those behaviours needs its own check for that kind. Selection also has
 * to span both kinds, because bulk operations work off whatever is selected.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-link-select-${name}-${Date.now()}-${++sequence}`);

const dotSelector = '[data-testid="connector-dot"], [data-testid="section-connector-dot"]';
const cardEdge = (page: Page) => page.locator(".react-flow__edge");
const sectionLink = (page: Page) => page.locator('[data-testid="section-link"]');

/** Screen point genuinely on the drawn line, so a press lands on the link. */
async function pointOnLine(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.evaluate((query) => {
    const path = document.querySelector<SVGPathElement>(query);
    if (!path) throw new Error(`no path for ${query}`);
    const matrix = path.getScreenCTM();
    const total = path.getTotalLength();
    for (let step = 1; step < 40; step += 1) {
      const local = path.getPointAtLength((total * step) / 40);
      const screen = matrix ? new DOMPoint(local.x, local.y).matrixTransform(matrix) : local;
      const hit = document.elementFromPoint(screen.x, screen.y);
      if (
        hit &&
        (hit.classList.contains("react-flow__edge-interaction") ||
          hit.classList.contains("section-link__hit"))
      ) {
        return { x: screen.x, y: screen.y };
      }
    }
    throw new Error("no exposed part of the link");
  }, selector);
}

async function dragDot(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 16, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

const centre = (box: { x: number; y: number; width: number; height: number } | null) => {
  if (!box) throw new Error("cannot measure");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Two cards, the second wrapped in a section, and a link from card 1 into it. */
async function boardWithSectionLink(page: Page, name: string): Promise<void> {
  await page.goto(workspaceUrl(name));
  await expect(cards(page)).toHaveCount(2);
  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  const note = cards(page).first();
  await note.click();
  const region = page.locator(".section-region").first();
  const box = await region.boundingBox();
  if (!box) throw new Error("section is not measurable");
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  const from = await note.locator(dotSelector).nth(1).boundingBox();
  const to = await page.getByTestId("section-connector-dot").nth(3).boundingBox();
  await dragDot(page, centre(from), centre(to));
  await expect(sectionLink(page)).toHaveCount(1);
}

test("a link that touches a section deselects on empty canvas and deletes on Delete", async ({
  page,
}) => {
  await boardWithSectionLink(page, "deselect");

  const point = await pointOnLine(page, '[data-testid="section-link-hit"]');
  await page.mouse.click(point.x, point.y);
  await expect(sectionLink(page)).toHaveClass(/is-selected/);

  // Selecting a link is not a trap: the empty canvas clears it like anything else.
  const pane = await page.getByTestId("canvas-board").boundingBox();
  if (!pane) throw new Error("no pane");
  await page.mouse.click(pane.x + 12, pane.y + pane.height - 12);
  await expect(sectionLink(page)).not.toHaveClass(/is-selected/);

  // And the delete key removes it, now that it can be selected at all.
  await page.mouse.click(point.x, point.y);
  await expect(sectionLink(page)).toHaveClass(/is-selected/);
  await page.keyboard.press("Delete");
  await expect(sectionLink(page)).toHaveCount(0);
});

test("a card link deletes on Delete once selected", async ({ page }) => {
  await page.goto(workspaceUrl("card-delete"));
  await expect(cards(page)).toHaveCount(2);
  const source = cards(page).first();
  await source.click();
  const from = await source.locator(dotSelector).nth(1).boundingBox();
  const to = await cards(page).nth(1).locator(dotSelector).nth(3).boundingBox();
  await dragDot(page, centre(from), centre(to));
  await expect(cardEdge(page)).toHaveCount(1);

  const point = await pointOnLine(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await page.keyboard.press("Delete");
  await expect(cardEdge(page)).toHaveCount(0);
});

test("shift+click selects a section link alongside a card link", async ({ page }) => {
  await page.goto(workspaceUrl("multi"));
  await expect(cards(page)).toHaveCount(2);
  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  // A card-to-card link, then a card-to-section link from the same card.
  const note = cards(page).first();
  await note.click();
  const a = await note.locator(dotSelector).nth(0).boundingBox();
  const b = await note.locator(dotSelector).nth(1).boundingBox();
  const c = await cards(page).nth(0).locator(dotSelector).nth(2).boundingBox();
  await dragDot(page, centre(a), centre(b));
  await expect(cardEdge(page)).toHaveCount(1);
  const region = await page.locator(".section-region").first().boundingBox();
  if (!region) throw new Error("section is not measurable");
  await page.mouse.move(region.x + 8, region.y + region.height / 2);
  const to = await page.getByTestId("section-connector-dot").nth(3).boundingBox();
  await dragDot(page, centre(c), centre(to));
  await expect(sectionLink(page)).toHaveCount(1);

  const edgePoint = await pointOnLine(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);

  const linkPoint = await pointOnLine(page, '[data-testid="section-link-hit"]');
  await page.keyboard.down("Shift");
  await page.mouse.click(linkPoint.x, linkPoint.y);
  await page.keyboard.up("Shift");

  // Both kinds are selected at once, and both go on Delete.
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await expect(sectionLink(page)).toHaveClass(/is-selected/);
  await page.keyboard.press("Delete");
  await expect(cardEdge(page)).toHaveCount(0);
  await expect(sectionLink(page)).toHaveCount(0);
});

test("a selected section link's ends are draggable onto another dot", async ({ page }) => {
  await boardWithSectionLink(page, "endpoint");

  const point = await pointOnLine(page, '[data-testid="section-link-hit"]');
  await page.mouse.click(point.x, point.y);
  await expect(sectionLink(page)).toHaveClass(/is-selected/);

  // Drag the section end onto another dot of the card it already links to: the
  // line follows the pointer while it is held, and lands as a card-to-card link.
  const end = await page.getByTestId("section-link-end-target").boundingBox();
  const target = await cards(page).first().locator(dotSelector).nth(3).boundingBox();
  await page.mouse.move(centre(end).x, centre(end).y);
  await page.mouse.down();
  await page.mouse.move(centre(end).x + 12, centre(end).y + 12, { steps: 3 });
  await expect(page.getByTestId("section-link-end-drag")).toHaveCount(1);
  await page.mouse.move(centre(target).x, centre(target).y, { steps: 12 });
  await page.mouse.up();

  await expect(sectionLink(page)).toHaveCount(0);
  await expect(cardEdge(page)).toHaveCount(1);

  // The drawer reads the ends it landed on, so the write went where the drag went.
  const line = await pointOnLine(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(line.x, line.y);
  await expect(page.getByTestId("link-inspector")).toBeVisible();
  await expect(page.getByTestId("link-end-source")).toContainText("dot 2 of 4");
  await expect(page.getByTestId("link-end-target")).toContainText("dot 4 of 4");
});

test("a marquee across a section link selects it with the entities it touches", async ({
  page,
}) => {
  await boardWithSectionLink(page, "marquee");

  // A box drawn across the middle of the line, avoiding both of its ends: only
  // the span of the link is inside it.
  const mid = await pointOnLine(page, '[data-testid="section-link-hit"]');
  await beginMarquee(page, { x: mid.x - 6, y: mid.y - 90 }, { x: mid.x + 6, y: mid.y + 90 });
  await finishMarquee(page);
  await expect(sectionLink(page)).toHaveClass(/is-selected/);

  // Delete takes it, exactly as clicking it would.
  await page.keyboard.press("Delete");
  await expect(sectionLink(page)).toHaveCount(0);

  // A box that crosses no link leaves the selection empty.
  const empty = { x: 40, y: 120 };
  await beginMarquee(page, empty, { x: empty.x + 40, y: empty.y + 40 });
  await finishMarquee(page);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(0);
  await expect(sectionLink(page).and(page.locator(".is-selected"))).toHaveCount(0);
});

test("a link drawn from a section moves by its section end too", async ({ page }) => {
  await page.goto(workspaceUrl("source-end"));
  await expect(cards(page)).toHaveCount(2);
  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  // Drawn from the section out to a card, so the section holds the source end.
  const region = await page.locator(".section-region").first().boundingBox();
  if (!region) throw new Error("section is not measurable");
  await page.mouse.click(region.x + 8, region.y + region.height / 2);
  const from = await page.getByTestId("section-connector-dot").nth(3).boundingBox();
  const to = await cards(page).first().locator(dotSelector).nth(1).boundingBox();
  await dragDot(page, centre(from), centre(to));
  await expect(sectionLink(page)).toHaveCount(1);

  const point = await pointOnLine(page, '[data-testid="section-link-hit"]');
  await page.mouse.click(point.x, point.y);
  await expect(sectionLink(page)).toHaveClass(/is-selected/);

  // The section end drags onto a card dot like any other end, and the line
  // lands as a card-to-card link.
  const end = await page.getByTestId("section-link-end-source").boundingBox();
  const target = await cards(page).first().locator(dotSelector).nth(3).boundingBox();
  await page.mouse.move(centre(end).x, centre(end).y);
  await page.mouse.down();
  await page.mouse.move(centre(end).x + 12, centre(end).y + 12, { steps: 3 });
  await expect(page.getByTestId("section-link-end-drag")).toHaveCount(1);
  await page.mouse.move(centre(target).x, centre(target).y, { steps: 12 });
  await page.mouse.up();

  await expect(sectionLink(page)).toHaveCount(0);
  await expect(cardEdge(page)).toHaveCount(1);
});
