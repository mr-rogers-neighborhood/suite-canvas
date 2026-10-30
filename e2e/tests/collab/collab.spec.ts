import { type BoundingBox, expect, type Locator, type Page, test } from "@playwright/test";
import { expectPeersConnected } from "../../interactions";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";

/**
 * Finds a point on the React Flow pane with no node or control panel under it,
 * so right-clicking opens the canvas menu rather than a node menu.
 */
async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");

  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.12; fy < 0.95; fy += 0.08) {
        for (let fx = 0.12; fx < 0.95; fx += 0.08) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          const element = document.elementFromPoint(offsetX + x, offsetY + y);
          if (!element) continue;
          if (element.closest('[data-testid="node-card"]')) continue;
          if (element.closest(".react-flow__panel")) continue;
          if (element.closest(".react-flow__pane")) return { x: offsetX + x, y: offsetY + y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );

  if (!point) throw new Error("no empty canvas point found");
  return point;
}

async function createNote(page: Page): Promise<void> {
  const point = await emptyCanvasPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "New card" }).click();
  // New cards focus their title; waiting for that focus (and for two frames, so
  // ProseMirror has painted) keeps the first keystrokes from racing the mount.
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  // React StrictMode remounts the editor once in dev; let the focused instance
  // settle so the first keystrokes cannot land in the discarded one.
  await page.waitForTimeout(300);
}

const editingCard = (page: Page) =>
  page.locator('[data-testid="node-card"]:has([contenteditable="true"])');

// Every test here needs the relay, and the relay accepts one credential: the
// session JWT the run's sign-in mints (ADR-0074, ADR-0076). `storageState` is
// merged into every context Playwright creates, so the two-browser tests get two
// browsers of the same account without either of them filling in a form.
test.use({ storageState: ACCOUNT_STATE });

/**
 * Each test gets its own document so parallel tests never share CRDT state. The
 * random suffix keeps repeats of the same test apart even when two workers start
 * in the same millisecond.
 */
const docUrl = (name: string) =>
  hostedUrl(`/?doc=e2e-${name}-${Date.now()}-${crypto.randomUUID()}`);

