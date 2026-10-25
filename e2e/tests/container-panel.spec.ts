import { expect, type Page, test } from "@playwright/test";
import { settleViewport } from "./marquee";
import { withOwnerKey } from "./ownerUrl";
import { cards } from "./support";

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
const boardTabs = (page: Page) => page.getByRole("tablist", { name: "Boards" }).getByRole("tab");

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
  await page.getByTestId("board-create").click();
  await expect(boardTabs(page)).toHaveCount(2);
  await page.getByRole("tab", { name: "Board 1" }).click();
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

  await page.getByTestId("portal-info").click();
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
  await page.getByTestId("portal-info").click();
  await expect(page.getByTestId("container-color-rose")).toHaveAttribute("aria-pressed", "true");

  // Open board is the panel's primary action: it steps through the portal.
  await page.getByTestId("container-open-board").click();
  await expect(boardTabs(page).nth(1)).toHaveAttribute("aria-selected", "true");
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
