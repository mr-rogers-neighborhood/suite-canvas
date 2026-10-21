import { expect, type Page, test } from "@playwright/test";

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
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page.locator('[data-testid="node-card"]:has([contenteditable="true"])')).toHaveCount(
    1,
  );
}

const editingCard = (page: Page) =>
  page.locator('[data-testid="node-card"]:has([contenteditable="true"])');

/** Each test gets its own document so parallel tests never share CRDT state. */
let docSequence = 0;
const docUrl = (name: string) => `/?doc=e2e-${name}-${Date.now()}-${++docSequence}`;

test("creates, edits, and deletes a note", async ({ page }) => {
  await page.goto(docUrl("create-edit-delete"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await createNote(page);
  await expect(editingCard(page).locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("note to delete");

  const created = page.locator('[data-testid="node-card"]').filter({ hasText: "note to delete" });
  await expect(created).toHaveCount(1);

  await created.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await expect(page.getByText("note to delete")).toHaveCount(0);
});

test("deletes the selected note with the keyboard", async ({ page }) => {
  await page.goto(docUrl("keyboard-delete"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await createNote(page);
  await page.keyboard.type("keyboard delete");
  await page.keyboard.press("Escape");

  const created = page.locator('[data-testid="node-card"]').filter({ hasText: "keyboard delete" });
  await created.click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("keyboard delete")).toHaveCount(0);
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
  // for making connections).
  await connectors.first().locator(".connector-dot").click();
  const grab = card.locator('[data-testid="connector-grab"]');
  await expect(grab).toHaveCount(1);

  // Grab the ring itself (its centre is the dot, which starts a connection).
  const dragGrabTo = async (x: number, y: number) => {
    const handle = await grab.boundingBox();
    if (!handle) throw new Error("grab handle not visible");
    await page.mouse.move(handle.x + handle.width - 3, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };

  // Free placement away from the anchors.
  await dragGrabTo(box.x + box.width + 1, box.y + box.height * 0.32);
  await expect(card.locator('[data-testid="connector"][data-anchored="false"]')).toHaveCount(1);

  // Magnetizes when dropped near a corner.
  await dragGrabTo(box.x + 3, box.y + 3);
  await expect(card.locator('[data-testid="connector"][data-anchored="false"]')).toHaveCount(0);

  // Right-click offers reposition and delete (target the dot itself).
  await connectors.nth(2).locator('[data-testid="connector-dot"]').click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Reposition Connector" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Delete connector" }).click();
  await expect(connectors).toHaveCount(4);
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

  // Links paint above cards so card stacking order cannot hide them.
  const layers = await page.evaluate(() => ({
    edges: Number(getComputedStyle(document.querySelector(".react-flow__edges")).zIndex),
    nodes: Number(getComputedStyle(document.querySelector(".react-flow__nodes")).zIndex),
  }));
  expect(layers.edges).toBeGreaterThan(layers.nodes);

  const edgeBox = await edge.boundingBox();
  if (!edgeBox) throw new Error("edge not visible");
  const openEdgeMenu = async () => {
    await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2, {
      button: "right",
    });
    await expect(page.getByTestId("context-menu")).toBeVisible();
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

  await page.getByTestId("theme-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByTestId("theme-dark")).toHaveAttribute("data-checked", "true");

  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
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

  // The card follows the collaborator's cursor live, not just after drop.
  await expect
    .poll(async () => {
      const during = await cardB.boundingBox();
      return during ? Math.round(during.x - (before?.x ?? 0)) : 0;
    })
    .toBeGreaterThan(80);

  await pageA.mouse.up();
  await expect(cardB).not.toHaveAttribute("data-dragging", "true");

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
  await cardA.click();

  const cardB = pageB.locator('[data-testid="node-card"]').first();
  await expect(cardB).toHaveAttribute("data-selected-by-peer", "true");
  await expect(cardB.getByTestId("presence-avatar")).toBeVisible();

  await contextA.close();
  await contextB.close();
});

test("syncs content and presence between two clients", async ({ browser }) => {
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

  // Presence: B sees A's avatar on the card A is editing, plus A's caret.
  await expect(noteOnB.getByTestId("presence-avatar")).toBeVisible();
  await expect(noteOnB.locator(".ProseMirror-yjs-cursor")).toHaveCount(1);

  // A's caret must not be mapped into the other cards' documents.
  const otherCards = pageB
    .locator('[data-testid="node-card"]')
    .filter({ hasNotText: "hello from A" });
  const otherCount = await otherCards.count();
  for (let index = 0; index < otherCount; index += 1) {
    await expect(otherCards.nth(index).locator(".ProseMirror-yjs-cursor")).toHaveCount(0);
  }

  await contextA.close();
  await contextB.close();
});
