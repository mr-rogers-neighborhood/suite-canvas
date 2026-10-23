import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-selection-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const selectedNodes = (page: Page) => page.locator(".react-flow__node.selected");

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Visible card boxes in viewport coordinates, which is what the mouse uses. */
async function cardBoxes(page: Page): Promise<Box[]> {
  return cards(page).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
}

/**
 * Card positions in flow coordinates, read from the node transform. Screen
 * positions move when `fitView` re-fits a reloaded board; flow positions are the
 * persisted truth.
 */
async function flowPositions(page: Page): Promise<{ x: number; y: number }[]> {
  return page.locator(".react-flow__node").evaluateAll((elements) =>
    elements.map((element) => {
      const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(
        (element as HTMLElement).style.transform,
      );
      return {
        x: match?.[1] ? Number(match[1]) : Number.NaN,
        y: match?.[2] ? Number(match[2]) : Number.NaN,
      };
    }),
  );
}

/** A point on the React Flow pane with no card or control panel under it. */
async function emptyPanePoint(page: Page): Promise<{ x: number; y: number }> {
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

/**
 * Shift-drag over every card on the board. The rectangle must touch each card
 * (`SelectionMode.Partial`), so the drag always ends at the board corner
 * farthest from where it started.
 */
async function marqueeSelectAll(page: Page): Promise<void> {
  const boxes = await cardBoxes(page);
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board || boxes.length === 0) throw new Error("canvas not ready");

  const start = await emptyPanePoint(page);
  const inset = 6;
  const end = {
    x: start.x < board.x + board.width / 2 ? board.x + board.width - inset : board.x + inset,
    y: start.y < board.y + board.height / 2 ? board.y + board.height - inset : board.y + inset,
  };

  await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

/**
 * Shift-drag a band across the top of every card. The band only overlaps each
 * card's header, so this exercises `SelectionMode.Partial` rather than a box
 * that fully contains everything — the case that used to drop cards.
 */
async function marqueeAcrossCardTops(page: Page): Promise<void> {
  const boxes = await cardBoxes(page);
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board || boxes.length === 0) throw new Error("canvas not ready");

  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.min(...boxes.map((box) => box.y));
  const start = { x: left + 10, y: top - 18 };
  const end = { x: right - 10, y: top + 28 };

  const onPane = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".react-flow__pane")),
    start,
  );
  if (!onPane) throw new Error("marquee start is not on the pane");

  await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // Few steps: a fast drag must not lose cards to a stale repaint either.
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}

test("shift-drag catches cards it only partly covers, repeatedly", async ({ page }) => {
  await page.goto(workspaceUrl("marquee-partial"));
  await expect(cards(page)).toHaveCount(2);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.keyboard.press("Escape");
    await expect(selectedNodes(page)).toHaveCount(0);
    await marqueeAcrossCardTops(page);
    await expect(selectedNodes(page)).toHaveCount(2);
  }
});

test("a peer sees the marquee while it is being drawn", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = workspaceUrl("marquee-peer");

  await pageA.goto(url);
  await pageB.goto(url);
  await expect(cards(pageA)).toHaveCount(2);
  await expect(cards(pageB)).toHaveCount(2);

  const boxes = await cardBoxes(pageA);
  const top = Math.min(...boxes.map((box) => box.y));
  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));

  await pageA.keyboard.down("Shift");
  await pageA.mouse.move(left + 10, top - 18);
  await pageA.mouse.down();
  await pageA.mouse.move(right - 10, top + 40, { steps: 8 });

  const peerBox = pageB.getByTestId("peer-selection-box");
  await expect(peerBox).toHaveCount(1);
  const colour = await peerBox.evaluate((element) => getComputedStyle(element).borderColor);
  expect(colour).not.toBe("rgba(0, 0, 0, 0)");
  await expect(peerBox.getByTestId("peer-name-tag")).toBeVisible();

  await pageA.mouse.up();
  await pageA.keyboard.up("Shift");
  await expect(peerBox).toHaveCount(0);

  await contextA.close();
  await contextB.close();
});

