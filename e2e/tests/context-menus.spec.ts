import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { createTitledCard, libraryRows, openLibrary, requireIceDesk } from "./support";

/**
 * Right-click is two different menus on ICE, and neither is React Flow's:
 *
 * - On the desk (empty canvas or a card), the ICE surface's own `contextmenu`
 *   listener picks what is under the pointer and opens the *shell* menu — the
 *   same `ContextMenu` the scene surface used, built by `useCanvasMenuItems`.
 *   ICE has no section layer and no connector layer, so those entries are not
 *   offered at all (`supportsSections`/`supportsConnectors` are false).
 * - Inside a rich-text editor, the browser keeps its native menu. The card face
 *   ICE draws is read-only, so the editable body lives in the inspector; the
 *   guard is the same one, and the tests below exercise it there.
 */

// Serial on purpose: two of these tests drive the live desk, and Playwright's
// full parallelism would open two headed Chrome windows that fight over the
// pointer. The rest are a few seconds each.
test.describe.configure({ timeout: 60_000, mode: "serial" });

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-context-menus-${name}-${Date.now()}-${++sequence}`);

const menu = (page: Page) => page.getByTestId("context-menu");
const panel = (page: Page) => page.getByTestId("card-inspector");

/** Waits until the ICE desk is drawing, which is what the shell menu needs. */
async function awaitDesk(page: Page): Promise<void> {
  await expect(page.getByTestId("ice-status")).toHaveText("engine: ready", { timeout: 90_000 });
  await expect(page.locator('[data-testid="ice-surface"] canvas').first()).toBeVisible();
}

/** Opens a card's inspector from the library, without touching the desk. */
async function openCard(page: Page, title: string): Promise<void> {
  await openLibrary(page, "cards");
  await libraryRows(page).filter({ hasText: title }).first().click();
  await expect(panel(page)).toBeVisible();
}

/** Focuses the body editor in the inspector, which is the one editable body. */
async function editBody(page: Page): Promise<void> {
  await panel(page).getByTestId("card-panel-tab-content").click();
  await panel(page).getByTestId("card-panel-body").click();
  await expect(panel(page).getByTestId("card-panel-body")).toHaveAttribute("data-editing", "true");
  // React StrictMode remounts the editor once in dev; let the focused instance settle.
  await page.waitForTimeout(250);
}

/** Adds a `Status` text field to the shared note type and fills it on the card. */
async function addStatusField(page: Page, value: string): Promise<void> {
  await panel(page).getByTestId("card-panel-tab-details").click();
  await panel(page).getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Status");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Status")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await panel(page).getByLabel("Status").fill(value);
  await panel(page).getByLabel("Status").blur();
}

test("opens the shell menu on the empty desk, without section or connector entries", async ({
  page,
}) => {
  requireIceDesk();
  await page.goto(workspaceUrl("canvas"));
  await awaitDesk(page);

  await page.mouse.click(780, 420, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "New note" })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "New board" })).toBeVisible();

  // ICE has no section layer, so the section entry cannot be offered.
  await expect(menu(page).getByRole("menuitem", { name: "New section" })).toHaveCount(0);

  // The entry writes through the document; the library is where a headless DOM
  // can count the cards the desk is drawing.
  await menu(page).getByRole("menuitem", { name: "New note" }).click();
  await expect(menu(page)).toHaveCount(0);
  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(3);
});

test("keeps the card menu on the read-only card face", async ({ page }) => {
  requireIceDesk();
  await page.goto(workspaceUrl("card"));
  await awaitDesk(page);

  // Put a card under a point we chose, so the pick below is deterministic.
  await page.mouse.click(780, 420, { button: "right" });
  await menu(page).getByRole("menuitem", { name: "New note" }).click();
  await expect(menu(page)).toHaveCount(0);

  // The card face is read-only (ICE owns the pointer), so nothing is being
  // edited and the card menu is the right one. A note lands with its top-left at
  // the click, so the pick has to aim inside the sheet.
  await page.mouse.click(860, 470, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Delete card" })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Position" })).toBeVisible();
  // No connector layer on ICE, so no connector entry.
  await expect(menu(page).getByRole("menuitem", { name: "Add connector" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
});

test("leaves ordinary body text to the browser's native menu", async ({ page }) => {
  await page.goto(workspaceUrl("native"));
  await openCard(page, "Untitled");
  await editBody(page);

  await page.keyboard.type("Ordinary body text");
  await expect(panel(page).getByTestId("card-panel-body")).toContainText("Ordinary body text");

  // The editor owns its own selection menu (copy, paste, spelling): no app menu
  // renders over it. The browser's menu itself cannot be asserted from here.
  await panel(page).getByTestId("card-panel-body").locator(".ProseMirror p").first().click({
    button: "right",
  });
  await expect(menu(page)).toHaveCount(0);
});

test("keeps the app menu on a field mention", async ({ page }) => {
  await page.goto(workspaceUrl("mention"));
  // The named card is the mention target; the starter cards stay untitled, so
  // the row lookups stay unambiguous.
  await createTitledCard(page, "Target card");

  // The field belongs to the *target*: a mention offers the fields of the card
  // it names, and the picker never offers the card being edited.
  await openCard(page, "Target card");
  await addStatusField(page, "In progress");

  await openCard(page, "Untitled");
  await editBody(page);
  await page.keyboard.type("@Targ");
  const options = page.getByTestId("mention-option");
  await expect(options.first()).toBeVisible({ timeout: 10_000 });
  // The first row names the card; the next one is its field.
  await expect(options.nth(1)).toHaveAttribute("data-kind", "reference");
  await expect(options.nth(1)).toContainText("Status");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  const chip = panel(page).getByTestId("mention-chip");
  await expect(chip).toHaveAttribute("data-field-id", /[\w-]+/, { timeout: 10_000 });

  // The chip stops propagation, so the app menu wins over the rich-text guard.
  await chip.click({ button: "right" });
  await expect(menu(page)).toBeVisible({ timeout: 10_000 });
  await expect(menu(page).getByRole("menuitem", { name: "Open card" })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Display\u2026" })).toBeVisible();
});

test("keeps the app menu on a property block", async ({ page }) => {
  await page.goto(workspaceUrl("property"));
  await openCard(page, "Untitled");
  await addStatusField(page, "In progress");
  await editBody(page);

  await page.keyboard.type("/property");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.getByTestId("slash-option").filter({ hasText: "Property" }).click();
  const fieldOption = page.locator('[data-testid="mention-option"][data-kind="field"]');
  await expect(fieldOption).toContainText("Status");
  await fieldOption.click();

  const block = panel(page).getByTestId("property-block");
  await expect(block).toHaveCount(1);
  const value = block.getByTestId("property-block-value");
  await expect(value).toHaveText("In progress");

  // The chip stops propagation, so the app menu wins over the rich-text guard.
  await value.click({ button: "right" });
  await expect(menu(page)).toBeVisible({ timeout: 10_000 });
  await expect(menu(page).getByRole("menuitem", { name: "Open card" })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Display…" })).toBeVisible();
});
