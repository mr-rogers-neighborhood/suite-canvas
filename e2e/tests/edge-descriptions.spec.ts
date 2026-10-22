import { expect, type Locator, type Page, test } from "@playwright/test";

type Box = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

/**
 * Each test gets its own document so parallel tests never share CRDT state.
 */
const docUrl = (name: string) => `/?doc=e2e-${name}-${Date.now()}-${crypto.randomUUID()}`;

/**
 * React Flow re-renders nodes (detaching handles) while a second client syncs, so
 * a bounding box read can come back empty. Retry until both are measurable.
 */
async function boxPair(
  first: Locator,
  second: Locator,
  timeout = 5_000,
): Promise<{ source: Box; target: Box }> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const [source, target] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    if (source && target) return { source, target };
    if (Date.now() > deadline) throw new Error("connectors not visible");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Drags a link between two connector dots; the board seeds a two-card document. */
async function connectCards(page: Page): Promise<void> {
  const cards = page.locator('[data-testid="node-card"]');
  await expect(cards).toHaveCount(2);
  const from = cards.nth(0).locator('[data-testid="connector-dot"]').nth(1);
  const to = cards.nth(1).locator('[data-testid="connector-dot"]').nth(3);
  const edge = page.locator(".react-flow__edge");

  await expect(async () => {
    const { source, target } = await boxPair(from, to);
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 14,
    });
    await page.mouse.up();
    await expect(edge).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

/** Screen point on the link stroke, which is where it accepts pointer events. */
async function edgeMidpoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>("path.react-flow__edge-path");
    if (!path) return null;
    const mid = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(mid.x, mid.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
  if (!point) throw new Error("edge missing");
  return point;
}

async function openEdgeMenu(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press("Escape");
    const point = await edgeMidpoint(page);
    await page.mouse.click(point.x, point.y, { button: "right" });
    await expect(page.getByRole("menuitem", { name: "Delete link" })).toBeVisible({
      timeout: 500,
    });
  }).toPass({ timeout: 10_000 });
}

async function writeDescription(page: Page, text: string): Promise<void> {
  const point = await edgeMidpoint(page);
  await page.mouse.dblclick(point.x, point.y);
  const input = page.getByTestId("edge-description-input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
}

test("describes a link inline and keeps the description across a reload", async ({ page }) => {
  await page.goto(docUrl("edge-description"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);

  // Editing cannot leak into canvas shortcuts: Delete must not remove the edge.
  const point = await edgeMidpoint(page);
  await page.mouse.dblclick(point.x, point.y);
  const input = page.getByTestId("edge-description-input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await page.keyboard.type("blocks the plan");
  await page.keyboard.press("Delete");
  await expect(input).toHaveValue("blocks the plan");
  await page.keyboard.press("Enter");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByTestId("edge-description")).toHaveText("blocks the plan");

  // The chip is centred on the arc's label point, not offset by its own size.
  const labelMid = await edgeMidpoint(page);
  const chip = await page.getByTestId("edge-description").boundingBox();
  if (!chip) throw new Error("description not rendered");
  expect(Math.abs(chip.x + chip.width / 2 - labelMid.x)).toBeLessThan(60);
  expect(Math.abs(chip.y + chip.height / 2 - labelMid.y)).toBeLessThan(60);

  // Counter-scaled: zooming the canvas leaves the chip at its screen size.
  await page.mouse.move(labelMid.x, labelMid.y);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const zoomed = await page.getByTestId("edge-description").boundingBox();
  if (!zoomed) throw new Error("description lost after zoom");
  expect(Math.abs(zoomed.width - chip.width)).toBeLessThan(2);
  expect(Math.abs(zoomed.height - chip.height)).toBeLessThan(2);

  await page.reload();
  await expect(page.getByTestId("edge-description")).toHaveText("blocks the plan");
});

test("seeds the editor and restores the description on Escape", async ({ page }) => {
  await page.goto(docUrl("edge-description-escape"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);
  await writeDescription(page, "supports the claim");

  const point = await edgeMidpoint(page);
  await page.mouse.dblclick(point.x, point.y);
  const input = page.getByTestId("edge-description-input");
  await expect(input).toHaveValue("supports the claim");
  // Focused with everything selected, so replacing it is one keystroke.
  await page.keyboard.type("discarded");
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId("edge-description")).toHaveText("supports the claim");
});

test("commits a changed blur, ignores an unchanged one, and clears when emptied", async ({
  page,
}) => {
  await page.goto(docUrl("edge-description-blur"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);
  await writeDescription(page, "draft");

  const chip = page.getByTestId("edge-description");
  const open = async () => {
    const point = await edgeMidpoint(page);
    await page.mouse.dblclick(point.x, point.y);
    await expect(page.getByTestId("edge-description-input")).toBeFocused();
  };
  const clickAway = () => page.getByTestId("canvas-board").click({ position: { x: 12, y: 12 } });

  await open();
  // The seeded text starts selected; End appends rather than replaces.
  await page.keyboard.press("End");
  await page.keyboard.type(" extended");
  await clickAway();
  await expect(chip).toHaveText("draft extended");

  // An untouched editor closes without writing anything.
  await open();
  await clickAway();
  await expect(chip).toHaveText("draft extended");

  // The seeded text is selected, so one Backspace empties the description.
  await open();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expect(chip).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("edits and removes a description from the edge menu", async ({ page }) => {
  await page.goto(docUrl("edge-description-menu"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);
  await writeDescription(page, "first draft");

  await openEdgeMenu(page);
  await page.getByRole("menuitem", { name: "Edit description…" }).click();
  const input = page.getByTestId("edge-description-input");
  await expect(input).toHaveValue("first draft");
  await page.keyboard.type("revised");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("edge-description")).toHaveText("revised");

  await openEdgeMenu(page);
  await page.getByRole("menuitem", { name: "Remove description" }).click();
  await expect(page.getByTestId("edge-description")).toHaveCount(0);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("truncates long descriptions in the label but shows the full text when editing", async ({
  page,
}) => {
  await page.goto(docUrl("edge-description-long"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);

  const long = "a description that is considerably longer than the label can show";
  await writeDescription(page, long);
  const chip = page.getByTestId("edge-description");
  await expect(chip).toHaveText(long);
  const truncated = await chip.evaluate((element) => {
    const text = element.firstElementChild;
    if (!text) return null;
    return text.scrollWidth > text.clientWidth;
  });
  expect(truncated).toBe(true);

  const point = await edgeMidpoint(page);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.getByTestId("edge-description-input")).toHaveValue(long);
  await page.keyboard.press("Escape");
});

test("keeps the rest of the edge menu", async ({ page }) => {
  await page.goto(docUrl("edge-menu-regression"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);

  await openEdgeMenu(page);
  await expect(page.getByRole("menuitem", { name: "Add description…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Path" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Make bidirectional" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete link" })).toBeVisible();
  // Nothing to remove until a description exists.
  await expect(page.getByRole("menuitem", { name: "Remove description" })).toHaveCount(0);
});

test("a peer sees a new description without reloading", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("edge-description-peer");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(0);

  await connectCards(pageA);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);

  await writeDescription(pageA, "shared meaning");
  await expect(pageB.getByTestId("edge-description")).toHaveText("shared meaning");

  await contextA.close();
  await contextB.close();
});
