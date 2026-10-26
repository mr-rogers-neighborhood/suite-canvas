import { expect, type Page, test } from "@playwright/test";
import { settleViewport } from "./marquee";
import { withOwnerKey } from "./ownerUrl";
import { cardByTitle, cards, createNote, libraryRowAction, newBoard } from "./support";

/**
 * A portal and a section are containers, not cards (ADR-0040): they have no
 * types, no fields and no body. Selecting one opens the container panel — never
 * the card inspector or the full-canvas card surface — and that panel is where
 * their board, colour, members and links are read.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-container-${name}-${Date.now()}-${++sequence}`);

const panel = (page: Page) => page.getByTestId("container-inspector");
const boardTabs = (page: Page) =>
  // Only the board tabs: the strip also holds one close button per board, so counting
  // its buttons would count twice.
  page.locator('[data-testid^="board-tab"]');

async function roomyPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.1; fy < 0.8; fy += 0.02) {
        for (let fx = 0.04; fx < 0.92; fx += 0.02) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          if (x + 340 > width - 4 || y + 310 > height - 4) continue;
          const samples = [
            [x + 3, y + 3],
            [x + 337, y + 3],
            [x + 3, y + 307],
            [x + 337, y + 307],
          ];
          if (
            samples.every(([sx, sy]) => {
              const element = document.elementFromPoint(offsetX + sx, offsetY + sy);
              return Boolean(element?.closest(".react-flow__pane"));
            })
          ) {
            return { x: offsetX + x, y: offsetY + y };
          }
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );
  if (!point) throw new Error("no room on the pane");
  return point;
}

/** Board 2 plus a portal to it on Board 1. */
async function boardWithPortal(page: Page): Promise<void> {
  await newBoard(page);
  await expect(boardTabs(page)).toHaveCount(2);
  await page
    .getByRole("navigation", { name: "Boards" })
    .getByRole("button", { name: "Board 1", exact: true })
    .click();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  await settleViewport(page);
  const point = await roomyPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New portal" }).click();
  await page.getByTestId("context-submenu").getByRole("menuitem", { name: "Board 2" }).click();
  await expect(page.getByTestId("portal-node")).toHaveCount(1);
}

test("a portal's header opens the container panel, and its board is one action away", async ({
  page,
}) => {
  await page.goto(workspaceUrl("portal"));
  await expect(cards(page)).toHaveCount(2);
  await boardWithPortal(page);

  // Clicking the miniature — the part people aim at — opens the panel. It used to
  // be inert: only a thin header strip responded.
  await page.getByTestId("portal-node").click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-kind", "portal");
  await expect(page.getByTestId("container-title")).toHaveText("Board 2");
  await expect(page.getByTestId("container-board-name")).toHaveText("Board 2");
  // A container is not a card: the card surfaces stay shut.
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);
  await expect(page.getByTestId("card-focus")).toHaveCount(0);

  // The colour is the board's, and setting it survives a reload.
  await page.getByTestId("container-color-rose").click();
  await expect(page.getByTestId("container-color-rose")).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await page.getByTestId("portal-node").click();
  await expect(page.getByTestId("container-color-rose")).toHaveAttribute("aria-pressed", "true");

  // Open board is the panel's primary action: it steps through the portal.
  await page.getByTestId("container-open-board").click();
  await expect(boardTabs(page).nth(1)).toHaveAttribute("aria-current", "page");
});

test("a section's selection opens the container panel with its members and links", async ({
  page,
}) => {
  await page.goto(workspaceUrl("section"));
  await expect(cards(page)).toHaveCount(2);

  // A section around the second card, then a link drawn from the first card into it.
  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.press("Enter");
  // A new section is selected, so its panel is already open — before any
  // deselect, which is what closes it.
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute("data-kind", "section");
  await expect(page.getByTestId("container-members")).toContainText("Untitled");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  // A link from the note outside the section shows up as an incoming link.
  const note = cards(page).first();
  await note.click();
  const source = await note.getByTestId("connector-dot").nth(1).boundingBox();
  const region = page.locator(".section-region").first();
  const box = await region.boundingBox();
  if (!source || !box) throw new Error("cannot measure");
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  const target = await page.getByTestId("section-connector-dot").nth(3).boundingBox();
  if (!target) throw new Error("no section dot");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 20, source.y + 20, { steps: 3 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();

  // Selecting the section again reads the link from the container's side.
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("container-links")).toContainText("Untitled");

  // Renaming from the panel is the same write the canvas title does.
  await page.getByTestId("container-rename").fill("Act one");
  await page.getByTestId("container-rename").blur();
  await expect(page.getByTestId("container-title")).toHaveText("Act one");
});

