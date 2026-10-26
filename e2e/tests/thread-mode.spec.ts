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
  const toggle = page.getByTestId("link-mode-toggle");
  await expect(toggle).toHaveAttribute("data-mode", "place");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "thread");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
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

test("holding shift chains link after link until shift is released", async ({ page }) => {
  await page.goto(workspaceUrl("thread-shift"));
  await expect(cards(page)).toHaveCount(2);

  // Reveal the source's dots the way a user does: hover or select it. The first
  // arm then reveals every other candidate, so the chain can continue.
  await selectCard(page, cards(page).first());

  // Shift is held for the whole chain; releasing it ends the thread.
  await page.keyboard.down("Shift");
  await clickDot(page, 0, 1);
  await expect(edges(page)).toHaveCount(0);

  // Each later click draws a line from the previous connector and arms this one.
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);
  await clickDot(page, 0, 3);
  await expect(edges(page)).toHaveCount(2);

  // Releasing Shift ends it, so a further click must not draw anything.
  await page.keyboard.up("Shift");
  await expect(edges(page)).toHaveCount(2);
});

test("a thread passes through a card instead of looping back into it", async ({ page }) => {
  await page.goto(workspaceUrl("handoff"));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("link-mode-toggle").click();
  await expect(page.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "thread");

  const dots = (cardIndex: number) =>
    cards(page).nth(cardIndex).locator('[data-testid="connector"]');
  const armed = page.locator('[data-testid="connector"][data-armed="true"]');

  // Arm one port: nothing is drawn yet, and one dot carries the armed state.
  await clickDot(page, 0, 1);
  await expect(edges(page)).toHaveCount(0);
  await expect(armed).toHaveCount(1);

  // A second port on the same card moves the way out and writes nothing. The card
  // is something a thread passes *through*; an edge from a card to itself would say
  // the opposite, so the click is a handoff rather than a loop (ADR-0061 amendment).
  await clickDot(page, 0, 3);
  await expect(edges(page)).toHaveCount(0);
  await expect(armed).toHaveCount(1);
  await expect(dots(0).nth(3)).toHaveAttribute("data-armed", "true");

  // The thread now leaves by the port the handoff chose, so the next click writes
  // exactly one edge — from that port, not from either of the ones before it.
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);
});

test("the connector menu toggles the same mode as the widget bar", async ({ page }) => {
  await page.goto(workspaceUrl("thread-menu"));
  await expect(cards(page)).toHaveCount(2);

  await cards(page).first().click();
  await page.getByTestId("connector-dot").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Switch to thread mode" }).click();

  const toggle = page.getByTestId("link-mode-toggle");
  await expect(toggle).toHaveAttribute("data-mode", "thread");

  // The menu walks the same cycle as the button, so the two surfaces can never
  // disagree: thread is followed by fan, fan by branch, and branch by place.
  await page.getByTestId("connector-dot").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Switch to fan mode" }).click();
  await expect(toggle).toHaveAttribute("data-mode", "fan");

  await page.getByTestId("connector-dot").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Switch to branch mode" }).click();
  await expect(toggle).toHaveAttribute("data-mode", "branch");

  await page.getByTestId("connector-dot").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Switch to place mode" }).click();
  await expect(toggle).toHaveAttribute("data-mode", "place");
});

test("shift-pressing a connector does not start a selection marquee", async ({ page }) => {
  await page.goto(workspaceUrl("thread-marquee"));
  await expect(cards(page)).toHaveCount(2);

  // Shift is React Flow's selection key, so without the connector claiming the
  // press a Shift-drag from a dot drew a marquee instead of arming a thread.
  const dot = cards(page).first().locator('[data-testid="connector-dot"]').first();
  const box = await dot.boundingBox();
  if (!box) throw new Error("connector dot is not measurable");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(start.x + 220, start.y + 160, { steps: 12 });
  await expect(page.locator(".react-flow__selection")).toHaveCount(0);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  // The press armed the thread rather than selecting a region.
  await page.mouse.click(start.x + 400, start.y + 400);
  await expect(page.getByTestId("link-mode-toggle")).toHaveAttribute("data-mode", "place");
});

test("an armed thread rubber-bands a line to the pointer", async ({ page }) => {
  await page.goto(workspaceUrl("thread-preview"));
  await expect(cards(page)).toHaveCount(2);
  // Thread mode, so a plain connector click arms rather than selects.
  await page.getByTestId("link-mode-toggle").click();
  await expect(cards(page).first().getByTestId("connector")).toHaveCount(4);

  await expect(page.getByTestId("thread-link-preview")).toHaveCount(0);

  // Arm the thread by clicking a connector, then move: the next link follows the
  // pointer instead of appearing only on the committing click.
  const dot = cards(page).first().locator('[data-testid="connector-dot"]').nth(1);
  const box = await dot.boundingBox();
  if (!box) throw new Error("connector dot is not measurable");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.mouse.move(box.x + 160, box.y + 120, { steps: 6 });
  await expect(page.getByTestId("thread-link-preview")).toHaveCount(1);

  // The line ends at the pointer, so moving again changes its far end.
  const first = await page.locator('[data-testid="thread-link-preview"] line').getAttribute("x2");
  await page.mouse.move(box.x + 40, box.y + 200, { steps: 6 });
  const second = await page.locator('[data-testid="thread-link-preview"] line').getAttribute("x2");
  expect(first).not.toEqual(second);
});