/** Largest gap between two position lists, so assertions can allow sub-pixels. */
function maxDelta(left: readonly Box[], right: readonly Box[]): number {
  let delta = 0;
  for (const [index, box] of left.entries()) {
    const other = right[index];
    if (!other) return Number.POSITIVE_INFINITY;
    delta = Math.max(delta, Math.abs(box.x - other.x), Math.abs(box.y - other.y));
  }
  return delta;
}

test("shift-drag selects several cards and opens the selection menu", async ({ page }) => {
  await page.goto(workspaceUrl("marquee"));
  await expect(cards(page)).toHaveCount(2);

  await marqueeSelectAll(page);
  await expect(selectedNodes(page)).toHaveCount(2);

  const [first] = await cardBoxes(page);
  if (!first) throw new Error("card not visible");
  await page.mouse.click(first.x + 40, first.y + 14, { button: "right" });

  // The bulk menu replaces the single-card menu while several cards are selected.
  await expect(page.getByRole("menuitem", { name: "New section from 2 cards" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete cards" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete card", exact: true })).toHaveCount(0);

  await page.getByRole("menuitem", { name: "New section from 2 cards" }).click();
  await expect(page.locator(".section-header")).toHaveCount(1);
  await expect(page.locator(".section-header")).toContainText("2");
});

test("shift-click toggles membership without opening the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("shift-toggle"));
  await expect(cards(page)).toHaveCount(2);

  // Click through the node locator, not page coordinates: `fitView` re-fits a
  // freshly loaded board, so a box read a moment earlier can be stale and the
  // click lands on empty canvas, which leaves the selection unchanged and reads
  // as a broken toggle. The locator re-resolves the element and verifies the
  // click actually hits it.
  const nodes = page.locator(".react-flow__node");
  await expect(nodes).toHaveCount(2);
  const inside = { x: 40, y: 60 } as const;

  await nodes.nth(0).click({ position: inside, modifiers: ["Shift"] });
  await expect(selectedNodes(page)).toHaveCount(1);
  await nodes.nth(1).click({ position: inside, modifiers: ["Shift"] });

  // Modifier clicks add to the selection and never open the inspector.
  await expect(selectedNodes(page)).toHaveCount(2);
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);

  // A second shift-click on a member drops just that card.
  await nodes.nth(0).click({ position: inside, modifiers: ["Shift"] });
  await expect(selectedNodes(page)).toHaveCount(1);

  // A lone selected card keeps the single-card menu.
  await nodes.nth(1).click({ position: { x: 40, y: 14 }, button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete card", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete cards" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A plain click still opens the inspector.
  await nodes.nth(0).click({ position: inside });
  await expect(page.getByTestId("card-inspector")).toBeVisible();
});

test("dragging one selected card moves the whole selection and persists", async ({ page }) => {
  await page.goto(workspaceUrl("multi-drag"));
  await expect(cards(page)).toHaveCount(2);

  const start = await flowPositions(page);
  const before = await cardBoxes(page);
  await marqueeSelectAll(page);
  await expect(selectedNodes(page)).toHaveCount(2);

  const [anchor] = before;
  if (!anchor) throw new Error("card not visible");
  await page.mouse.move(anchor.x + 40, anchor.y + 14);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 190, anchor.y + 134, { steps: 12 });
  await page.mouse.up();

  // Both cards moved by the same delta, not just the one under the pointer.
  const dropped = await flowPositions(page);
  const moved = dropped.map((position, index) => ({
    x: Math.round(position.x - (start[index]?.x ?? 0)),
    y: Math.round(position.y - (start[index]?.y ?? 0)),
  }));
  for (const delta of moved) {
    expect(delta.x).toBeGreaterThan(20);
    expect(delta.y).toBeGreaterThan(20);
  }
  expect(Math.abs((moved[0]?.x ?? 0) - (moved[1]?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((moved[0]?.y ?? 0) - (moved[1]?.y ?? 0))).toBeLessThanOrEqual(1);

  await page.reload();
  await expect(cards(page)).toHaveCount(2);

  // The whole selection was persisted, not just the dragged card.
  await expect
    .poll(async () => {
      const reloaded = await flowPositions(page);
      return reloaded.reduce(
        (worst, position, index) =>
          Math.max(
            worst,
            Math.abs(position.x - (dropped[index]?.x ?? 0)),
            Math.abs(position.y - (dropped[index]?.y ?? 0)),
          ),
        0,
      );
    })
    .toBeLessThan(2);
});

test("dropping a selection grows the section it lands in", async ({ page }) => {
  await page.goto(workspaceUrl("grow-section"));
  await expect(cards(page)).toHaveCount(2);

  // Control+G wraps the current selection, here both cards.
  await page.keyboard.press("Control+a");
  await expect(selectedNodes(page)).toHaveCount(2);
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-region")).toHaveCount(1);
  await page.keyboard.press("Escape");

  const region = page.locator(".section-region").first();
  const before = await region.boundingBox();
  const [anchor] = await cardBoxes(page);
  if (!anchor || !before) throw new Error("section or card not visible");

  await page.keyboard.press("Control+a");
  await expect(selectedNodes(page)).toHaveCount(2);
  await page.mouse.move(anchor.x + 40, anchor.y + 14);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 140, anchor.y + 14, { steps: 10 });
  await page.mouse.up();

  // Hanging the cards out of the section grows it, in the same commit as the move.
  await expect
    .poll(async () => Math.round((await region.boundingBox())?.width ?? 0) - before.width)
    .toBeGreaterThan(40);
});

