import { expect, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-modifiers");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

const linkMode = (page: import("@playwright/test").Page) => page.getByTestId("link-mode-toggle");
const purpose = (page: import("@playwright/test").Page) => page.getByTestId("purpose-toggle");

/**
 * The one modifier map ([ADR-0066](../../docs/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md)).
 *
 * Both families read the same positions, and a modifier only previews: the stored
 * value moves on a click, never on a keypress, because these keys are also undo
 * and multi-select.
 */
test("alt previews pattern, the fourth gesture that had no key", async ({ page }) => {
  await page.goto(workspaceUrl("pattern"));
  await expect(cards(page)).toHaveCount(2);
  await expect(linkMode(page)).toHaveAttribute("data-mode", "place");

  await page.keyboard.down("Alt");

  // The indicator follows the key...
  await expect(linkMode(page)).toHaveAttribute("data-hint-mode", "pattern");
  await expect(linkMode(page)).toHaveAttribute("data-hint", "true");
  // ...and the tool is still where the reader left it.
  await expect(linkMode(page)).toHaveAttribute("data-mode", "place");

  await page.keyboard.up("Alt");
  await expect(linkMode(page)).toHaveAttribute("data-hint-mode", "place");
});

test("shift previews run on the purpose control, and a click commits it", async ({ page }) => {
  await page.goto(workspaceUrl("purpose"));
  await expect(cards(page)).toHaveCount(2);
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");

  await page.keyboard.down("Shift");
  await expect(purpose(page)).toHaveAttribute("data-preview", "run");
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");

  // The same modifier plus a click is the shortcut for the value it previewed.
  await purpose(page).click();
  await page.keyboard.up("Shift");

  await expect(purpose(page)).toHaveAttribute("data-purpose", "run");
  await expect(purpose(page)).not.toHaveAttribute("data-preview");
});
