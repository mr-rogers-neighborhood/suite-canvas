import { expect, type Page, test } from "@playwright/test";
import { startBodyEdit as editBody } from "../interactions";
import { withOwnerKey } from "./ownerUrl";

test.describe.configure({ timeout: 60_000 });

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-context-menus-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function emptyCanvasPoint(page: Page, variant = 0): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");

  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY, variant }) => {
      const candidates: { x: number; y: number }[] = [];
      for (let fy = 0.12; fy < 0.95; fy += 0.08) {
        for (let fx = 0.12; fx < 0.95; fx += 0.08) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          const element = document.elementFromPoint(offsetX + x, offsetY + y);
          if (!element) continue;
          if (element.closest('[data-testid="node-card"]')) continue;
          if (element.closest(".react-flow__panel")) continue;
          if (element.closest(".react-flow__pane"))
            candidates.push({ x: offsetX + x, y: offsetY + y });
        }
      }
      if (candidates.length === 0) return null;
      return candidates[(variant * 17) % candidates.length];
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y, variant },
  );

  if (!point) throw new Error("no empty canvas point found");
  return point;
}

/** Creates a note and commits a title, leaving no editor focused. */
async function createNote(page: Page, title: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const point = await emptyCanvasPoint(page, attempt);
    await page.mouse.click(point.x, point.y, { button: "right" });
    const newNote = page.getByRole("menuitem", { name: "New note" });
    // A click can land on a card that mounted after the scan; try elsewhere.
    if (!(await newNote.isVisible({ timeout: 800 }).catch(() => false))) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      continue;
    }
    await newNote.click();
    await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.waitForTimeout(300);
    await page.keyboard.type(title);
    await page.keyboard.press("Escape");
    await expect(cards(page).filter({ hasText: title })).toHaveCount(1);
    return;
  }
  throw new Error("could not open the canvas menu");
}

/** Opens the inspector with a click on the card header, not the editors. */
async function openCardInfo(page: Page, card = cards(page).first()): Promise<void> {
  const inspector = page.getByTestId("card-inspector");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await card.click({ position: { x: 80, y: 24 } });
    if (await inspector.isVisible().catch(() => false)) return;
    await page.waitForTimeout(150);
  }
  await expect(inspector).toBeVisible();
}

/** Adds a `Status` text field to the shared note type and fills it on one card. */
async function addStatusField(page: Page, card: ReturnType<typeof cards>): Promise<void> {
  await openCardInfo(page, card);
  const inspector = page.getByTestId("card-inspector");
  // The inspector opens on Content for an empty card; fields live in Details.
  const detailsTab = inspector.getByTestId("card-panel-tab-details");
  if (await detailsTab.count()) await detailsTab.click();
  await inspector.getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Status");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Status")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await inspector.getByLabel("Status").fill("In progress");
  await inspector.getByLabel("Status").blur();
  await inspector.getByTestId("inspector-close").click();
}

test("leaves ordinary body text to the browser's native menu", async ({ page }) => {
  await page.goto(workspaceUrl("native"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  await createNote(page, "Body host");
  const card = cards(page).filter({ hasText: "Body host" });
  await editBody(page, card);

  await page.keyboard.type("Ordinary body text");
  const body = card.getByTestId("card-body");
  await expect(body).toContainText("Ordinary body text");

  // React Flow must not turn this into the card menu: the browser owns the
  // menu here (copy, paste, spelling), so no app menu renders at all.
  await body.locator(".node-card-editor p").first().click({ button: "right" });
  await expect(page.getByTestId("context-menu")).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Edit body" })).toHaveCount(0);
});

test("keeps the card menu on a read-only body", async ({ page }) => {
  await page.goto(workspaceUrl("readonly"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  await createNote(page, "Idle card");
  const card = cards(page).filter({ hasText: "Idle card" });
  await expect(card.getByTestId("card-body").locator(".ProseMirror-focused")).toHaveCount(0);

  // Nothing is being edited, so the card menu is still the right one.
  await card.click({ button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Add connector" })).toBeVisible();
});

test("keeps the app menu on a field mention", async ({ page }) => {
  await page.goto(workspaceUrl("mention"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  await createNote(page, "Target card");
  await createNote(page, "Source card");
  await addStatusField(page, cards(page).filter({ hasText: "Target card" }));

  const source = cards(page).filter({ hasText: "Source card" });
  await editBody(page, source);
  await page.keyboard.type("@Targ");
  const options = page.getByTestId("mention-option");
  await expect(options.first()).toBeVisible({ timeout: 10_000 });
  // The first row names the card; the next one is its field.
  await expect(options.nth(1)).toHaveAttribute("data-kind", "reference");
  await expect(options.nth(1)).toContainText("Status");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  const chip = source.getByTestId("mention-chip");
  await expect(chip).toHaveAttribute("data-field-id", /[\w-]+/, { timeout: 10_000 });

  // The chip stops propagation, so the app menu survives the rich-text guard.
  await chip.click({ button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await expect(menu.getByRole("menuitem", { name: "Open card" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Display…" })).toBeVisible();
});

test("keeps the app menu on a property block", async ({ page }) => {
  await page.goto(workspaceUrl("property"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  const card = cards(page).first();
  await addStatusField(page, card);

  await editBody(page, card);
  await page.keyboard.type("/property");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.getByTestId("slash-option").filter({ hasText: "Property" }).click();
  const fieldOption = page.locator('[data-testid="mention-option"][data-kind="field"]');
  await expect(fieldOption).toContainText("Status");
  await fieldOption.click();

  const block = card.getByTestId("property-block");
  await expect(block).toHaveCount(1);
  const value = block.getByTestId("property-block-value");
  await expect(value).toHaveText("In progress");

  // The chip stops propagation, so the app menu survives the rich-text guard.
  await value.click({ button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await expect(menu.getByRole("menuitem", { name: "Open card" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Display…" })).toBeVisible();
});