test("selects every card with Control+A and removes them with Delete", async ({ page }) => {
  await page.goto(workspaceUrl("select-all"));
  await expect(cards(page)).toHaveCount(2);

  await page.keyboard.press("Control+a");
  await expect(selectedNodes(page)).toHaveCount(2);
  // The browser's own select-all never runs over the board.
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

  await page.keyboard.press("Delete");
  await expect(page.locator("[data-node-id]")).toHaveCount(0);
});

test("a peer sees a multi-card drag and lands the same positions", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = workspaceUrl("multi-peer");

  await pageA.goto(url);
  await pageB.goto(url);
  await expect(cards(pageA)).toHaveCount(2);
  await expect(cards(pageB)).toHaveCount(2);

  // Select with the marquee (not Ctrl+A): the gesture a user actually performs
  // before dragging a group, and the one whose live motion peers must see.
  await marqueeAcrossCardTops(pageA);
  await expect(selectedNodes(pageA)).toHaveCount(2);

  const beforeB = await cardBoxes(pageB);
  const [anchor] = await cardBoxes(pageA);
  if (!anchor) throw new Error("card not visible");

  await pageA.mouse.move(anchor.x + 40, anchor.y + 14);
  await pageA.mouse.down();
  await pageA.mouse.move(anchor.x + 190, anchor.y + 134, { steps: 12 });

  // Every member of the gesture follows the anchor, and only the anchor card
  // carries the peer's name tag.
  await expect
    .poll(async () => {
      const during = await cardBoxes(pageB);
      return Math.min(...during.map((box, index) => Math.round(box.x - (beforeB[index]?.x ?? 0))));
    })
    .toBeGreaterThan(80);
  // Mid-gesture, before any CRDT write: both cards have already moved.
  const duringB = await cardBoxes(pageB);
  for (const [index, box] of duringB.entries()) {
    expect(Math.round(box.x - (beforeB[index]?.x ?? 0))).toBeGreaterThan(80);
    expect(Math.round(box.y - (beforeB[index]?.y ?? 0))).toBeGreaterThan(60);
  }
  // The chip rides the group outline, not the card under the pointer.
  const group = pageB.getByTestId("peer-drag-group");
  await expect(group).toHaveCount(1);
  await expect(group.getByTestId("peer-name-tag")).toContainText("2 cards");
  await expect(cards(pageB).first().getByTestId("peer-name-tag")).toHaveCount(0);

  await pageA.mouse.up();
  await expect(group).toHaveCount(0);
  await expect(pageB.getByTestId("peer-name-tag")).toHaveCount(0);

  // After release the peer's document matches the local one card for card.
  await expect
    .poll(async () => Math.round(maxDelta(await cardBoxes(pageB), await cardBoxes(pageA))))
    .toBeLessThan(3);

  await contextA.close();
  await contextB.close();
});
