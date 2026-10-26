import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectPeersConnected, selectCard } from "../../interactions";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";

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
  // Dots appear on selection; the drag itself reveals the target's dots.
  await selectCard(page, cards.nth(0));
  await expect(cards.nth(0).locator('[data-testid="connector-dot"]')).toHaveCount(4);
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

/** Screen point a fraction of the way along the link, for drag targets and checks. */
async function edgePointAt(page: Page, fraction: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((at) => {
    const path = document.querySelector<SVGPathElement>("path.react-flow__edge-path");
    if (!path) return null;
    const onPath = path.getPointAtLength(path.getTotalLength() * at);
    const matrix = path.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(onPath.x, onPath.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, fraction);
  if (!point) throw new Error("edge missing");
  return point;
}

/** Dragging the chip slides it along the link; a fraction of 0.25 lands a quarter in. */
async function slideLabel(
  page: Page,
  fraction: number,
  settle: () => Promise<void> = async () => {},
): Promise<void> {
  const chip = await page.getByTestId("edge-description-chip").boundingBox();
  if (!chip) throw new Error("label not rendered");
  const target = await edgePointAt(page, fraction);

  await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
  await page.mouse.down();
  // Straight at the line: the chip is centred on it, not lifted above it.
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await settle();
  await page.mouse.up();
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

  // The chip sits on the arc: the line runs into it and its halo opens the gap.
  // Measured on the chip itself, which is what carries the centring transform.
  const labelMid = await edgeMidpoint(page);
  const chip = await page.getByTestId("edge-description-chip").boundingBox();
  if (!chip) throw new Error("description not rendered");
  expect(Math.abs(chip.x + chip.width / 2 - labelMid.x)).toBeLessThan(8);
  expect(Math.abs(chip.y + chip.height / 2 - labelMid.y)).toBeLessThan(8);

  // Counter-scaled: zooming the canvas leaves the chip at its screen size.
  await page.mouse.move(labelMid.x, labelMid.y);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const zoomed = await page.getByTestId("edge-description-chip").boundingBox();
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
  const contextA = await browser.newContext({ storageState: ACCOUNT_STATE });
  const contextB = await browser.newContext({ storageState: ACCOUNT_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = hostedUrl(docUrl("edge-description-peer"));
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  // B must be *live* before A acts: a peer that is still loading its snapshot
  // when the edge is created is asserting on a document it has not read yet,
  // which is a race in the test, not a slow relay.
  await expectPeersConnected(pageA, pageB);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(0);

  await connectCards(pageA);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);

  await writeDescription(pageA, "shared meaning");
  await expect(pageB.getByTestId("edge-description")).toHaveText("shared meaning");

  await contextA.close();
  await contextB.close();
});

test("slides the label along the link and keeps where it landed", async ({ page }) => {
  await page.goto(docUrl("edge-description-slide"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);
  await writeDescription(page, "blocks the plan");

  const before = await page.getByTestId("edge-description-chip").boundingBox();
  if (!before) throw new Error("label not rendered");
  const cardsBefore = await page
    .locator('[data-testid="node-card"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));

  await slideLabel(page, 0.2);

  // The chip lands where it was dropped, on the line at that point.
  const anchor = await edgePointAt(page, 0.2);
  await expect
    .poll(async () => {
      const box = await page.getByTestId("edge-description-chip").boundingBox();
      return box ? Math.round(Math.abs(box.x + box.width / 2 - anchor.x)) : 999;
    })
    .toBeLessThan(10);
  const landed = await page.getByTestId("edge-description-chip").boundingBox();
  if (!landed) throw new Error("label lost after the drag");
  expect(Math.abs(landed.y + landed.height / 2 - anchor.y)).toBeLessThan(10);
  // It really moved along the link rather than the board panning under it.
  expect(Math.abs(landed.x - before.x)).toBeGreaterThan(20);
  const cardsAfter = await page
    .locator('[data-testid="node-card"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  for (const [index, box] of cardsAfter.entries()) {
    expect(Math.round(box.x)).toBe(Math.round(cardsBefore[index]?.x ?? 0));
    expect(Math.round(box.y)).toBe(Math.round(cardsBefore[index]?.y ?? 0));
  }
  await expect(page.getByTestId("edge-description")).toHaveText("blocks the plan");

  // The position belongs to the link, so it survives a reload.
  await page.reload();
  await expect(page.getByTestId("edge-description")).toHaveText("blocks the plan");
  const reloadedAnchor = await edgePointAt(page, 0.2);
  await expect
    .poll(async () => {
      const box = await page.getByTestId("edge-description-chip").boundingBox();
      return box ? Math.round(Math.abs(box.x + box.width / 2 - reloadedAnchor.x)) : 999;
    })
    .toBeLessThan(10);
});

test("a peer sees the label sliding before it is released", async ({ browser }) => {
  const contextA = await browser.newContext({ storageState: ACCOUNT_STATE });
  const contextB = await browser.newContext({ storageState: ACCOUNT_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = hostedUrl(docUrl("edge-description-slide-peer"));
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await connectCards(pageA);
  await writeDescription(pageA, "shared meaning");
  await expect(pageB.getByTestId("edge-description")).toHaveText("shared meaning");

  const beforeB = await pageB.getByTestId("edge-description-chip").boundingBox();
  if (!beforeB) throw new Error("label not rendered for the peer");

  await slideLabel(pageA, 0.2, async () => {
    // Mid-gesture, with nothing written to the document yet: the peer's copy of
    // the label follows in the dragger's colour, with their name on it.
    await expect(pageB.getByTestId("edge-description-chip")).toHaveAttribute(
      "data-peer-name",
      /.+/,
    );
    await expect(pageB.getByTestId("edge-description")).toContainText("shared meaning");
    await expect(pageB.getByTestId("peer-name-tag")).toBeVisible();
    await expect
      .poll(async () => {
        const box = await pageB.getByTestId("edge-description-chip").boundingBox();
        return box ? Math.round(beforeB.x - box.x) : 0;
      })
      .toBeGreaterThan(20);
  });

  // Released: presence clears and the stored offset keeps both clients in step.
  await expect(pageB.getByTestId("edge-description-chip")).not.toHaveAttribute(
    "data-peer-name",
    /.+/,
  );
  await expect(pageB.getByTestId("peer-name-tag")).toHaveCount(0);
  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([
        pageA.getByTestId("edge-description-chip").boundingBox(),
        pageB.getByTestId("edge-description-chip").boundingBox(),
      ]);
      if (!a || !b) return 999;
      return Math.round(Math.abs(a.x - b.x));
    })
    .toBeLessThan(3);

  await contextA.close();
  await contextB.close();
});
