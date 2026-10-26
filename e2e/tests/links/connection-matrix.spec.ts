import { expect, type Locator, type Page, test } from "@playwright/test";
import { settleViewport } from "../fixtures/marquee";
import { cards, newBoard } from "../fixtures/support";

/**
 * Every kind of thing that can hold a connector, linked to every other kind, in
 * both directions and in both gestures. Every pair asserts the same thing: the
 * line leaves the dot it was started from and lands on the dot it was aimed at.
 *
 * That is what catches the one-offs a hand-written pair misses — a kind that
 * only works as a source, a dot that is silently replaced by the nearest side of
 * the shape, a link whose stored connector is dropped because the end is a
 * board, a section whose dots cannot be pressed at all.
 */

// A wide pane: a portal, a sketch, a section and notes all have to stand clear
// of each other, because a dot under another card cannot be pressed at all.
test.use({ viewport: { width: 2600, height: 1400 } });
test.describe.configure({ timeout: 300_000 });

// Two tests start in the same millisecond in different workers, so the id needs
// something that cannot collide across processes as well as within one.
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-matrix-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const dotSelector = '[data-testid="connector-dot"], [data-testid="section-connector-dot"]';
const boardTabs = (page: Page) =>
  // Only the board tabs: the strip also holds one close button per board, so counting
  // its buttons would count twice.
  page.locator('[data-testid^="board-tab"]');

/** One connector-bearing entity: its dots and the face that owns them. */
interface Entity {
  name: string;
  dots: Locator;
  surface: Locator;
}

async function zoomOut(page: Page, steps: number): Promise<void> {
  for (let step = 0; step < steps; step += 1) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  // Sampling the pane mid-zoom would measure a gap that moves before the click.
  await settleViewport(page);
}

/**
 * Zooms out until the board content is at most `width` pixels wide. A fitted
 * board zooms *in* on a wide pane, so "zoom out twice" is not a known state.
 */
async function shrinkTo(page: Page, width: number): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const span = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".react-flow__node")].map((node) =>
        node.getBoundingClientRect(),
      );
      if (boxes.length === 0) return 0;
      return Math.max(...boxes.map((box) => box.right)) - Math.min(...boxes.map((box) => box.left));
    });
    if (span <= width) return;
    await zoomOut(page, 1);
  }
  throw new Error(`the board content never shrank below ${width}px`);
}

/**
 * A spot with room for a node the size of the largest one on the board. A new
 * node is placed with its top-left corner at the click point, so a spot that is
 * only clear at the click itself still lands the node on a neighbour.
 */
async function roomyPoint(page: Page): Promise<{ x: number; y: number } | null> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  const size = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".react-flow__node")].map((node) =>
      node.getBoundingClientRect(),
    );
    if (boxes.length === 0) return { width: 420, height: 420 };
    return {
      width: Math.max(...boxes.map((entry) => entry.width)) + 48,
      height: Math.max(...boxes.map((entry) => entry.height)) + 48,
    };
  });
  return page.evaluate(
    ({ width, height, offsetX, offsetY, size }) => {
      for (let fy = 0.05; fy < 0.9; fy += 0.02) {
        for (let fx = 0.02; fx < 0.98; fx += 0.02) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          if (x + size.width > width - 4 || y + size.height > height - 4) continue;
          const samples = [
            [x + 3, y + 3],
            [x + size.width - 3, y + 3],
            [x + 3, y + size.height - 3],
            [x + size.width - 3, y + size.height - 3],
            [x + size.width / 2, y + size.height / 2],
            [x + size.width / 2, y + 3],
            [x + 3, y + size.height / 2],
            [x + size.width - 3, y + size.height / 2],
            [x + size.width / 2, y + size.height - 3],
          ];
          const clear = samples.every(([sx = 0, sy = 0]) => {
            const element = document.elementFromPoint(offsetX + sx, offsetY + sy);
            return (
              Boolean(element?.closest(".react-flow__pane")) &&
              !element?.closest(".react-flow__node") &&
              !element?.closest(".section-region")
            );
          });
          if (clear) return { x: offsetX + x, y: offsetY + y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y, size },
  );
}

/**
 * Collapse the Outline panel, which is chrome over the canvas rather than part of it.
 *
 * The panel appears the moment a board has a section — and the fixture creates one —
 * so it covers the top-left corner *after* the portal has been placed there. Its row
 * count chip then sits exactly over a connector dot, and the press lands on the
 * outline instead of the dot. A reader would collapse the panel; so does the fixture,
 * so that what fails here is link drawing and never chrome stacking.
 */
async function hideOutline(page: Page): Promise<void> {
  if ((await page.getByTestId("outline-panel").count()) === 0) return;
  await page.getByTestId("outline-toggle").click();
  await expect(page.getByTestId("outline-panel")).toHaveCount(0);
}

async function ensureRoom(page: Page): Promise<{ x: number; y: number }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const point = await roomyPoint(page);
    if (point) return point;
    await shrinkTo(page, 700);
  }
  throw new Error("no room on the pane");
}

