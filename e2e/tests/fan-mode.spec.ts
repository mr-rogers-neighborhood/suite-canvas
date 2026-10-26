import { expect, type Page, test } from "@playwright/test";
import { selectCard } from "../interactions";
import { withOwnerKey } from "./ownerUrl";

/**
 * The third way to draw a link (ADR-0061): a fan keeps the *starting* connector
 * armed, so every click adds another spoke from that one origin instead of
 * chasing the tail the way a thread does.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-fan-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const edges = (page: Page) => page.locator(".react-flow__edge");
const armedDots = (page: Page) => page.locator('[data-testid="connector"][data-armed="true"]');

/** Creates a card from the canvas menu, which leaves its title focused. */
async function createCard(page: Page): Promise<void> {
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("board not visible");
  await page.mouse.click(board.x + board.width * 0.5, board.y + board.height * 0.8, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "New card" }).click();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.keyboard.press("Escape");
}

/** Clicks a connector dot of the nth card, by index. */
async function clickDot(page: Page, cardIndex: number, dotIndex: number): Promise<void> {
  const dot = cards(page).nth(cardIndex).locator('[data-testid="connector-dot"]').nth(dotIndex);
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  if (!box) throw new Error("connector dot is not measurable");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Where each drawn link begins, in screen pixels. */
async function linkStarts(page: Page): Promise<Array<{ x: number; y: number }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")].map((path) => {
      const matrix = path.getScreenCTM();
      const start = path.getPointAtLength(0);
      const point = matrix ? new DOMPoint(start.x, start.y).matrixTransform(matrix) : start;
      return { x: point.x, y: point.y };
    }),
  );
}

/** The centre of a card's nth dot, in screen pixels. */
async function dotCentre(page: Page, cardIndex: number, dotIndex: number) {
  const box = await cards(page)
    .nth(cardIndex)
    .locator('[data-testid="connector-dot"]')
    .nth(dotIndex)
    .boundingBox();
  if (!box) throw new Error("connector dot is not measurable");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("fan mode draws every link from the same starting connector", async ({ page }) => {
  await page.goto(workspaceUrl("spokes"));
  await expect(cards(page)).toHaveCount(2);
  await createCard(page);
  await expect(cards(page)).toHaveCount(3);

  // Two clicks past connect: connect → thread → fan.
  const toggle = page.getByTestId("link-mode-toggle");
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "fan");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // Fan mode reveals every dot, so nothing needs selecting first.
  await expect(cards(page).nth(0).getByTestId("connector")).toHaveCount(4);

  const origin = await dotCentre(page, 0, 1);
  await clickDot(page, 0, 1);
  await expect(edges(page)).toHaveCount(0);

  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);
  // The origin stays marked as the armed end: a fan returns to it every click.
  await expect(armedDots(page)).toHaveCount(1);

  // The second click on a *third* card is another spoke from the origin, where a
  // thread would have drawn card 1 → card 2 instead.
  await clickDot(page, 2, 3);
  await expect(edges(page)).toHaveCount(2);
  await expect(armedDots(page)).toHaveCount(1);

  for (const start of await linkStarts(page)) {
    expect(Math.hypot(start.x - origin.x, start.y - origin.y)).toBeLessThan(24);
  }
});

test("a thread moves its armed end, a fan keeps it", async ({ page }) => {
  await page.goto(workspaceUrl("contrast"));
  await expect(cards(page)).toHaveCount(2);
  await createCard(page);

  const toggle = page.getByTestId("link-mode-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "thread");
  await clickDot(page, 0, 1);
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);

  // Thread: the far end of the new link is now the armed one.
  await expect(
    cards(page).nth(1).locator('[data-testid="connector"][data-armed="true"]'),
  ).toHaveCount(1);
  await expect(
    cards(page).nth(0).locator('[data-testid="connector"][data-armed="true"]'),
  ).toHaveCount(0);

  // Same two clicks in fan mode leave the arm on the starting card.
  await page.keyboard.press("Escape");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "fan");
  await clickDot(page, 0, 2);
  await clickDot(page, 1, 1);
  await expect(edges(page)).toHaveCount(2);
  await expect(
    cards(page).nth(0).locator('[data-testid="connector"][data-armed="true"]'),
  ).toHaveCount(1);
});

test("holding Control fans out without switching the stored mode", async ({ page }) => {
  await page.goto(workspaceUrl("ctrl"));
  await expect(cards(page)).toHaveCount(2);
  await createCard(page);

  const toggle = page.getByTestId("link-mode-toggle");
  await expect(toggle).toHaveAttribute("data-mode", "place");

  // Reveal the first card's dots the way a user does. Control, like Shift, is a
  // press-time gesture: it takes an armed origin before every other dot shows.
  await selectCard(page, cards(page).first());

  // The indicator previews the gesture while Control is held.
  await page.keyboard.down("Control");
  await expect(toggle).toHaveAttribute("data-hint-mode", "fan");
  await clickDot(page, 0, 1);
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(1);
  await clickDot(page, 2, 3);
  await expect(edges(page)).toHaveCount(2);
  await page.keyboard.up("Control");

  // The stored mode was never changed: the gesture *was* the mode.
  await expect(toggle).toHaveAttribute("data-mode", "place");
});

test("Escape clears the armed origin", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await expect(cards(page)).toHaveCount(2);

  const toggle = page.getByTestId("link-mode-toggle");
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "fan");

  await clickDot(page, 0, 1);
  await expect(armedDots(page)).toHaveCount(1);
  // The rubber band only appears once the pointer moves: it is the pointer that
  // is the other end of the line.
  const origin = await dotCentre(page, 0, 1);
  await page.mouse.move(origin.x + 160, origin.y + 120, { steps: 6 });
  await expect(page.getByTestId("thread-link-preview")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("thread-link-preview")).toHaveCount(0);
  await expect(armedDots(page)).toHaveCount(0);

  // Nothing is armed, so the next click starts a new fan rather than linking.
  await clickDot(page, 1, 3);
  await expect(edges(page)).toHaveCount(0);
});

test("the mode button walks all four readings and comes back", async ({ page }) => {
  await page.goto(workspaceUrl("cycle"));
  await expect(cards(page)).toHaveCount(2);

  const toggle = page.getByTestId("link-mode-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "thread");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "fan");
  // Pattern is the fourth shape a run can draw (ADR-0063): a chain that branches.
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "pattern");
  await toggle.click();
  await expect(toggle).toHaveAttribute("data-mode", "place");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});
