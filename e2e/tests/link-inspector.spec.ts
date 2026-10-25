import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards } from "./support";

/**
 * A link is not an entity, so it had no inspector: its controls lived only in a
 * right-click menu, and which two dots it joined could not be read anywhere. The
 * one drawer now shows it, for card-to-card links and for links touching a
 * section alike.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-link-panel-${name}-${Date.now()}-${++sequence}`);

const panel = (page: Page) => page.getByTestId("link-inspector");
const dotSelector = '[data-testid="connector-dot"], [data-testid="section-connector-dot"]';

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

/** Draw a link between two cards' dots by dragging. */
async function linkCards(page: Page): Promise<void> {
  const source = cards(page).first();
  await source.click();
  const from = await source.locator(dotSelector).nth(1).boundingBox();
  const to = await cards(page).nth(1).locator(dotSelector).nth(3).boundingBox();
  if (!from || !to) throw new Error("cannot measure a dot");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 16, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
}

test("a card-to-card link opens the one drawer, and its ends name their dots", async ({ page }) => {
  await page.goto(workspaceUrl("cards"));
  await expect(cards(page)).toHaveCount(2);
  await linkCards(page);

  const point = await pointOnLine(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(point.x, point.y);
  await expect(panel(page)).toBeVisible();
  // Both ends read as a card, with the dot that holds the link.
  await expect(page.getByTestId("link-end-source")).toContainText("dot 2 of 4");
  await expect(page.getByTestId("link-end-target")).toContainText("dot 4 of 4");

  // Menu parity: the path styles are all here, and switching one persists.
  await page.getByTestId("link-path-straight").click();
  await expect(page.getByTestId("link-path-straight")).toHaveAttribute("aria-pressed", "true");
  const straight = await page
    .locator(".react-flow__edge .react-flow__edge-path")
    .first()
    .getAttribute("d");
  expect(straight).not.toContain("C");

  // Direction, and the description with its position along the line.
  await page.getByTestId("link-bidirectional").click();
  await expect(page.getByTestId("link-bidirectional")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("link-description").fill("feeds the plan");
  await page.getByTestId("link-description").blur();
  await expect(page.getByTestId("edge-description")).toHaveText("feeds the plan");

  const before = await page.getByTestId("edge-description-chip").boundingBox();
  await page.getByTestId("link-offset").fill("0.15");
  await expect
    .poll(async () => {
      const box = await page.getByTestId("edge-description-chip").boundingBox();
      return box && before ? Math.round(Math.abs(box.x - before.x)) : 0;
    })
    .toBeGreaterThan(20);

  // Clicking empty canvas closes it, like every other inspecting session.
  const pane = await page.getByTestId("canvas-board").boundingBox();
  if (!pane) throw new Error("no pane");
  await page.mouse.click(pane.x + 12, pane.y + pane.height - 12);
  await expect(panel(page)).toHaveCount(0);
});

test("moving a link end from the drawer re-attaches it to another dot", async ({ page }) => {
  await page.goto(workspaceUrl("move-end"));
  await expect(cards(page)).toHaveCount(2);
  await linkCards(page);

  const point = await pointOnLine(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("link-end-source")).toContainText("dot 2 of 4");

  // Arm the *source* end (its card sits clear of the drawer) and click another
  // of that card's dots. Every dot is revealed while an end waits for a home.
  await page.getByTestId("link-end-source-move").click();
  await expect(page.getByTestId("link-move-hint")).toBeVisible();
  const other = await cards(page).first().locator(dotSelector).nth(0).boundingBox();
  if (!other) throw new Error("no dot to move to");
  await page.mouse.click(other.x + other.width / 2, other.y + other.height / 2);

  // The panel now reads the new dot, and the line still exists.
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("link-end-source")).toContainText("dot 1 of 4");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("a link that touches a section opens the same drawer and names the section end", async ({
  page,
}) => {
  await page.goto(workspaceUrl("section"));
  await expect(cards(page)).toHaveCount(2);
  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  // A link from the first card into the section.
  const note = cards(page).first();
  await note.click();
  const region = page.locator(".section-region").first();
  const box = await region.boundingBox();
  if (!box) throw new Error("section is not measurable");
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  const from = await note.locator(dotSelector).nth(1).boundingBox();
  const to = await page.getByTestId("section-connector-dot").nth(3).boundingBox();
  if (!from || !to) throw new Error("cannot measure");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 16, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="section-link"]')).toHaveCount(1);

  const point = await pointOnLine(page, '[data-testid="section-link-hit"]');
  await page.mouse.click(point.x, point.y);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("link-end-target")).toContainText("Untitled section");
  // Deleting from the drawer removes the drawn line and closes the panel.
  await page.getByTestId("link-delete").click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.locator('[data-testid="section-link"]')).toHaveCount(0);
});
