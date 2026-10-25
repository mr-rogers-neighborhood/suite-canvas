import { expect, type Page, test } from "@playwright/test";
import { selectCard } from "../interactions";
import { withOwnerKey } from "./ownerUrl";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-thread-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const edges = (page: Page) => page.locator(".react-flow__edge");

/** Clicks a connector dot of the nth card, by index. */
async function clickDot(page: Page, cardIndex: number, dotIndex: number): Promise<void> {
  const dot = cards(page).nth(cardIndex).locator('[data-testid="connector-dot"]').nth(dotIndex);
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  if (!box) throw new Error("connector dot is not measurable");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test("thread mode chains links click after click, without dragging", async ({ page }) => {
  await page.goto(workspaceUrl("thread"));
  await expect(cards(page)).toHaveCount(2);

  // Thread mode reveals every dot, so nothing has to be selected first.
  await page.getByTestId("link-mode-thread").click();
  await expect(page.getByTestId("link-mode-thread")).toHaveAttribute("aria-pressed", "true");
  await expect(cards(page).nth(0).getByTestId("connector")).toHaveCount(4);
  await expect(cards(page).nth(1).getByTestId("connector")).toHaveCount(4);

  // First click arms, second completes and arms the far end.
  await clickDot(page, 0, 1);
  await expect(edges(page)).toHaveCount(0);
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);

  // The chain keeps growing from its own tail: one more click is a second link.
  await clickDot(page, 0, 3);
  await expect(edges(page)).toHaveCount(2);
});

test("shift-click chains in connect mode, and Escape ends the thread", async ({ page }) => {
  await page.goto(workspaceUrl("thread-shift"));
  await expect(cards(page)).toHaveCount(2);

  // Connect mode does not chain on a plain click, so reveal by selecting.
  // Seeded cards overlap, so the click has to land on a part that is really this
  // card's.
  await selectCard(page, cards(page).first());
  await expect(cards(page).first().getByTestId("connector")).toHaveCount(4);

  // Shift starts the chain; once armed, plain clicks keep extending it.
  await page.keyboard.down("Shift");
  await clickDot(page, 0, 1);
  await page.keyboard.up("Shift");
  await expect(edges(page)).toHaveCount(0);
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);

  // Escape disarms, so a later click selects instead of drawing a third link.
  await page.keyboard.press("Escape");
  await selectCard(page, cards(page).first());
  await clickDot(page, 0, 2);
  await expect(edges(page)).toHaveCount(1);
});

test("the connector menu toggles the same mode as the widget bar", async ({ page }) => {
  await page.goto(workspaceUrl("thread-menu"));
  await expect(cards(page)).toHaveCount(2);

  await cards(page).first().click();
  await page.getByTestId("connector-dot").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Switch to thread mode" }).click();

  await expect(page.getByTestId("link-mode-thread")).toHaveAttribute("aria-pressed", "true");

  // And back again from a dot, so the two surfaces can never disagree.
  await page.getByTestId("connector-dot").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Switch to connect mode" }).click();
  await expect(page.getByTestId("link-mode-connect")).toHaveAttribute("aria-pressed", "true");
});