test("creates, edits, and deletes a note", async ({ page }) => {
  await page.goto(docUrl("create-edit-delete"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await createNote(page);
  await expect(editingCard(page).locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("note to delete");

  const created = page.locator('[data-testid="node-card"]').filter({ hasText: "note to delete" });
  await expect(created).toHaveCount(1);

  await created.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete card" }).click();
  await expect(page.getByText("note to delete")).toHaveCount(0);
});

test("deletes the selected note with the keyboard", async ({ page }) => {
  await page.goto(docUrl("keyboard-delete"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await createNote(page);
  await page.keyboard.type("keyboard delete");
  await page.keyboard.press("Escape");

  const created = page.locator('[data-testid="node-card"]').filter({ hasText: "keyboard delete" });
  await created.click({ position: { x: 40, y: 14 } });
  await page.keyboard.press("Delete");
  // Delete removes the placement, not the card; the inspector keeps showing it.
  // Count cards, not everything that carries a node id: a card's connector layer
  // carries one too, so `[data-node-id]` doubles the count.
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await expect(page.getByTestId("card-inspector")).toContainText("In the inbox");
});

test("undoes and redoes a card move with the keyboard", async ({ page }) => {
  await page.goto(docUrl("undo-move"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createNote(page);
  await page.keyboard.type("undo move");
  await page.keyboard.press("Escape");

  const card = page.locator('[data-testid="node-card"]').filter({ hasText: "undo move" });
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  const start = { x: box.x + box.width / 2, y: box.y + 12 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 180, start.y + 120, { steps: 12 });
  await page.mouse.up();

  const moved = await card.boundingBox();
  if (!moved) throw new Error("card lost");
  expect(Math.round(moved.x)).toBeGreaterThan(Math.round(box.x) + 120);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Math.round((await card.boundingBox())?.x ?? 0))
    .toBeLessThanOrEqual(Math.round(box.x) + 4);

  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => Math.round((await card.boundingBox())?.x ?? 0))
    .toBeGreaterThan(Math.round(box.x) + 120);
});

test("undoes a removal from the board, not the editor text", async ({ page }) => {
  await page.goto(docUrl("undo-scope"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createNote(page);
  await page.keyboard.type("scoped undo");
  await page.keyboard.press("Escape");

  // Inside the editor, undo belongs to the editor's own fragment history.
  const card = page.locator('[data-testid="node-card"]').filter({ hasText: "scoped undo" });
  const body = card.getByTestId("card-body").locator(".ProseMirror");
  await card.getByTestId("card-body").click();
  await expect(body).toHaveClass(/ProseMirror-focused/);
  await page.keyboard.type("body text");
  await expect(body).toHaveText("body text");

  await page.keyboard.press("Control+z");
  await expect(body).toHaveText("");
  // Structure stayed put: the editor's history is scoped to its own fragment.
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(3);
  await page.keyboard.press("Escape");

  // On the canvas it covers structure: removing a card from the board.
  await card.click({ position: { x: 40, y: 14 } });
  await page.keyboard.press("Delete");
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(3);
  await expect(
    page.locator('[data-testid="node-card"]').filter({ hasText: "scoped undo" }),
  ).toBeVisible();
});

test("manages connectors: add, magnetize, reposition, delete", async ({ page }) => {
  await page.goto(docUrl("connectors"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const card = page.locator('[data-testid="node-card"]').first();
  const connectors = card.locator('[data-testid="connector"]');
  await expect(connectors).toHaveCount(4);

  // Each connector declares the card side it sits on, so edges leave and enter
  // perpendicular to the perimeter instead of hooking in from above.
  await expect(connectors).toHaveCount(4);
  const sides = await connectors.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-side")),
  );
  expect(sides).toEqual(["top", "right", "bottom", "left"]);

  // Connectors sit exactly on the card perimeter (top, right, bottom, left).
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("card not visible");
  const dots = card.locator('[data-testid="connector-dot"]');
  const expected = [
    { x: cardBox.width / 2, y: 0 },
    { x: cardBox.width, y: cardBox.height / 2 },
    { x: cardBox.width / 2, y: cardBox.height },
    { x: 0, y: cardBox.height / 2 },
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const dotBox = await dots.nth(index).boundingBox();
    if (!dotBox) throw new Error("connector dot not visible");
    const offsetX = Math.abs(dotBox.x + dotBox.width / 2 - (cardBox.x + expected[index].x));
    const offsetY = Math.abs(dotBox.y + dotBox.height / 2 - (cardBox.y + expected[index].y));
    expect(offsetX).toBeLessThan(4);
    expect(offsetY).toBeLessThan(4);
  }

  // Add a connector from the node menu.
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add connector" }).click();
  await expect(connectors).toHaveCount(5);

  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");

  // Clicking a connector reveals the grab handle (dragging the dot is reserved
  // for making connections). Dots only show while the card is hovered or
  // selected, so the pointer has to come to the card first.
  await card.hover();
  await connectors.first().locator(".connector-dot").click();
  const grab = card.locator('[data-testid="connector-grab"]');
  await expect(grab).toHaveCount(1);

  // Grab the ring itself (its centre is the dot, which starts a connection).
  // The ring is 24px across and can sit on the card's edge, so press the side of
  // it that is *inside* the card: the other side is off the node, where the
  // canvas has no grab handle to find.
  const dragGrabTo = async (x: number, y: number) => {
    const handle = await grab.boundingBox();
    const cardBox = await card.boundingBox();
    if (!handle || !cardBox) throw new Error("grab handle not visible");
    const midY = handle.y + handle.height / 2;
    const candidates = [handle.x + 3, handle.x + handle.width - 3];
    const inside = candidates.find(
      (candidate) => candidate > cardBox.x && candidate < cardBox.x + cardBox.width,
    );
    await page.mouse.move(inside ?? candidates[0] ?? handle.x, midY);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };

  // Free placement away from the anchors.
  await dragGrabTo(box.x + box.width + 1, box.y + box.height * 0.32);
  await expect(card.locator('[data-testid="connector"][data-anchored="false"]')).toHaveCount(1);

  // Magnetizes when dropped near a corner.
  await dragGrabTo(box.x + 3, box.y + 3);
  await expect(card.locator('[data-testid="connector"][data-anchored="false"]')).toHaveCount(0);

  // Right-click offers reposition and delete (target the dot itself).
  await card.hover();
  await connectors.nth(2).locator('[data-testid="connector-dot"]').click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Reposition Connector" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Delete connector" }).click();
  await expect(connectors).toHaveCount(4);
});

/** Reads the live edge path straight from the DOM (avoids locator churn). */
async function edgeGeometry(page: Page) {
  return page.evaluate(() => {
    const path = document.querySelector("path.react-flow__edge-path");
    if (!path) return null;
    const length = path.getTotalLength();
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(length);
    const mid = path.getPointAtLength(length / 2);
    return {
      start: { x: Math.round(start.x), y: Math.round(start.y) },
      end: { x: Math.round(end.x), y: Math.round(end.y) },
      mid: { x: Math.round(mid.x), y: Math.round(mid.y) },
      d: path.getAttribute("d") ?? "",
      stroke: getComputedStyle(path).stroke,
    };
  });
}

/**
 * React Flow re-renders nodes (detaching handles) while a second client syncs, so
 * a bounding box read can come back empty. Retry until both are measurable.
 */
async function boxPair(
  first: Locator,
  second: Locator,
  timeout = 5_000,
): Promise<{ source: BoundingBox; target: BoundingBox }> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const [source, target] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    if (source && target) return { source, target };
    if (Date.now() > deadline) throw new Error("connectors not visible");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function connectCards(page: Page): Promise<void> {
  const cards = page.locator('[data-testid="node-card"]');
  await expect(cards).toHaveCount(2);
  const from = cards.nth(0).locator('[data-testid="connector-dot"]').nth(1);
  const to = cards.nth(1).locator('[data-testid="connector-dot"]').nth(3);
  const edge = page.locator(".react-flow__edge");

  // Handles can still be registering right after mount, in which case the drop
  // is ignored; repeat the gesture until React Flow accepts it.
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

test("the link follows a connector while it is being moved", async ({ page }) => {
  await page.goto(docUrl("live-link"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);

  const before = await edgeGeometry(page);
  if (!before) throw new Error("edge missing");

  const card = page.locator('[data-testid="node-card"]').first();
  // Dots are a hover/selection affordance: hovering the card brings them to hand,
  // and only then can one be clicked to select it.
  await card.hover();
  await card.locator('[data-testid="connector-dot"]').nth(1).click();
  const grab = await card.locator('[data-testid="connector-grab"]').boundingBox();
  const cardBox = await card.boundingBox();
  if (!grab || !cardBox) throw new Error("grab handle not visible");

  await page.mouse.move(grab.x + grab.width - 3, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width * 0.75, cardBox.y - 6, { steps: 10 });
  await page.waitForTimeout(250);

  // The link's source end follows the connector before it is dropped.
  const during = await edgeGeometry(page);
  if (!during) throw new Error("edge missing during drag");
  expect(Math.abs(during.start.y - before.start.y)).toBeGreaterThan(4);

  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

/** Screen point on the link stroke, which is where it actually accepts pointer events. */
async function edgeMidpoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const path = document.querySelector("path.react-flow__edge-path");
    if (!path) return null;
    const mid = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = new DOMPoint(mid.x, mid.y).matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  if (!point) throw new Error("edge missing");
  return point;
}

/**
 * A point that genuinely belongs to the link, in screen pixels. Sampling the
 * stroke matters because links now paint *below* the cards: a link crossing a
 * card is only pressable along the parts that are not covered, and the middle of
 * its bounding box is rarely on the curve at all.
 */
async function linkPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>("path.react-flow__edge-path");
    if (!path) return null;
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
    return null;
  });
  if (!point) throw new Error("no exposed part of the link to press");
  return point;
}

/** Hovers the link so React Flow reveals its reconnect handles. */
async function hoverEdge(page: Page): Promise<void> {
  const point = await edgeMidpoint(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".react-flow__edgeupdater")).toHaveCount(2);
}

test("reconnects a link end onto another connector", async ({ page }) => {
  await page.goto(docUrl("reconnect"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);

  await createNote(page);
  await page.keyboard.press("Escape");
  const cards = page.locator('[data-testid="node-card"]');
  await expect(cards).toHaveCount(3);

  const before = await edgeGeometry(page);
  if (!before) throw new Error("edge missing");

  await hoverEdge(page);
  const updater = await page.locator(".react-flow__edgeupdater-source").boundingBox();
  const other = await cards.nth(2).locator('[data-testid="connector-dot"]').nth(1).boundingBox();
  if (!updater || !other) throw new Error("reconnect handles not visible");

  await page.mouse.move(updater.x + updater.width / 2, updater.y + updater.height / 2);
  await page.mouse.down();
  await page.mouse.move(other.x + other.width / 2, other.y + other.height / 2, { steps: 14 });
  await page.mouse.up();

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect.poll(async () => (await edgeGeometry(page))?.start).not.toEqual(before.start);
});

test("changes link pathing from the context menu", async ({ page }) => {
  await page.goto(docUrl("edge-paths"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await connectCards(page);

  const curved = await edgeGeometry(page);
  if (!curved) throw new Error("edge missing");
  expect(curved.d).toContain("C");

  const point = await edgeMidpoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "Path" }).hover();
  await expect(page.getByTestId("context-submenu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Step", exact: true }).click();

  await expect.poll(async () => (await edgeGeometry(page))?.d.includes("C")).toBe(false);
});

test("links connectors with a direction the menu can change", async ({ page }) => {
  await page.goto(docUrl("links"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const cards = page.locator('[data-testid="node-card"]');
  const source = cards.nth(0).locator('[data-testid="connector-dot"]').nth(1);
  const target = cards.nth(1).locator('[data-testid="connector-dot"]').nth(3);

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("connectors not visible");

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 16,
  });
  await page.mouse.up();

  const edge = page.locator(".react-flow__edge").first();
  await expect(edge).toHaveCount(1);

  const path = edge.locator("path.react-flow__edge-path");
  await expect(path).toHaveAttribute("marker-end", /arrowclosed/);
  await expect(path).not.toHaveAttribute("marker-start", /arrowclosed/);

  // The edge meets the target connector horizontally (its side is "left"),
  // rather than hooking downward.
  const endTangent = await path.evaluate((element) => {
    const pathElement = element as SVGPathElement;
    const length = pathElement.getTotalLength();
    const from = pathElement.getPointAtLength(Math.max(0, length - 6));
    const to = pathElement.getPointAtLength(length);
    return { dx: to.x - from.x, dy: to.y - from.y };
  });
  expect(Math.abs(endTangent.dy)).toBeLessThan(Math.abs(endTangent.dx));

  // Links paint below the cards, so a link crossing a card never takes the press
  // that belongs to it — its hit stroke is 20px wide and would otherwise win.
  // The layer only rises while one link is being worked with (selected, or its
  // reconnect handles are up), which is what keeps reconnection reachable.
  const layers = () =>
    page.evaluate(() => {
      const edges = document.querySelector(".react-flow__edges");
      return {
        edges: Number(edges ? getComputedStyle(edges).zIndex : 0),
        nodes: Number(getComputedStyle(document.querySelector(".react-flow__nodes")).zIndex),
      };
    });
  // Off the line first: its hover is what mounts the reconnect handles, and a
  // mounted handle is itself a reason for the layer to stay on top.
  await page.mouse.move(4, 4);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await layers()).edges).toBeLessThan((await layers()).nodes);

  const mid = await edgeMidpoint(page);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
  await expect.poll(async () => (await layers()).edges).toBeGreaterThan((await layers()).nodes);

  // Swapping the endpoints makes React Flow drop the edge for a frame, so a right
  // click can fall through to the pane. Dismiss whatever opened and try again.
  const openEdgeMenu = async () => {
    const deleteItem = page.getByRole("menuitem", { name: "Delete link" });
    await expect(async () => {
      await page.keyboard.press("Escape");
      const point = await edgeMidpoint(page);
      await page.mouse.click(point.x, point.y, { button: "right" });
      await expect(deleteItem).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });
  };

  await openEdgeMenu();
  await page.getByRole("menuitem", { name: "Make bidirectional" }).click();
  await expect(path).toHaveAttribute("marker-start", /arrowclosed/);

  await openEdgeMenu();
  await expect(page.getByRole("menuitem", { name: "Make one-way" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Reverse direction" }).click();
  await expect(edge).toHaveCount(1);

  await openEdgeMenu();
  await page.getByRole("menuitem", { name: "Delete link" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});

test("reorders card layers from the context menu", async ({ page }) => {
  await page.goto(docUrl("layers"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const layers = page.locator(".react-flow__node");
  const first = page.locator('[data-testid="node-card"]').first();
  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Position" }).hover();
  await expect(page.getByTestId("context-submenu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Bring to Front" }).click();

  // The layer action clears the selection so React Flow's selection elevation
  // does not hide the new order.
  await expect
    .poll(async () => {
      const z = await layers.evaluateAll((nodes) =>
        nodes.map((node) => Number(getComputedStyle(node).zIndex)),
      );
      return Math.max(...z);
    })
    .toBeGreaterThan(0);

  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);

  await first.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Position" }).hover();
  await page.getByRole("menuitem", { name: "Send to Back" }).click();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(0);
});

test("switches and persists the color theme", async ({ page }) => {
  await page.goto(docUrl("theme"));
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-mode", "dark");

  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("a reloaded tab replaces its presence instead of duplicating it", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = docUrl("reload-presence");

  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();

  const board = await pageA.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("canvas board not visible");
  await pageA.mouse.move(board.x + 40, board.y + 40);
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(1);
  await expect(pageB.getByText(/2 here/)).toHaveCount(1);

  await pageA.reload();
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByText(/2 here/)).toHaveCount(1);

  // The refreshed tab publishes under the same presence id, so its next move
  // replaces the old entry rather than adding a second frozen cursor.
  await pageA.mouse.move(board.x + 64, board.y + 64);
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});

test("shows a peer's drag presence while a card is being dragged", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("drag-presence");
  await pageA.goto(url);
  await pageB.goto(url);

  await createNote(pageA);
  await pageA.keyboard.type("dragged note");
  await pageA.keyboard.press("Escape");

  const cardA = pageA
    .locator('[data-testid="node-card"]')
    .filter({ hasText: "dragged note" })
    .first();
  await expect(cardA).toHaveCount(1);

  const cardB = pageB.locator('[data-testid="node-card"]').filter({ hasText: "dragged note" });
  await expect(cardB).toHaveCount(1);
  await expect(cardB).not.toHaveAttribute("data-dragging", "true");

  const box = await cardA.boundingBox();
  if (!box) throw new Error("card not visible");
  const before = await cardB.boundingBox();

  await pageA.mouse.move(box.x + 40, box.y + 14);
  await pageA.mouse.down();
  await pageA.mouse.move(box.x + 180, box.y + 120, { steps: 12 });

  await expect(cardB).toHaveAttribute("data-dragging", "true");
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(0);
  await expect(cardB.getByTestId("peer-name-tag")).toBeVisible();

  // The card follows the collaborator's cursor live, not just after drop.
  await expect
    .poll(async () => {
      const during = await cardB.boundingBox();
      return during ? Math.round(during.x - (before?.x ?? 0)) : 0;
    })
    .toBeGreaterThan(80);

  await pageA.mouse.up();
  await expect(cardB).not.toHaveAttribute("data-dragging", "true");

  // The arrow returns on the next pointer move, not automatically on release.
  const board = await pageA.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("canvas board not visible");
  await pageA.mouse.move(board.x + 24, board.y + 24);
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});

test("clears a peer's ghost when their gestures stop arriving", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("stale-gesture");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expectPeersConnected(pageA, pageB);

  const cardA = pageA.locator('[data-testid="node-card"]').first();
  const box = await cardA.boundingBox();
  if (!box) throw new Error("card not visible");
  await pageA.mouse.move(box.x + 40, box.y + 14);
  await pageA.mouse.down();
  await pageA.mouse.move(box.x + 200, box.y + 140, { steps: 8 });

  const cardB = pageB.locator('[data-testid="node-card"]').first();
  await expect(cardB).toHaveAttribute("data-dragging", "true");

  // The network drops mid-drag: no end event ever arrives, so the ghost has to
  // expire on its own rather than linger until awareness times the client out.
  await contextA.setOffline(true);
  const startedAt = Date.now();
  await expect(cardB).not.toHaveAttribute("data-dragging", "true", { timeout: 10_000 });
  expect(Date.now() - startedAt).toBeGreaterThan(1_000);

  await contextA.close();
  await contextB.close();
});

test("shows a peer's selection presence", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("selection-presence");
  await pageA.goto(url);
  await pageB.goto(url);

  const cardA = pageA.locator('[data-testid="node-card"]').first();
  await expect(cardA).toBeVisible();
  await cardA.click({ position: { x: 40, y: 14 } });

  const cardB = pageB.locator('[data-testid="node-card"]').first();
  await expect(cardB).toHaveAttribute("data-selected-by-peer", "true");
  await expect(cardB.getByTestId("presence-avatar")).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test("shows link selection and connector movement presence", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("link-presence");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expectPeersConnected(pageA, pageB);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(0);

  await connectCards(pageA);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);

  const before = await edgeGeometry(pageB);
  if (!before) throw new Error("edge missing on B");

  // A selects the link; B sees it highlighted in A's color.
  const point = await linkPoint(pageA);
  await pageA.mouse.click(point.x, point.y);

  await expect.poll(async () => (await edgeGeometry(pageB))?.stroke).not.toBe(before.stroke);

  // A drags a connector; B sees it as peer-moved.
  const cardA = pageA.locator('[data-testid="node-card"]').first();
  await cardA.hover();
  await cardA.locator('[data-testid="connector-dot"]').nth(1).click();
  const grab = await cardA.locator('[data-testid="connector-grab"]').boundingBox();
  if (!grab) throw new Error("grab handle not visible");
  await pageA.mouse.move(grab.x + grab.width - 3, grab.y + grab.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(grab.x + grab.width + 40, grab.y - 40, { steps: 8 });

  await expect(pageB.locator('[data-testid="connector"][data-peer="true"]')).toHaveCount(1);

  await pageA.mouse.up();
  await expect(pageB.locator('[data-testid="connector"][data-peer="true"]')).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

/** Screen point of the connector a peer is currently holding. */
async function peerConnectorPoint(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector('[data-testid="connector"][data-peer="true"]');
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  });
}

test("a peer sees the connector and its link move before release", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("live-connector");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expectPeersConnected(pageA, pageB);
  await connectCards(pageA);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);

  const edgeStartBefore = await edgeGeometry(pageB);

  const card = pageA.locator('[data-testid="node-card"]').first();
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("card not visible");
  // Dots are a hover affordance; the pointer has to be over the card first.
  await card.hover();
  await card.locator('[data-testid="connector-dot"]').nth(1).click();
  const grab = await card.locator('[data-testid="connector-grab"]').boundingBox();
  if (!grab) throw new Error("grab handle not visible");

  await pageA.mouse.move(grab.x + grab.width - 3, grab.y + grab.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(cardBox.x + cardBox.width * 0.6, cardBox.y + cardBox.height, {
    steps: 10,
  });

  // B follows the drag while A still holds the pointer down.
  await expect.poll(() => peerConnectorPoint(pageB)).not.toBeNull();
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(0);
  await expect(pageB.getByTestId("peer-name-tag")).toBeVisible();
  const first = await peerConnectorPoint(pageB);
  await pageA.mouse.move(cardBox.x, cardBox.y + cardBox.height * 0.5, { steps: 10 });
  await expect.poll(() => peerConnectorPoint(pageB)).not.toEqual(first);

  // The link's endpoint follows too, not just the dot.
  await expect
    .poll(async () => (await edgeGeometry(pageB))?.start)
    .not.toEqual(edgeStartBefore?.start);

  await pageA.mouse.up();

  await contextA.close();
  await contextB.close();
});

test("shows a peer's connector selection", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("connector-selection");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expectPeersConnected(pageA, pageB);

  const peerConnector = pageB.locator('[data-testid="connector"][data-peer-selected="true"]');
  await expect(peerConnector).toHaveCount(0);

  // A clicks (without dragging) one of its connectors.
  const cardA = pageA.locator('[data-testid="node-card"]').first();
  await cardA.hover();
  await cardA.locator('[data-testid="connector-dot"]').nth(1).click();

  await expect(peerConnector).toHaveCount(1);
  await expect(peerConnector.locator(".connector-peer-ring")).toHaveAttribute(
    "data-state",
    "selected",
  );

  // Clicking away clears it again.
  const pane = await emptyCanvasPoint(pageA);
  await pageA.mouse.click(pane.x, pane.y);
  await expect(peerConnector).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

/** Screen point of the free end of a peer's dashed link preview. */
async function peerPreviewEnd(page: Page, testId = "peer-reconnect-preview") {
  return page.evaluate((id) => {
    const path = document.querySelector<SVGPathElement>(`[data-testid="${id}"]`);
    if (!path) return null;
    const end = path.getPointAtLength(path.getTotalLength());
    const screen = new DOMPoint(end.x, end.y).matrixTransform(path.getScreenCTM() as DOMMatrix);
    return { x: Math.round(screen.x), y: Math.round(screen.y) };
  }, testId);
}

test("shows a peer's link drag before it is dropped", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("live-reconnect");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await connectCards(pageA);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);
  await expect(pageB.getByTestId("peer-reconnect-preview")).toHaveCount(0);

  await hoverEdge(pageA);
  const updater = await pageA.locator(".react-flow__edgeupdater-target").boundingBox();
  const anchor = await pageA
    .locator('[data-testid="node-card"]')
    .first()
    .locator('[data-testid="connector-dot"]')
    .nth(1)
    .boundingBox();
  if (!updater || !anchor) throw new Error("reconnect handles not visible");

  const anchorPoint = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
  await pageA.mouse.move(updater.x + updater.width / 2, updater.y + updater.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(anchorPoint.x + 40, anchorPoint.y + 120, { steps: 10 });

  // B sees a dashed preview from the anchored connector to A's pointer, and the
  // real link steps aside until the drop. A reconnect must not also read as a
  // brand-new link drag.
  await expect(pageB.getByTestId("peer-reconnect-preview")).toHaveCount(1);
  await expect(pageB.getByTestId("peer-connect-preview")).toHaveCount(0);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(0);
  // The preview trails the pointer by at most one throttled sample.
  await expect
    .poll(async () => {
      const point = await peerPreviewEnd(pageB);
      if (!point) return Number.POSITIVE_INFINITY;
      return Math.hypot(point.x - (anchorPoint.x + 40), point.y - (anchorPoint.y + 120));
    })
    .toBeLessThan(12);

  const first = await peerPreviewEnd(pageB);
  await pageA.mouse.move(anchorPoint.x + 160, anchorPoint.y + 40, { steps: 10 });
  await expect.poll(() => peerPreviewEnd(pageB)).not.toEqual(first);

  // Dragging onto another connector snaps the peer's preview to it, the same way
  // it snaps for the client doing the dragging.
  const targetDot = pageA
    .locator('[data-testid="node-card"]')
    .nth(1)
    .locator('[data-testid="connector-dot"]')
    .nth(2);
  const targetBox = await targetDot.boundingBox();
  if (!targetBox) throw new Error("target connector not visible");
  const targetCentre = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  await pageA.mouse.move(targetCentre.x + 5, targetCentre.y + 5, { steps: 10 });

  const preview = pageB.getByTestId("peer-reconnect-preview");
  await expect(preview).toHaveAttribute("data-snapped", "true");
  // Dragging the target end: the arrowhead rides the free end, as it will once
  // the link is dropped.
  await expect(preview).toHaveAttribute("data-arrows", "end");
  await expect
    .poll(async () => {
      const point = await peerPreviewEnd(pageB);
      if (!point) return Number.POSITIVE_INFINITY;
      return Math.hypot(point.x - targetCentre.x, point.y - targetCentre.y);
    })
    .toBeLessThan(6);

  await pageA.mouse.up();
  await expect(pageB.getByTestId("peer-reconnect-preview")).toHaveCount(0);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});

test("shows a peer's new link drag before it is dropped", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("live-connect");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expectPeersConnected(pageA, pageB);

  const cards = pageA.locator('[data-testid="node-card"]');
  const source = await cards.nth(0).locator('[data-testid="connector-dot"]').nth(1).boundingBox();
  const target = await cards.nth(1).locator('[data-testid="connector-dot"]').nth(3).boundingBox();
  if (!source || !target) throw new Error("connectors not visible");

  const sourcePoint = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const targetPoint = { x: target.x + target.width / 2, y: target.y + target.height / 2 };

  const preview = pageB.getByTestId("peer-connect-preview");
  const edge = pageB.locator(".react-flow__edge");
  await expect(preview).toHaveCount(0);

  // A drags a brand-new link out of one of its connectors and holds it.
  await pageA.mouse.move(sourcePoint.x, sourcePoint.y);
  await pageA.mouse.down();
  await pageA.mouse.move(sourcePoint.x + 60, sourcePoint.y + 120, { steps: 10 });

  // B sees exactly one dashed preview from the anchored connector to A's
  // pointer, with the arrow on the end the drop will mark. No link exists yet.
  await expect(preview).toHaveCount(1);
  await expect(pageB.getByTestId("peer-reconnect-preview")).toHaveCount(0);
  await expect(edge).toHaveCount(0);
  await expect(preview).toHaveAttribute("data-arrows", "end");
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(0);
  await expect(pageB.getByTestId("peer-name-tag")).toBeVisible();
  // The peer preview must paint above cards, like the local connection line.
  const layers = await pageB.evaluate(() => ({
    preview: Number(
      getComputedStyle(
        document
          .querySelector('[data-testid="peer-connect-preview"]')
          ?.closest("svg") as SVGElement,
      ).zIndex,
    ),
    nodes: Number(getComputedStyle(document.querySelector(".react-flow__nodes") as Element).zIndex),
  }));
  expect(layers.preview).toBeGreaterThan(layers.nodes);

  await expect
    .poll(async () => {
      const point = await peerPreviewEnd(pageB, "peer-connect-preview");
      if (!point) return Number.POSITIVE_INFINITY;
      return Math.hypot(point.x - (sourcePoint.x + 60), point.y - (sourcePoint.y + 120));
    })
    .toBeLessThan(12);

  const first = await peerPreviewEnd(pageB, "peer-connect-preview");
  await pageA.mouse.move(sourcePoint.x + 160, sourcePoint.y + 40, { steps: 10 });
  await expect.poll(() => peerPreviewEnd(pageB, "peer-connect-preview")).not.toEqual(first);

  // Over a target connector the preview snaps to it, the same way it snaps for
  // the client doing the dragging.
  await pageA.mouse.move(targetPoint.x + 5, targetPoint.y + 5, { steps: 10 });
  await expect(preview).toHaveAttribute("data-snapped", "true");
  await expect
    .poll(async () => {
      const point = await peerPreviewEnd(pageB, "peer-connect-preview");
      if (!point) return Number.POSITIVE_INFINITY;
      return Math.hypot(point.x - targetPoint.x, point.y - targetPoint.y);
    })
    .toBeLessThan(6);

  await pageA.mouse.up();
  await expect(preview).toHaveCount(0);
  await expect(edge).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});

test("keeps the peer's preview arrow on the link's target end", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("preview-arrows");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await connectCards(pageA);
  await expect(pageB.locator(".react-flow__edge")).toHaveCount(1);

  // Dragging the *source* end leaves the target anchored, so the arrowhead
  // belongs there rather than under the pointer.
  await hoverEdge(pageA);
  const updater = await pageA.locator(".react-flow__edgeupdater-source").boundingBox();
  if (!updater) throw new Error("reconnect handles not visible");

  await pageA.mouse.move(updater.x + updater.width / 2, updater.y + updater.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(updater.x + 30, updater.y + 120, { steps: 10 });

  const preview = pageB.getByTestId("peer-reconnect-preview");
  await expect(preview).toHaveAttribute("data-arrows", "start");
  await expect(preview).toHaveAttribute("marker-start", /arrow/);
  await expect(preview).not.toHaveAttribute("marker-end", /arrow/);

  await pageA.mouse.up();
  await expect(preview).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

test("syncs content and presence between two clients", { tag: "@smoke" }, async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("two-clients");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();
  await expect(pageA.locator('[data-testid="node-card"]')).toHaveCount(2);
  await expect(pageB.locator('[data-testid="node-card"]')).toHaveCount(2);

  await createNote(pageA);
  await pageA.keyboard.type("hello from A");

  const noteOnB = pageB.locator('[data-testid="node-card"]').filter({ hasText: "hello from A" });
  await expect(noteOnB).toHaveCount(1);

  // Presence: B sees A's avatar on the card A is editing, plus A's caret,
  // without the stale mouse arrow.
  await expect(noteOnB.getByTestId("presence-avatar")).toBeVisible();
  await expect(pageB.getByTestId("peer-cursor")).toHaveCount(0);
  await expect(noteOnB.locator(".ProseMirror-loro-cursor")).toHaveCount(1);

  // A's caret must not be mapped into the other cards' documents.
  const otherCards = pageB
    .locator('[data-testid="node-card"]')
    .filter({ hasNotText: "hello from A" });
  const otherCount = await otherCards.count();
  for (let index = 0; index < otherCount; index += 1) {
    await expect(otherCards.nth(index).locator(".ProseMirror-loro-cursor")).toHaveCount(0);
  }

  await contextA.close();
  await contextB.close();
});