async function createSketch(page: Page): Promise<void> {
  const point = await ensureRoom(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New sketch" }).click();
  await expect(page.getByTestId("whiteboard-node")).toHaveCount(1);
  await page.getByTestId("card-focus-close").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
}

async function createPortal(page: Page): Promise<void> {
  await newBoard(page);
  await expect(boardTabs(page)).toHaveCount(2);
  await page
    .getByRole("navigation", { name: "Boards" })
    .getByRole("button", { name: "Board 1", exact: true })
    .click();
  const point = await ensureRoom(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New portal" }).click();
  await page.getByTestId("context-submenu").getByRole("menuitem", { name: "Board 2" }).click();
  await expect(page.getByTestId("portal-node")).toHaveCount(1);
}

/**
 * One entity of every connector-bearing kind. A section hugs its card, so it is
 * made last, around the note it already contains.
 */
async function kinds(page: Page): Promise<Entity[]> {
  await page.goto(workspaceUrl("kinds"));
  await expect(cards(page)).toHaveCount(2);
  // Two seeded cards fill a fitted board, so every new node needs room made for
  // it first; otherwise it lands on a neighbour and hides its dots.
  await shrinkTo(page, 1000);

  await createSketch(page);
  await createPortal(page);

  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  // Nothing selected: dots must come from the mode or the gesture, not from a
  // leftover selection.
  await page.mouse.click(4, 4);
  await page.mouse.move(4, 4);
  await hideOutline(page);

  return [
    { name: "note", dots: cards(page).first().locator(dotSelector), surface: cards(page).first() },
    {
      name: "sketch",
      dots: page.getByTestId("whiteboard-node").locator(dotSelector),
      surface: page.getByTestId("whiteboard-node"),
    },
    // A portal's dots are a sibling layer inside its shell, not part of the card
    // face that carries `portal-node`.
    {
      name: "portal",
      dots: page.locator(".portal-node-shell").locator(dotSelector),
      surface: page.locator(".portal-node-shell"),
    },
    {
      name: "section",
      dots: page.getByTestId("section-connector-dot"),
      surface: page.locator(".section-region").first(),
    },
  ];
}

async function centre(dot: Locator): Promise<{ x: number; y: number }> {
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  if (!box) throw new Error("dot is not measurable");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Every drawn link, resolved to the screen points its two ends sit on. */
async function drawnLinks(
  page: Page,
): Promise<{ start: { x: number; y: number }; end: { x: number; y: number } }[]> {
  return page.evaluate(() => {
    const paths = [
      ...document.querySelectorAll<SVGPathElement>(
        'path.react-flow__edge-path, path[data-testid="section-link"]',
      ),
    ];
    return paths.map((path) => {
      const matrix = path.getScreenCTM();
      const at = (length: number) => {
        const local = path.getPointAtLength(length);
        const screen = matrix ? new DOMPoint(local.x, local.y).matrixTransform(matrix) : local;
        return { x: screen.x, y: screen.y };
      };
      return { start: at(0), end: at(path.getTotalLength()) };
    });
  });
}

const near = (left: { x: number; y: number }, right: { x: number; y: number }) =>
  Math.abs(left.x - right.x) <= 8 && Math.abs(left.y - right.y) <= 8;

/** The link just drawn must leave the source dot and land on the target dot. */
async function expectLink(
  page: Page,
  wanted: { start: { x: number; y: number }; end: { x: number; y: number } },
): Promise<void> {
  const matches = async () =>
    (await drawnLinks(page)).filter(
      (link) => near(link.start, wanted.start) && near(link.end, wanted.end),
    ).length;
  try {
    await expect.poll(matches, { timeout: 6000 }).toBeGreaterThan(0);
  } catch (error) {
    throw new Error(
      `${(error as Error).message}\nwanted a link ${JSON.stringify(
        wanted,
      )}\ndrawn links: ${JSON.stringify(await drawnLinks(page))}`,
    );
  }
}

/** One click on a dot, then another: the thread gesture. */
async function linkByClick(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await centre(source);
  await page.mouse.click(from.x, from.y);
  const to = await centre(target);
  await page.mouse.click(to.x, to.y);
  await expectLink(page, { start: from, end: to });
  // A thread stays armed for the next link, so the next pair starts from its own
  // source dot rather than chaining off this one.
  await page.keyboard.press("Escape");
}

/** A press on one dot, dragged, released on another. */
async function linkByDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // A first small step, so React Flow registers a drag rather than a click.
  await page.mouse.move(from.x + 14, from.y + 14, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expectLink(page, { start: from, end: to });
}

const names = ["note", "sketch", "portal", "section"] as const;

test("every kind links to every other kind by clicking dots in thread mode", async ({ page }) => {
  for (const sourceName of names) {
    for (const targetName of names) {
      if (sourceName === targetName) continue;
      await test.step(`${sourceName} -> ${targetName}`, async () => {
        // A fresh board per pair. Eight pairs of links on one board pile up
        // strokes and covers across each other, and a failure then blames the
        // pair that happens to run last rather than the pair that is broken.
        const entities = await kinds(page);
        await page.getByTestId("link-mode-toggle").click();
        const source = entities.find((entry) => entry.name === sourceName);
        const target = entities.find((entry) => entry.name === targetName);
        if (!source || !target) throw new Error(`missing ${sourceName} or ${targetName}`);
        // Dots 0 and 2 are opposite corners, so a link that quietly snaps to the
        // nearest side of the shape shows up as a different pair of ends.
        await linkByClick(page, source.dots.nth(0), target.dots.nth(2));
      });
    }
  }
});

test("every kind links to every other kind by dragging between dots", async ({ page }) => {
  for (const sourceName of names) {
    for (const targetName of names) {
      if (sourceName === targetName) continue;
      await test.step(`${sourceName} -> ${targetName}`, async () => {
        const entities = await kinds(page);
        // Every dot stays up for the whole pair. Hover-reveal is a behaviour of
        // its own (covered by the connectors and section specs); the gesture
        // here is the drag, and a dot that hides mid-flight would only test the
        // hover rule.
        await page.getByTestId("link-mode-toggle").click();
        const source = entities.find((entry) => entry.name === sourceName);
        const target = entities.find((entry) => entry.name === targetName);
        if (!source || !target) throw new Error(`missing ${sourceName} or ${targetName}`);
        // Measured before the press, so the release is compared with where the
        // dots actually were. The other diagonal, so both pairs of opposite
        // corners are exercised by the two gestures.
        const to = await centre(target.dots.nth(3));
        const from = await centre(source.dots.nth(1));
        await linkByDrag(page, from, to);
      });
    }
  }
});
