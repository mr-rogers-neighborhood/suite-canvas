import { expect, type Page, test } from "@playwright/test";
import { settleViewport } from "../fixtures/marquee";

/**
 * The picker loop (ADR-0063 §6)
 * and behaviours as ordinary cards (§ R1 of the ADR-0011 amendment): while a run is
 * live, adding a card joins the run instead of landing at a fixed point, and a
 * sketch or a portal is added the same way a note is.
 */

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-picker-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function removeAllFromBoard(page: Page): Promise<void> {
  await page.keyboard.press("Control+a");
  const box = await cards(page).first().boundingBox();
  if (!box) throw new Error("no card to press");
  await page.mouse.click(box.x + 40, box.y + 14, { button: "right" });
  await page.getByRole("menuitem", { name: "Remove from board" }).click();
  await expect(cards(page)).toHaveCount(0);
}

test("picking a type during a run joins the sequence", async ({ page }) => {
  await page.goto(workspaceUrl("dock"));
  await expect(cards(page)).toHaveCount(2);
  await removeAllFromBoard(page);

  // A picker loop: one card now, library stays the place the next pick comes from.
  await page.getByTestId("link-mode-toggle").click();
  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-inbox").click();
  await page.getByTestId("library-select-toggle").click();
  await page.locator("li[data-row-id]").first().click();
  await page.getByTestId("library-run-loop").click();
  await expect(cards(page)).toHaveCount(1);

  // The control reports the live run: a queue, and three ways out of it.
  await expect(page.getByTestId("placement-run")).toBeVisible();
  await expect(page.getByTestId("placement-run-stop")).toBeVisible();

  // A dock pick joins the run rather than being placed at a fixed point, so the
  // sequence keeps the mode's shape.
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();

  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  // Stopping leaves the mode where the verb put it: the run ends, the tool stays.
  await page.getByTestId("placement-run-stop").click();
  await expect(page.getByTestId("placement-run")).toHaveCount(0);
  await expect(page.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "thread");
});

test("a sketch and a portal are cards: placeable, and returnable to the inbox", async ({
  page,
}) => {
  await page.goto(workspaceUrl("behaviours"));
  await expect(cards(page)).toHaveCount(2);

  // A new sketch is a card on this board like any other: it has its own node face
  // (a drawing surface), and it is still a card with a placement.
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-new-sketch").click();
  await expect(page.getByTestId("whiteboard-node")).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Every live card is in the library's Cards section, behaviours included.
  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  await expect(page.locator("li[data-row-id]")).toHaveCount(3);

  // And taking one off the board returns it to the inbox, which is what "a card"
  // means (ADR-0040 amendment).
  await page.getByRole("button", { name: "Fit View" }).click();
  await settleViewport(page);
  await page.getByTestId("whiteboard-node").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from board" }).click();
  await expect(page.getByTestId("dock-inbox-count")).toHaveText("1");
  await expect(page.getByTestId("whiteboard-node")).toHaveCount(0);
});