test("tags a section without moving a card in or out of it", async ({ page }) => {
  await page.goto(workspaceUrl("section-tags"));
  await expect(cards(page)).toHaveCount(2);

  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(panel(page)).toHaveAttribute("data-kind", "section");

  // A section's tags are edited where its other properties are (ADR-0053 §6).
  await expect(page.getByTestId("container-tags")).toHaveAttribute("data-target", "section");
  await page.getByTestId("tag-input").fill("research");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("tag-chip")).toContainText("research");
  // The label is not a membership rule: the members are exactly the card that
  // was selected when the section was made.
  await expect(page.getByTestId("container-members")).toContainText("Untitled");

  // The tag lives on the record, so reopening the panel reads it back.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  const region = page.locator(".section-region").first();
  const box = await region.boundingBox();
  if (!box) throw new Error("cannot measure");
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("tag-chip")).toContainText("research");
});

test("closing the container panel leaves nothing open", async ({ page }) => {
  await page.goto(workspaceUrl("close"));
  await expect(cards(page)).toHaveCount(2);
  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();

  await page.getByTestId("container-close").click();
  await expect(panel(page)).toHaveCount(0);
  // And selecting a card opens the card inspector again, not the container panel.
  await cards(page)
    .first()
    .click({ position: { x: 40, y: 14 } });
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

test("a portal opens its panel on a click, not on a drag, and still walks through on a double click", async ({
  page,
}) => {
  await page.goto(workspaceUrl("gesture"));
  await expect(cards(page)).toHaveCount(2);
  await boardWithPortal(page);
  const portal = page.getByTestId("portal-node");
  await expect(portal).toBeVisible();
  // Nothing selected: no drawer.
  await expect(panel(page)).toHaveCount(0);

  // A drag moves the card and must not also open the drawer.
  const before = await portal.boundingBox();
  if (!before) throw new Error("portal is not measurable");
  await page.mouse.move(before.x + before.width * 0.5, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width * 0.5 + 70, before.y + 58, { steps: 10 });
  await page.mouse.up();
  const after = await portal.boundingBox();
  if (!after) throw new Error("portal vanished");
  expect(Math.abs(after.y - before.y)).toBeGreaterThan(20);
  await expect(panel(page)).toHaveCount(0);

  // A plain click reads it.
  await portal.click();
  await expect(panel(page)).toBeVisible();

  // And the doorway still works: a double click steps through, closing the panel
  // with the board switch.
  await portal.dblclick();
  await expect(boardTabs(page).nth(1)).toHaveAttribute("aria-current", "page");
});

/** A portal to `target`, dropped where the pointer was. */
async function portalAt(
  page: Page,
  point: { x: number; y: number },
  target: string,
): Promise<void> {
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New portal" }).click();
  await page.getByTestId("context-submenu").getByRole("menuitem", { name: target }).click();
  await expect(page.getByTestId("portal-node")).toBeVisible();
}

/** The id in the selected board tab's test id, i.e. the board just created. */
async function currentBoardId(page: Page): Promise<string> {
  const testId = await page
    .locator('[data-testid^="board-tab"][aria-current="page"]')
    .getAttribute("data-testid");
  if (!testId) throw new Error("the selected tab has no board id");
  return testId.replace("board-tab-", "");
}

test("a section member row navigates to the card it names", async ({ page }) => {
  await page.goto(workspaceUrl("member-row"));
  await expect(cards(page)).toHaveCount(2);

  await cards(page).last().click();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  const row = page.getByTestId("container-member-row");
  await expect(row).toHaveCount(1);

  // Zoom out first: a reveal that lands exactly where the camera already is
  // would let this test pass without navigating anywhere.
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  await settleViewport(page);
  const viewport = page.locator('[data-testid="canvas-board"] .react-flow__viewport');
  const before = await viewport.getAttribute("style");

  await row.click();
  await expect.poll(async () => viewport.getAttribute("style")).not.toBe(before);
  // Reading a row does not close the panel: it is still the section's panel.
  await expect(panel(page)).toHaveAttribute("data-kind", "section");
});

test("a portal's panel lists the target board, and a row opens it", async ({ page }) => {
  await page.goto(workspaceUrl("contents"));
  await expect(cards(page)).toHaveCount(2);

  await newBoard(page);
  await expect(boardTabs(page)).toHaveCount(2);
  await createNote(page, "Inside board two");
  await page
    .getByRole("navigation", { name: "Boards" })
    .getByRole("button", { name: "Board 1", exact: true })
    .click();

  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  await settleViewport(page);
  await portalAt(page, await roomyPoint(page), "Board 2");

  await page.getByTestId("portal-node").click();
  await expect(panel(page)).toBeVisible();
  // The outline is its own leaf: a portal's contents are a lot of rows, so they
  // sit behind a tab rather than pushing Details and Style past the fold.
  await page.getByTestId("container-tab-contents").click();
  const contents = page.getByTestId("container-contents");
  await expect(contents).toBeVisible();
  // Board 2 has one card and no sections, so it reads as one loose group.
  await expect(page.getByTestId("container-contents-section")).toHaveCount(1);
  await expect(contents).toContainText("Loose cards");
  await expect(page.getByTestId("container-contents-count")).toHaveText("1 card");
  await expect(page.getByTestId("container-contents-card")).toHaveText("Inside board two");

  // The row switches boards and reveals the card, so the panel's outline is a
  // way in, not a dead list.
  await page.getByTestId("container-contents-card").click();
  await expect(boardTabs(page).nth(1)).toHaveAttribute("aria-current", "page");
  await expect(cardByTitle(page, "Inside board two")).toBeVisible();
});

/** The library drawer is a toggle; only click it when it is actually open. */
async function closeLibrary(page: Page): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) return;
  await page.getByTestId("dock-library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
}

/** Deletes a board from the library, answering the one question it asks. */
async function deleteBoard(page: Page, boardId: string): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId("library-tab-boards").click();
  await libraryRowAction(page.getByTestId(`library-item-${boardId}`), "Delete board\u2026");
  await expect(page.getByTestId("dialog")).toBeVisible();
  await page.getByTestId("dialog").getByRole("button", { name: "Unplace cards" }).click();
  await closeLibrary(page);
}

