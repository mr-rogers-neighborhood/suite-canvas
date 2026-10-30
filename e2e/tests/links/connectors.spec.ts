import { expect, type Locator, type Page, test } from "@playwright/test";
import { settleViewport } from "../fixtures/marquee";
import { boardId, createNote, newBoard, openBoard, selectForSection } from "../fixtures/support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-connector-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const portalNodes = (page: Page) => page.getByTestId("portal-node");
const edges = (page: Page) => page.locator(".react-flow__edge");

/**
 * Room for a portal (288x256) on the bare pane. A portal is placed with its
 * top-left corner at the click point, so the clearance box runs right and down
 * from the candidate; without it the next step would try to click a card the
 * portal just covered. Nodes are shrunk first, because a fitted board of two
 * cards leaves no such gap.
 */
async function roomyPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      const needW = 340;
      const needH = 310;
      const covered = (x: number, y: number) => {
        const element = document.elementFromPoint(x, y);
        if (!element?.closest(".react-flow__pane")) return true;
        return Boolean(element.closest(".react-flow__node"));
      };
      for (let fy = 0.15; fy < 0.75; fy += 0.03) {
        for (let fx = 0.04; fx < 0.9; fx += 0.03) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          if (x + needW > width - 4 || y + needH > height - 4) continue;
          const samples = [
            [x + 6, y + 6],
            [x + needW - 6, y + 6],
            [x + 6, y + needH - 6],
            [x + needW - 6, y + needH - 6],
            [x + needW / 2, y + needH / 2],
          ];
          if (samples.some(([sx, sy]) => covered(offsetX + sx, offsetY + sy))) continue;
          return { x: offsetX + x, y: offsetY + y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );
  if (!point) throw new Error("no room for a portal on the pane");
  return point;
}

async function createBoard(page: Page): Promise<void> {
  await newBoard(page);
}

async function createPortal(page: Page, target: string): Promise<void> {
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  // Sampling the pane mid-zoom would measure a gap that moves before the click.
  await settleViewport(page);
  const point = await roomyPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New portal" }).click();
  const submenu = page.getByTestId("context-submenu");
  await expect(submenu).toBeVisible();
  await submenu.getByRole("menuitem", { name: target }).click();
  await expect(portalNodes(page)).toHaveCount(1);
}

/** Drags a link out of `card`'s first connector and releases over `target`. */
async function dragLinkOnto(page: Page, card: Locator, target: Locator): Promise<void> {
  const dot = card.getByTestId("connector-dot").first();
  await expect(dot).toBeVisible();
  const from = await dot.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("connector or drop target is not visible");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 16, from.y + from.height / 2 + 16, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** A second board plus a portal to it, on the first one. */
async function boardWithPortal(page: Page): Promise<void> {
  const firstBoard = boardId(page);
  await createBoard(page);
  await createNote(page, "Target Two");
  await openBoard(page, firstBoard);
  await expect(cards(page)).toHaveCount(2);
  await createPortal(page, "Board 2");
}

test("connector dots appear on selection, on every node kind", async ({ page }) => {
  await page.goto(workspaceUrl("dots"));
  await expect(cards(page)).toHaveCount(2);

  // Nothing selected: no wiring diagram. The handles stay mounted (React Flow
  // needs their measured bounds), so hidden means not revealed, not absent.
  await expect(page.locator('[data-testid="node-connectors"][data-revealed="true"]')).toHaveCount(
    0,
  );

  // A note reveals its own dots, and only its own.
  const note = cards(page).first();
  await note.click();
  await expect(note.getByTestId("connector")).toHaveCount(4);
  await expect(page.locator('[data-testid="node-connectors"][data-revealed="true"]')).toHaveCount(
    1,
  );

  // A portal is created selected, so its dots are up immediately; they are a
  // sibling layer over the portal's chrome, not part of it.
  await boardWithPortal(page);
  await expect(page.locator(".portal-node-shell").getByTestId("connector")).toHaveCount(4);

  const point = await roomyPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "New sketch" }).click();
  await settleViewport(page);
  // A new sketch opens its editor; the board is what the connector rule is about.
  await page.getByTestId("card-focus-back").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);

  const sketch = page.getByTestId("whiteboard-node");
  await expect(sketch).toHaveCount(1);
  // A single click selects a sketch instead of opening it …
  await sketch.click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
  await expect(sketch.getByTestId("connector")).toHaveCount(4);
  await expect(page.locator('[data-testid="node-connectors"][data-revealed="true"]')).toHaveCount(
    1,
  );

  // … and a double click opens it, like a portal.
  await sketch.dblclick();
  await expect(page.getByTestId("card-focus")).toHaveCount(1);
  await page.getByTestId("card-focus-back").click();
});

