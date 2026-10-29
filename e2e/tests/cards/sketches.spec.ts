import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-sketch-${name}-${Date.now()}-${++sequence}`;

const sketchNodes = (page: Page) => page.getByTestId("whiteboard-node");
const sketchFace = (page: Page) => page.getByTestId("whiteboard-card");
const sketchNode = (page: Page) =>
  page.locator(".react-flow__node").filter({ has: page.getByTestId("whiteboard-node") });

/**
 * The first point on the pane that is not covered by a card, so a right-click
 * opens the canvas menu instead of a card's own. The seeded board is fitted, so
 * positions move with the zoom.
 */
async function emptyPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.1; fy < 0.88; fy += 0.04) {
        for (let fx = 0.06; fx < 0.92; fx += 0.04) {
          const x = Math.round(offsetX + width * fx);
          const y = Math.round(offsetY + height * fy);
          const element = document.elementFromPoint(x, y);
          if (element?.closest(".react-flow__pane")) return { x, y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );
  if (!point) throw new Error("no empty point on the pane");
  return point;
}

/** New sketch from the canvas menu, then out of the editor it opens. */
async function createSketch(page: Page): Promise<void> {
  // The canvas frame paints before the workspace document is hydrated, and a menu
  // opened in that window has verbs but no board to write them to. Waiting for the
  // seeded cards is the same readiness the first test below already asserts.
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  const point = await emptyPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New sketch" }).click();
  await expect(sketchNodes(page)).toHaveCount(1);
  await expect(page.getByTestId("card-focus")).toBeVisible();
  await page.getByTestId("card-focus-close").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
}

/** Drags the sketch by its face, and asserts it actually moved. */
async function dragSketch(page: Page, dx: number, dy: number): Promise<void> {
  const node = sketchNodes(page);
  const box = await node.boundingBox();
  if (!box) throw new Error("the sketch has no box");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // React Flow starts the drag on the first move after pointer-down.
  await page.mouse.move(from.x + 2, from.y + 2, { steps: 1 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const moved = await node.boundingBox();
      return moved ? Math.abs(moved.x - box.x) : 0;
    })
    .toBeGreaterThan(20);
}

test("the menus and the library say Sketch, never Whiteboard", async ({ page }) => {
  await page.goto(workspaceUrl("labels"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);

  await createSketch(page);
  // Nothing the reader can see still calls the type a whiteboard.
  await expect(page.getByText("Whiteboard", { exact: true })).toHaveCount(0);

  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  // A sketch is a behaviour, not a facet: offering it in the type row would read as
  // "author your own Sketch type", which the model forbids (ADR-0011 amendment).
  await expect(page.getByTestId("facet-type-whiteboard")).toHaveCount(0);
  // It is still a card, listed in Cards like any other. The row is found by the
  // node's own id rather than by counting rows, because the list also carries the
  // board the cards are on.
  await expect(page.getByTestId("library-tab-cards")).toHaveAttribute("aria-selected", "true");
  const sketchId = await sketchNode(page).getAttribute("data-id");
  if (!sketchId) throw new Error("the sketch node has no id");
  await expect(page.locator(`li[data-row-id="${sketchId}"]`)).toHaveCount(1);
});

test("seamless drops the frame the framed card keeps", async ({ page }) => {
  await page.goto(workspaceUrl("display"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createSketch(page);

  // A new sketch is framed: chrome, footer and the element count.
  await expect(sketchFace(page)).toHaveAttribute("data-display", "framed");
  await expect(sketchFace(page).locator(".whiteboard-card__footer")).toHaveCount(1);

  // A sketch has no card menu, so the library row is the way into its inspector.
  const nodeId = await sketchNode(page).getAttribute("data-id");
  if (!nodeId) throw new Error("the sketch node has no id");
  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  await page.locator(`li[data-row-id="${nodeId}"]`).click();

  const inspector = page.getByTestId("card-inspector");
  await expect(inspector.getByTestId("sketch-display-toggle")).toBeVisible();
  await inspector.getByTestId("sketch-display-seamless").click();
  await expect(inspector.getByTestId("sketch-display-seamless")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await inspector.getByTestId("inspector-close").click();

  await expect(sketchFace(page)).toHaveAttribute("data-display", "seamless");
  await expect(sketchFace(page)).toHaveClass(/whiteboard-card--seamless/);
  await expect(sketchFace(page).locator(".whiteboard-card__footer")).toHaveCount(0);

  // The mode is a card value, not inspector state: it survives a reload.
  await page.reload();
  await expect(sketchFace(page)).toHaveAttribute("data-display", "seamless");
  await expect(sketchFace(page)).toHaveClass(/whiteboard-card--seamless/);
});

test("a click selects the sketch and a double click opens it", async ({ page }) => {
  await page.goto(workspaceUrl("enter"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createSketch(page);

  await sketchNodes(page).click();
  await expect(sketchNode(page)).toHaveClass(/selected/);
  await expect(page.getByTestId("card-focus")).toHaveCount(0);

  await sketchNodes(page).dblclick();
  await expect(page.getByTestId("card-focus")).toBeVisible();
  await expect(page.getByTestId("sketch-focus")).toBeVisible();
});

test("a single click opens the sketch in the one inspector", async ({ page }) => {
  await page.goto(workspaceUrl("inspector"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createSketch(page);

  const inspector = page.getByTestId("card-inspector");
  await expect(inspector).toHaveCount(0);

  // A sketch is a card: one click reads it, like a note, and still selects it.
  await sketchNodes(page).click();
  await expect(sketchNode(page)).toHaveClass(/selected/);
  await expect(inspector).toBeVisible();
  // The drawer is the card panel, with the sketch's own display control and the
  // way into its editor.
  await expect(inspector.getByTestId("sketch-display-toggle")).toBeVisible();
  await expect(inspector.getByTestId("sketch-display-framed")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(inspector.getByTestId("inspector-open-sketch")).toBeVisible();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);

  // A sketch has no text body: the Content tab is the drawing, and the body
  // editor is not mounted anywhere in the panel.
  await expect(inspector.getByTestId("sketch-panel")).toBeVisible();
  await expect(inspector.getByTestId("card-panel-body")).toHaveCount(0);

  await inspector.getByTestId("inspector-close").click();
  await expect(inspector).toHaveCount(0);

  // A drag moves the sketch and must not also open the drawer.
  await dragSketch(page, 150, 100);
  await expect(inspector).toHaveCount(0);

  // The double click still opens the focus surface, and focus owns the drawer.
  await sketchNodes(page).dblclick();
  await expect(page.getByTestId("card-focus")).toBeVisible();
  await expect(page.getByTestId("sketch-focus")).toBeVisible();
  await expect(inspector).toHaveCount(0);
});

/** The interactive canvas Excalidraw listens on, once the lazy surface is up. */
const sketchCanvas = (page: Page) => page.locator(".whiteboard-surface canvas.excalidraw__canvas");

/** Draws one freehand stroke across the middle of the open surface. */
async function drawStroke(page: Page): Promise<void> {
  const surface = page.getByTestId("whiteboard-surface");
  await expect(surface).toBeVisible();
  // The Draw tool, then a drag on the interactive canvas: Excalidraw starts the
  // stroke on pointer-down and lands it on pointer-up.
  await page.getByTitle(/^Draw — /).click();
  const canvas = sketchCanvas(page).last();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the sketch canvas has no box");
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 10, { steps: 4 });
  await page.mouse.move(from.x + 120, from.y + 50, { steps: 4 });
  await page.mouse.up();
}

test("a stroke drawn in the surface is on the card and survives a reload", async ({ page }) => {
  await page.goto(workspaceUrl("draw"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createSketch(page);

  // A new sketch is empty, and says so.
  await sketchNodes(page).dblclick();
  await expect(page.getByTestId("sketch-focus")).toBeVisible();
  await expect(page.getByTestId("whiteboard-surface")).toHaveAttribute("data-elements", "0");
  await drawStroke(page);
  // The commit is one stroke per gesture, batched on pointer-up.
  await expect(page.getByTestId("whiteboard-surface")).toHaveAttribute("data-elements", "1");

  await page.getByTestId("card-focus-close").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);

  // The face is a preview of the document, not of the surface that just closed.
  const preview = page.getByTestId("whiteboard-preview");
  await expect(preview).not.toHaveAttribute("data-empty", "true");
  await expect(sketchFace(page).locator(".whiteboard-card__count")).toHaveText("1");

  // And the document is what carries it: a reload reads the drawing back.
  await page.reload();
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(page.getByTestId("whiteboard-preview")).not.toHaveAttribute("data-empty", "true");
  await expect(sketchFace(page).locator(".whiteboard-card__count")).toHaveText("1");

  // Reopening the surface hands the stored stroke back to Excalidraw.
  await sketchNodes(page).dblclick();
  await expect(page.getByTestId("whiteboard-surface")).toHaveAttribute("data-elements", "1");
});

/** A 1x1 PNG: enough for Excalidraw to take a picture, and for us to store one. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Excalidraw asks the File System Access API for a picture, which Playwright
 * cannot intercept the way it intercepts a file input, so the picker is answered
 * with one small PNG before the app loads.
 */
async function stubFilePicker(page: Page): Promise<void> {
  await page.addInitScript((base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const file = new File([bytes], "dot.png", { type: "image/png" });
    Object.defineProperty(window, "showOpenFilePicker", {
      configurable: true,
      value: async () => [{ kind: "file", name: "dot.png", getFile: async () => file }],
    });
  }, PNG_1X1.toString("base64"));
}

/** The image tool, then the picture the picker hands back. */
async function insertPicture(page: Page): Promise<void> {
  await page.getByTitle(/^Insert image/).click();
  await expect(page.getByTestId("whiteboard-surface")).toHaveAttribute("data-elements", "1");
  // The bytes are stored beside the document, and the surface holds them.
  await expect(page.getByTestId("whiteboard-surface")).toHaveAttribute("data-files", "1");
}

test("a picture in a sketch is stored beside the document and comes back", async ({ page }) => {
  await stubFilePicker(page);
  await page.goto(workspaceUrl("image"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await createSketch(page);

  await sketchNodes(page).dblclick();
  await expect(page.getByTestId("sketch-focus")).toBeVisible();
  await insertPicture(page);

  // The picture is on the card, and the document holds an id rather than bytes.
  await expect(sketchFace(page).locator(".whiteboard-card__count")).toHaveText("1");

  await page.getByTestId("card-focus-close").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);

  // A reload starts from the document and this browser's copy of the bytes, which
  // is the same promise a pasted image keeps: the surface has the picture back, not
  // just an element pointing at one it cannot draw.
  await page.reload();
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await sketchNodes(page).dblclick();
  const surface = page.getByTestId("whiteboard-surface");
  await expect(surface).toHaveAttribute("data-elements", "1");
  await expect(surface).toHaveAttribute("data-files", "1");
});
