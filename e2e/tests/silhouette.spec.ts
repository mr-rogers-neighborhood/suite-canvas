import { expect, type Locator, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-silhouette");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

/**
 * The silhouette contract ([ADR-0071](../../docs/decisions/0071-style-is-derived-not-configured.md)).
 *
 * A dot's stored position is a slot on the card's *box*; a rounded card paints an inset
 * edge. Rounding past 6px therefore left a corner dot floating a third of the short side
 * outside the card it belongs to, which is the report this proves fixed.
 *
 * Everything here is measured through the browser — `border-radius`, `--card-radius` and
 * the dot's own box are all resolved by the layout engine, and a unit test reading tokens
 * would be testing something nobody sees.
 */

const card = (page: Page) => cards(page).first();

/** The dot's centre, in pixels relative to the card's border box. */
async function dotCentre(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  const box = await card(page).boundingBox();
  const dot = await target.boundingBox();
  if (!box || !dot) throw new Error("the card or the dot is not measurable");
  return { x: dot.x + dot.width / 2 - box.x, y: dot.y + dot.height / 2 - box.y };
}

/** The radius the card is actually painting. */
async function paintedRadius(page: Page): Promise<number> {
  const radius = await card(page).evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
  );
  return Number.isNaN(radius) ? 0 : radius;
}

/**
 * Puts a dot on the top-left corner slot. Pressing the side of the grab ring that is
 * inside the card is what makes the gesture land: the ring is 24px across and half of it
 * hangs off the node, where the canvas has no grab handle to find.
 */
async function dragTopDotToCorner(page: Page): Promise<void> {
  const face = card(page);
  await face.hover();
  await face.locator('[data-testid="connector"]').first().locator(".connector-dot").click();

  const grab = face.locator('[data-testid="connector-grab"]');
  await expect(grab).toHaveCount(1);
  const handle = await grab.boundingBox();
  const box = await face.boundingBox();
  if (!handle || !box) throw new Error("the grab handle is not measurable");

  const midY = handle.y + handle.height / 2;
  await page.mouse.move(handle.x + 3, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + 3, box.y + 3, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  // Magnetized: the drag snaps the dot onto the corner anchor slot.
  await expect(face.locator('[data-testid="connector"][data-anchored="true"]')).toHaveCount(4);
}

/** Sets the reader preference through the door a reader uses for it. */
async function setRadius(page: Page, radius: number): Promise<void> {
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-appearance").click();
  await page.getByTestId("appearance-radius").fill(String(radius));
  await page.getByTestId("appearance-close").click();
  await expect(card(page)).toHaveCSS("border-top-left-radius", `${radius}px`);
}

test("a corner dot sits on the painted edge at every radius", async ({ page }) => {
  await page.goto(workspaceUrl("corner-dot"));
  await expect(cards(page)).toHaveCount(2);
  await dragTopDotToCorner(page);

  const corner = card(page).locator('[data-testid="connector"][data-anchored="true"]').first();

  // The same measurement at three radii, because the property is the *rule*, not one
  // distance: a rounded corner's visible point is `r - r/√2` in from the two edges that
  // would have met, and r = 0 makes that zero.
  for (const requested of [0, 12, 28]) {
    await setRadius(page, requested);
    await page.waitForTimeout(250);

    const radius = await paintedRadius(page);
    expect(radius).toBe(requested);
    const inset = radius - radius / Math.SQRT2;
    const centre = await dotCentre(page, corner);

    expect(Math.abs(centre.x - inset), `x at r=${radius}`).toBeLessThan(1.5);
    expect(Math.abs(centre.y - inset), `y at r=${radius}`).toBeLessThan(1.5);

    // Which also means it is `radius` away from the arc's centre: on the curve, rather
    // than wherever the box corner happens to be.
    const fromArcCentre = Math.hypot(centre.x - radius, centre.y - radius);
    expect(Math.abs(fromArcCentre - radius), `on the arc at r=${radius}`).toBeLessThan(1.5);
  }
});

test("a side midpoint does not move, whatever the radius is", async ({ page }) => {
  await page.goto(workspaceUrl("midpoints"));
  await expect(cards(page)).toHaveCount(2);

  const face = card(page);
  const box = await face.boundingBox();
  if (!box) throw new Error("the card is not measurable");

  const top = face.locator('[data-testid="connector"][data-side="top"]');
  const before = await dotCentre(page, top);

  await setRadius(page, 28);
  await page.waitForTimeout(250);

  const after = await dotCentre(page, top);
  // The common case is untouched: a correction that moved the midpoints would be a
  // change of geometry rather than a correction of it.
  expect(Math.abs(after.x - before.x)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  expect(after.x).toBeCloseTo(box.width / 2, 0);
});

test("the handle links are routed from moves with the dot", async ({ page }) => {
  await page.goto(workspaceUrl("corner-handle"));
  await expect(cards(page)).toHaveCount(2);
  await setRadius(page, 28);
  await dragTopDotToCorner(page);

  // The dot *is* a React Flow handle, so the thing a link is routed from is the element
  // this correction moves. Asserting the two agree is what makes "the line starts at the
  // dot" true without depending on a drag gesture landing.
  const measured = await page.evaluate(() => {
    const surface = document.querySelector("[data-connector-surface]");
    if (!surface) return null;
    const box = surface.getBoundingClientRect();
    const corner = [...surface.querySelectorAll('[data-testid="connector"]')].find(
      (element) => element.getAttribute("data-anchored") === "true",
    );
    if (!corner) return null;
    const handle = corner.querySelector('[data-testid="connector-dot"]');
    if (!handle) return null;
    const shell = corner.getBoundingClientRect();
    const centre = handle.getBoundingClientRect();
    return {
      radius: parseFloat(getComputedStyle(surface).borderTopLeftRadius),
      shell: {
        x: +(shell.x + shell.width / 2 - box.x).toFixed(2),
        y: +(shell.y + shell.height / 2 - box.y).toFixed(2),
      },
      handle: {
        x: +(centre.x + centre.width / 2 - box.x).toFixed(2),
        y: +(centre.y + centre.height / 2 - box.y).toFixed(2),
      },
    };
  });
  if (!measured) throw new Error("the corner dot is not measurable");

  // The handle sits exactly where the dot is drawn, on the painted arc...
  expect(Math.abs(measured.handle.x - measured.shell.x)).toBeLessThan(1.5);
  expect(Math.abs(measured.handle.y - measured.shell.y)).toBeLessThan(1.5);
  const inset = measured.radius - measured.radius / Math.SQRT2;
  expect(Math.abs(measured.handle.x - inset)).toBeLessThan(1.5);
  // ...and inside the card, which is the whole of the report: a dot on a corner slot used
  // to float off the paint it belongs to.
  expect(measured.handle.x).toBeGreaterThan(0);
  expect(measured.handle.y).toBeGreaterThan(0);
});
