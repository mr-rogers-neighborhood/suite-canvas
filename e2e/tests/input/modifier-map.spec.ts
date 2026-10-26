import { expect, test } from "@playwright/test";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-modifiers");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

const linkMode = (page: import("@playwright/test").Page) => page.getByTestId("link-mode-toggle");
const purpose = (page: import("@playwright/test").Page) => page.getByTestId("purpose-toggle");

/**
 * The one modifier map (ADR-0066).
 *
 * Both families read the same positions, and a held modifier is momentary: it
 * previews while it is down and lets go back to the clicked value when it comes up.
 * Neither the keypress nor a click during one moves the stored value, because these
 * keys are also undo and multi-select, and clicking mid-gesture would commit a
 * different mode than the one on screen.
 */
test("alt previews pattern, the fourth gesture that had no key", async ({ page }) => {
  await page.goto(workspaceUrl("branch"));
  await expect(cards(page)).toHaveCount(2);
  await expect(linkMode(page)).toHaveAttribute("data-mode", "place");

  await page.keyboard.down("Alt");

  // The indicator follows the key...
  await expect(linkMode(page)).toHaveAttribute("data-hint-mode", "branch");
  await expect(linkMode(page)).toHaveAttribute("data-hint", "true");
  // ...and the tool is still where the reader left it.
  await expect(linkMode(page)).toHaveAttribute("data-mode", "place");

  await page.keyboard.up("Alt");
  await expect(linkMode(page)).toHaveAttribute("data-hint-mode", "place");
});

test("shift previews run on the purpose control, and neither the key nor a click stores it", async ({
  page,
}) => {
  await page.goto(workspaceUrl("purpose"));
  await expect(cards(page)).toHaveCount(2);
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");

  await page.keyboard.down("Shift");
  await expect(purpose(page)).toHaveAttribute("data-preview", "run");
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");

  // Clicking while the key is down is refused: the key is already the override, and
  // committing from it would give one gesture two endings.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");

  await page.keyboard.up("Shift");
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  await expect(purpose(page)).not.toHaveAttribute("data-preview");

  // Released, the click works again and lands on the next value in the cycle.
  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
});

test("a click mid-modifier leaves the link mode where the reader clicked it", async ({ page }) => {
  await page.goto(workspaceUrl("held"));
  await expect(cards(page)).toHaveCount(2);

  // Click twice to stand in fan mode, then hold ctrl — which previews fan, so the
  // stored mode and the preview agree and only the guard is under test.
  await linkMode(page).click();
  await linkMode(page).click();
  await expect(linkMode(page)).toHaveAttribute("data-mode", "fan");

  await page.keyboard.down("Alt");
  await expect(linkMode(page)).toHaveAttribute("data-hint-mode", "branch");
  await linkMode(page).click();
  await expect(linkMode(page)).toHaveAttribute("data-mode", "fan");

  await page.keyboard.up("Alt");
  await expect(linkMode(page)).toHaveAttribute("data-mode", "fan");
  await expect(linkMode(page)).toHaveAttribute("data-hint", "false");
});

/**
 * The author's state: the second value in both families, so each key was pointing at a
 * value already on screen and previewed nothing. A key now hands back what it
 * displaced, which is also the case where a look has to be *removed* from the chip
 * rather than added — the one the hint classes could not paint.
 */
test("a key hands back the value it displaced, in both families at once", async ({ page }) => {
  await page.goto(workspaceUrl("displaced"));
  await expect(cards(page)).toHaveCount(2);

  await linkMode(page).click();
  await expect(linkMode(page)).toHaveAttribute("data-mode", "thread");
  // Run mode reaches for the library's search field, and typing suppresses modifiers
  // (ADR-0066), so the reader clicks the canvas before reaching for a key.
  await page.getByTestId("purpose-toggle").click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
  await page.mouse.click(700, 80);

  await page.keyboard.down("Shift");

  // Shift is what chose thread, so it cannot mean thread again: it shows connect, and
  // the chip is repainted by `data-preview` because `data-mode` still says thread.
  await expect(linkMode(page)).toHaveAttribute("data-mode", "thread");
  await expect(linkMode(page)).toHaveAttribute("data-preview", "place");
  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
  await expect(purpose(page)).toHaveAttribute("data-preview", "explore");

  await page.keyboard.up("Shift");
  await expect(linkMode(page)).not.toHaveAttribute("data-preview");
  await expect(purpose(page)).not.toHaveAttribute("data-preview");
  await expect(linkMode(page)).toHaveAttribute("data-mode", "thread");
  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
});
