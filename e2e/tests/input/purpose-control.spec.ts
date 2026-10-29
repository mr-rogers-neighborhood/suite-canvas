import { expect, type Page, test } from "@playwright/test";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-purpose");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

const purpose = (page: Page) => page.getByTestId("purpose-toggle");
const library = (page: Page) => page.getByTestId("library-drawer");

/**
 * The control is one button with one choice (ADR-0064 amendment).
 *
 * It used to cycle explore → run → explain, and the modifier map pointed Shift at "run".
 * Both went: a run needs a queue, and only the library has one to give, so offering it
 * here was a mode that sent the reader elsewhere to finish choosing — and a purpose
 * preview on Shift meant holding Shift to *thread* was read as "run". What is left is
 * `explain`, which a reader can choose on its own.
 */
test("turns explain on and off, and offers nothing else", async ({ page }) => {
  await page.goto(workspaceUrl("toggle"));
  await expect(cards(page)).toHaveCount(2);

  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  await expect(library(page)).toHaveCount(0);

  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explain");
  await expect(page.getByTestId("explain-panel")).toBeVisible();
  // Explain is a reading, not a queue: nothing opened a drawer to feed it.
  await expect(library(page)).toHaveCount(0);

  await purpose(page).click();
  await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
  await expect(page.getByTestId("explain-panel")).toHaveCount(0);
});

test("a held modifier does not open the library or repaint the purpose", async ({ page }) => {
  await page.goto(workspaceUrl("modifiers"));
  await expect(cards(page)).toHaveCount(2);

  // Shift, Control and Alt belong to the relationship axis. Holding one must not open
  // the library or repaint the purpose button: a modifier is a gesture, not a mode.
  for (const key of ["Shift", "Control", "Alt"]) {
    await page.keyboard.down(key);
    await expect(purpose(page)).toHaveAttribute("data-purpose", "explore");
    await expect(library(page)).toHaveCount(0);
    await page.keyboard.up(key);
  }
});