test("a link dragged onto a portal is a board link that survives unplacing", async ({ page }) => {
  await page.goto(workspaceUrl("link"));
  await expect(cards(page)).toHaveCount(2);
  await boardWithPortal(page);

  const note = cards(page).first();
  await note.click();
  await expect(note.getByTestId("connector")).toHaveCount(4);

  await dragLinkOnto(page, note, portalNodes(page).first());

  await expect(note.getByTestId("card-link-count")).toHaveCount(1);
  await expect(edges(page)).toHaveCount(1);

  // The portal is only how the board is drawn here: unplacing it stops the line
  // but leaves the link itself in the document.
  await portalNodes(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from board" }).click();
  await expect(portalNodes(page)).toHaveCount(0);
  await expect(edges(page)).toHaveCount(0);

  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(note.getByTestId("card-link-count")).toHaveCount(1);
  await expect(edges(page)).toHaveCount(0);
});

test("a section connector can be added and removed from its menus", async ({ page }) => {
  await page.goto(workspaceUrl("section"));
  await expect(cards(page)).toHaveCount(2);

  await selectForSection(page, cards(page).first());
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.type("Band");
  await page.keyboard.press("Enter");
  await expect(page.locator(".section-header")).toContainText("Band");

  // A new section is selected, so its dots are already up.
  const sectionDots = page.getByTestId("section-connector");
  await expect(sectionDots).toHaveCount(4);

  await page.locator(".section-header").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add connector" }).click();
  await expect(sectionDots).toHaveCount(5);

  const dot = page.getByTestId("section-connector-dot").first();
  await expect(dot).toBeVisible();
  await dot.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete connector" }).click();
  await expect(sectionDots).toHaveCount(4);
});

test("hovering a section's empty area reveals its dots, hovering a card does not", async ({
  page,
}) => {
  await page.goto(workspaceUrl("section-hover"));
  await expect(cards(page)).toHaveCount(2);

  await selectForSection(page, cards(page).first());
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.press("Enter");

  // A new section is created selected; clear that so only hover can reveal.
  // The pane corners stay empty once a section owns most of the board.
  const pane = await page.locator(".react-flow").boundingBox();
  if (!pane) throw new Error("canvas pane is not measurable");
  const corners: Array<[number, number]> = [
    [10, 10],
    [10, pane.height - 10],
    [pane.width - 10, 10],
    [pane.width - 10, pane.height - 10],
  ];
  let cleared = false;
  for (const [x, y] of corners) {
    const onPane = await page.evaluate(
      (point) => {
        const element = document.elementFromPoint(point.x, point.y);
        return (
          Boolean(element?.closest(".react-flow__pane")) && !element?.closest(".react-flow__node")
        );
      },
      { x: pane.x + x, y: pane.y + y },
    );
    if (!onPane) continue;
    await page.mouse.click(pane.x + x, pane.y + y);
    cleared = true;
    break;
  }
  if (!cleared) throw new Error("no empty pane point to clear the selection");
  await page.mouse.move(0, 0);
  const sectionDots = page.getByTestId("section-connector");
  await expect(sectionDots).toHaveCount(0);

  // The section's own empty area is the section's hover, so its dots appear
  // without a click — no inspector, no obscured dot.
  const region = page.locator(".section-region").first();
  await expect(region).toBeVisible();
  const box = await region.boundingBox();
  if (!box) throw new Error("section is not measurable");

  // Any point that is really the section's own surface: a section hugs its
  // contents, so only the padded band around the cards is genuinely the
  // section's, and the outline rail covers part of that band.
  const ownPoint = await region.evaluate(
    (element, rect) => {
      const band = 14;
      const candidates: Array<[number, number]> = [
        [rect.x + band, rect.y + rect.height / 2],
        [rect.x + rect.width / 2, rect.y + rect.height - band],
        [rect.x + rect.width - band, rect.y + rect.height / 2],
        [rect.x + rect.width / 2, rect.y + band / 2],
      ];
      for (const [x, y] of candidates) {
        // A section often extends past the pane; a point off-screen has no
        // element at all, which is not the same as "covered".
        const inside = x > 8 && y > 8 && x < window.innerWidth - 8 && y < window.innerHeight - 8;
        if (!inside) continue;
        const hit = document.elementFromPoint(x, y);
        // The card face paints children over the region, so "belongs to" is the
        // right test, not identity.
        if (hit?.closest(".section-region") === element) return { x, y };
      }
      return null;
    },
    { x: box.x, y: box.y, width: box.width, height: box.height },
  );
  if (!ownPoint) throw new Error("no point of the section is uncovered");
  await page.mouse.move(ownPoint.x, ownPoint.y);
  await expect(sectionDots).toHaveCount(4);

  // A card inside the section is the innermost thing under the pointer, so the
  // section must not wire up behind it.
  const cardBox = await cards(page).first().boundingBox();
  if (!cardBox) throw new Error("card is not measurable");
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 12);
  await expect(sectionDots).toHaveCount(0);
});

test("a portal's miniature draws the links on the board it opens", async ({ page }) => {
  await page.goto(workspaceUrl("miniature"));
  await expect(cards(page)).toHaveCount(2);

  // One link between the two starters on Board 1, drawn from dot to dot.
  const first = cards(page).first();
  await first.click();
  const from = await first.getByTestId("connector-dot").nth(1).boundingBox();
  const to = await cards(page).nth(1).getByTestId("connector-dot").nth(3).boundingBox();
  if (!from || !to) throw new Error("cannot measure a dot");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 16, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // A portal to Board 1, sitting on the new Board 2, must paint that link inside
  // its picture — the same anchors the board uses, not a second set of rules.
  await newBoard(page);
  await createPortal(page, "Board 1");

  await expect(page.getByTestId("portal-miniature")).toHaveCount(1);
  await expect(page.getByTestId("portal-miniature-links").locator("line")).toHaveCount(1);
});
