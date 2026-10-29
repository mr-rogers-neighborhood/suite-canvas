import { expect, type Page, test } from "@playwright/test";
import { selectCard } from "../fixtures/support";

/**
 * The paint system (ADR-0051): one style record over every surface, written
 * through the document so a reload — and a collaborator — sees the same paint.
 * Roles are stored, never colour values, which is what lets a theme move them.
 */

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-style-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const dotSelector = '[data-testid="connector-dot"], [data-testid="section-connector-dot"]';

/**
 * One paint custom property as the browser resolved it. Read from the variables
 * rather than the box: a silhouette paints on an underlay (`::before`), so the
 * element's own `clip-path` stays `none` while a diamond is what you see.
 */
async function paintVar(page: Page, selector: string, name: string): Promise<string> {
  return page.evaluate(
    ({ query, prop }) => {
      // Empty while the surface is not on screen yet: a poll retries an assertion
      // but aborts on a throw, and a reload boots the board before it paints.
      const element = document.querySelector<HTMLElement>(query);
      return element ? getComputedStyle(element).getPropertyValue(prop).trim() : "";
    },
    { query: selector, prop: name },
  );
}

/** Open the card panel on the Style tab, where every surface's paint is edited. */
async function openStyleTab(page: Page): Promise<void> {
  await page.getByTestId("card-panel-tab-style").click();
  await expect(page.getByTestId("style-tab")).toBeVisible();
}

/** Draw one link between the seeded pair of cards. */
async function drawLink(page: Page): Promise<void> {
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

test("a card keeps its silhouette and side paint across a reload", async ({ page }) => {
  await page.goto(workspaceUrl("card"));
  await expect(cards(page)).toHaveCount(2);

  await cards(page).first().click();
  await openStyleTab(page);
  await page.getByTestId("style-shape-diamond").click();
  await page.getByTestId("style-side-top-dashed").click();
  await expect(page.getByTestId("style-side-top-dashed")).toHaveAttribute("data-checked", "true");

  await expect
    .poll(() => paintVar(page, '[data-testid="node-card"]', "--paint-clip"))
    .toContain("polygon");
  // The stored value is a role, so the border is whatever the theme says it is.
  expect(await paintVar(page, '[data-testid="node-card"]', "--paint-border-top")).toContain(
    "dashed",
  );

  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect
    .poll(() => paintVar(page, '[data-testid="node-card"]', "--paint-clip"))
    .toContain("polygon");
  expect(await paintVar(page, '[data-testid="node-card"]', "--paint-border-top")).toContain(
    "dashed",
  );
});

test("a link keeps its own stroke, and paints it in the document, across a reload", async ({
  page,
}) => {
  await page.goto(workspaceUrl("link"));
  await expect(cards(page)).toHaveCount(2);
  await drawLink(page);

  const path = page.locator(".react-flow__edge-path").first();
  // An unstyled link is a solid accent line.
  expect(await paintVar(page, ".react-flow__edge-path", "stroke-dasharray")).toBe("none");

  const point = await page.evaluate(() => {
    const element = document.querySelector<SVGPathElement>(".react-flow__edge-path");
    if (!element) throw new Error("no link");
    const matrix = element.getScreenCTM();
    const middle = element.getPointAtLength(element.getTotalLength() / 2);
    const screen = matrix ? new DOMPoint(middle.x, middle.y).matrixTransform(matrix) : middle;
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("link-inspector")).toBeVisible();

  // A link has one stroke, so the drawer offers a line style rather than sides.
  await expect(page.getByTestId("style-shape-diamond")).toHaveCount(0);
  await page.getByTestId("style-line-paint-dashed").click();
  await expect(page.getByTestId("style-line-paint-dashed")).toHaveAttribute("data-checked", "true");
  await expect
    .poll(() => paintVar(page, ".react-flow__edge-path", "stroke-dasharray"))
    .not.toBe("none");
  expect(await path.getAttribute("style")).toContain("stroke-dasharray");

  await page.reload();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect
    .poll(() => paintVar(page, ".react-flow__edge-path", "stroke-dasharray"))
    .not.toBe("none");
});

test("a section is painted from its own panel", async ({ page }) => {
  await page.goto(workspaceUrl("section"));
  await expect(cards(page)).toHaveCount(2);

  // A section is an identity, so its paint lives in the container panel
  // (ADR-0040), one tab away from its members and links.
  await selectCard(page);
  await page.keyboard.press("Control+g");
  const section = page.locator(".section-region").first();
  await expect(section).toBeVisible();
  // A named section is the one that survives: an untitled draft is a section the
  // user never finished making.
  await page.keyboard.type("Painted");
  await page.keyboard.press("Enter");
  await expect(page.locator(".section-header")).toContainText("Painted");

  // Clicking the section's own frame selects it, which is what opens its panel.
  await section.click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId("container-inspector")).toBeVisible();

  await page.getByTestId("container-tab-style").click();
  await page.getByTestId("style-side-left-dotted").click();
  await expect(page.getByTestId("style-side-left-dotted")).toHaveAttribute("data-checked", "true");

  await expect
    .poll(() => paintVar(page, ".section-region", "--paint-border-left"))
    .toContain("dotted");
  await page.reload();
  await expect
    .poll(() => paintVar(page, ".section-region", "--paint-border-left"))
    .toContain("dotted");
});