test("an orphaned portal reads as empty, and can be pointed at a board or removed", async ({
  page,
}) => {
  await page.goto(workspaceUrl("orphan"));
  await expect(cards(page)).toHaveCount(2);

  // Two boards besides Board 1: one to lose, one to point at afterwards.
  await newBoard(page);
  await expect(boardTabs(page)).toHaveCount(2);
  const lostBoardId = await currentBoardId(page);
  await newBoard(page);
  await expect(boardTabs(page)).toHaveCount(3);
  const spareBoardId = await currentBoardId(page);
  await page
    .getByRole("navigation", { name: "Boards" })
    .getByRole("button", { name: "Board 1", exact: true })
    .click();

  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  await settleViewport(page);
  await portalAt(page, await roomyPoint(page), "Board 2");
  await expect(page.getByTestId("portal-node")).toHaveCount(1);

  // Deleting a board asks once, in the library; the portal that opened it stays.
  await deleteBoard(page, lostBoardId);
  await expect(
    page
      .getByRole("navigation", { name: "Boards" })
      .getByRole("button", { name: "Board 1", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // The card paints a state, not a broken miniature.
  const portal = page.getByTestId("portal-node");
  await expect(portal).toHaveCount(1);
  await expect(portal).toHaveAttribute("data-unavailable", "true");
  await expect(page.getByTestId("portal-unavailable")).toContainText(
    "The board this portal opened was removed.",
  );

  // Clicking an unavailable card still reads it, and its panel is an empty state.
  await portal.click({ force: true });
  await expect(panel(page)).toBeVisible();
  await expect(page.getByTestId("container-orphan")).toBeVisible();
  await expect(page.getByTestId("container-orphan")).toContainText("Empty — source removed");

  // Choose a board lists the boards that still exist, and restores the portal.
  await page.getByTestId("container-choose-board").click();
  await expect(page.getByTestId("container-board-options")).toBeVisible();
  await expect(page.getByTestId(`container-board-option-${spareBoardId}`)).toHaveText("Board 3");
  await page.getByTestId(`container-board-option-${spareBoardId}`).click();
  await expect(page.getByTestId("container-title")).toHaveText("Board 3");
  await expect(page.getByTestId("container-orphan")).toHaveCount(0);
  await expect(page.getByTestId("portal-unavailable")).toHaveCount(0);
  await expect(portal).toContainText("Board 3");

  // Delete that board too: the same portal is a dead end again, and this time
  // the way out is off the board rather than through it.
  await deleteBoard(page, spareBoardId);
  await portal.click({ force: true });
  await expect(page.getByTestId("container-orphan")).toBeVisible();
  await page.getByTestId("container-remove-from-board").click();
  await expect(page.getByTestId("portal-node")).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
});
