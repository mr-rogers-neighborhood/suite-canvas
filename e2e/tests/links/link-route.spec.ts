import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards } from "../fixtures/support";

/**
 * A link is a route (ADR-0052): bends are stored on the edge, every path style
 * draws them, and the route survives a reload because it is document data rather
 * than canvas state.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-link-route-${name}-${Date.now()}-${++sequence}`);

const panel = (page: Page) => page.getByTestId("link-inspector");
const dotSelector = '[data-testid="connector-dot"], [data-testid="section-connector-dot"]';
const line = (page: Page) => page.locator(".react-flow__edge .react-flow__edge-path").first();

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
      if (hit?.classList.contains("react-flow__edge-interaction")) {
        return { x: screen.x, y: screen.y };
      }
    }
    throw new Error("no exposed part of the link");
  }, selector);
}

/** Draw a link between two cards' dots by dragging. */
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

/** Select the one link on the board through the drawer it opens. */
async function selectLink(page: Page): Promise<void> {
  const point = await pointOnLine(page, ".react-flow__edge .react-flow__edge-path");
  await page.mouse.click(point.x, point.y);
  await expect(panel(page)).toBeVisible();
}

/** The drawn length of the link, in flow units — bends make it longer. */
async function pathLength(page: Page): Promise<number> {
  return line(page).evaluate((node) => (node as SVGPathElement).getTotalLength());
}

/** Whether the drawn line actually goes through a flow-space point. */
async function passesThrough(page: Page, point: { x: number; y: number }): Promise<boolean> {
  return line(page).evaluate((node, target) => {
    const path = node as SVGPathElement;
    const total = path.getTotalLength();
    for (let step = 0; step <= 240; step += 1) {
      const at = path.getPointAtLength((total * step) / 240);
      if (Math.hypot(at.x - target.x, at.y - target.y) < 2) return true;
    }
    return false;
  }, point);
}

test("adding a bend lengthens the route and survives a reload", async ({ page }) => {
  await page.goto(workspaceUrl("bend"));
  await expect(cards(page)).toHaveCount(2);
  await drawLink(page);
  await selectLink(page);

  const straight = await pathLength(page);
  await expect(page.getByTestId("link-bends-empty")).toBeVisible();

  // One bend, dropped by the panel: the line now bows away from the straight one.
  await page.getByTestId("link-add-bend").click();
  await expect(page.getByTestId("link-bend-0")).toBeVisible();
  await expect
    .poll(async () => Math.round((await pathLength(page)) - straight))
    .toBeGreaterThan(20);

  const bent = await pathLength(page);

  // A document fact, not canvas state: the route comes back after a reload.
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  expect(Math.round((await pathLength(page)) - straight)).toBeGreaterThan(20);

  await selectLink(page);
  await expect(page.getByTestId("link-bend-0")).toBeVisible();
  expect(Math.abs((await pathLength(page)) - bent)).toBeLessThan(1);

  // Removing it puts the line back on its straight route.
  await page.getByTestId("link-bend-remove-0").click();
  await expect(page.getByTestId("link-bends-empty")).toBeVisible();
  await expect
    .poll(async () => Math.round(await pathLength(page)))
    .toBeLessThan(Math.round(straight + 1));
});

test("a bend handle on the selected line is draggable and commits once", async ({ page }) => {
  await page.goto(workspaceUrl("handle"));
  await expect(cards(page)).toHaveCount(2);
  await drawLink(page);
  await selectLink(page);
  await page.getByTestId("link-add-bend").click();

  const handle = page.getByTestId("route-bend-0");
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("no bend handle");
  const before = await pathLength(page);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 50, { steps: 8 });
  await page.mouse.up();

  // The drag moved the bend, and the document holds one bend afterwards.
  await expect
    .poll(async () => Math.round(Math.abs((await pathLength(page)) - before)))
    .toBeGreaterThan(10);
  await expect(page.getByTestId("link-bends")).toHaveAttribute("data-count", "1");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("the avoid mode is stored, survives a reload, and bends still win", async ({ page }) => {
  await page.goto(workspaceUrl("avoid"));
  await expect(cards(page)).toHaveCount(2);
  await drawLink(page);
  await selectLink(page);

  const avoid = page.getByTestId("link-path-avoid");
  await expect(avoid).toBeVisible();
  await expect(avoid).toBeEnabled();

  // `avoid` is one more value of the stored path enum (ADR-0052 §6): picked here,
  // it is a document fact, and the link still renders. Two cards that neither
  // obstruct the line leave the router with nothing to do, and the documented
  // fallback — the plain curve — is what the reader sees.
  await avoid.click();
  await expect(avoid).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(line(page)).toHaveAttribute("d", /^M/);
  const routedFallback = await pathLength(page);

  // Bends win: a hand-drawn route is never silently re-routed, so the bend is
  // still on the line while the mode is `avoid` — and after a reload, where the
  // mode is a document fact and the bend rides with it.
  await page.getByTestId("link-add-bend").click();
  await expect(page.getByTestId("link-bend-0")).toBeVisible();
  const handle = await page.getByTestId("route-bend-0").evaluate((node) => ({
    x: Number(node.getAttribute("cx")),
    y: Number(node.getAttribute("cy")),
  }));
  expect(await passesThrough(page, handle)).toBe(true);
  expect(Math.round((await pathLength(page)) - routedFallback)).toBeGreaterThan(20);

  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await selectLink(page);
  await expect(page.getByTestId("link-path-avoid")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("link-bend-0")).toBeVisible();
  const restored = await page.getByTestId("route-bend-0").evaluate((node) => ({
    x: Number(node.getAttribute("cx")),
    y: Number(node.getAttribute("cy")),
  }));
  expect(await passesThrough(page, restored)).toBe(true);
});

test("the layer toggle raises the link and isolate dims the rest of the board", async ({
  page,
}) => {
  await page.goto(workspaceUrl("layer"));
  await expect(cards(page)).toHaveCount(2);
  await drawLink(page);
  await selectLink(page);

  // `above` is a layer of its own: React Flow has one edge layer, so an elevated
  // link is drawn by the above layer instead of being raised in place.
  await page.getByTestId("link-layer-above").click();
  await expect(page.getByTestId("link-layer-above")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("above-link")).toHaveCount(1);

  // Isolate dims everything but this link, through the body attribute the
  // inspector sets — cards belong to a surface a route does not own.
  await page.getByTestId("link-isolate").click();
  await expect(page.getByTestId("link-isolate")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.isolateEdge ?? null))
    .not.toBeNull();
  const dimmed = await cards(page)
    .first()
    .evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(dimmed).toBeLessThan(0.6);

  // Turning it off gives the board back.
  await page.getByTestId("link-isolate").click();
  await expect
    .poll(() => page.evaluate(() => document.body.dataset.isolateEdge ?? null))
    .toBeNull();
  const restored = await cards(page)
    .first()
    .evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(restored).toBe(1);
});
