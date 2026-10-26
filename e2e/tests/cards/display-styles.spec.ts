import { expect, type Page, test } from "@playwright/test";
import { startBodyEdit } from "../../interactions";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-style-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

/** Names a card through the inspector's title editor. */
async function renameCard(
  page: Page,
  card: ReturnType<typeof cards>,
  title: string,
): Promise<void> {
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const inspector = page.getByTestId("card-inspector");
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
  await page.keyboard.press("Escape");
  await inspector.getByTestId("inspector-close").click();
  await expect(cards(page).filter({ hasText: title })).toHaveCount(1);
}

/** Adds a `Status` text field to the shared note type and fills it on one card. */
async function addStatusField(page: Page, title: string, value: string): Promise<void> {
  const card = cards(page).filter({ hasText: title });
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const inspector = page.getByTestId("card-inspector");
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Status");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Status")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  if (value) {
    await inspector.getByLabel("Status").fill(value);
    await inspector.getByLabel("Status").blur();
  }
  await inspector.getByTestId("inspector-close").click();
}

/** Opens the body editor of the card at `index` (titles can be matched by chips). */
async function editBody(page: Page, index: number): Promise<void> {
  await startBodyEdit(page, cards(page).nth(index));
}

test("styles a field once and every view follows", async ({ page }) => {
  await page.goto(workspaceUrl("field"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await renameCard(page, cards(page).nth(0), "Beta");
  await renameCard(page, cards(page).nth(1), "Notes");

  // One inspector session: create the field, style it, then fill it in.
  await cards(page).nth(0).getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const panel = page.getByTestId("card-inspector");
  await panel.getByTestId("card-panel-tab-details").click();
  await panel.getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Status");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Status")).toBeVisible();

  // Field ids are generated, so the row button is found by its accessible name.
  await settings.getByRole("button", { name: "Display style for Status" }).click();
  const dialog = page.getByTestId("display-style");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("display-template-input").fill("{{card}} → {{value}}");
  await expect(dialog.getByTestId("display-preview-template")).toHaveText("Card → Value");
  await dialog.getByTestId("display-save").click();
  await expect(dialog).toHaveCount(0);

  await settings.getByRole("button", { name: "Done" }).click();
  await panel.getByLabel("Status").fill("In progress");
  await panel.getByLabel("Status").blur();
  await panel.getByTestId("inspector-close").click();

  // A body block of that field renders the stored style.
  await editBody(page, 0);
  await page.keyboard.type("/property");
  await page.getByTestId("slash-option").filter({ hasText: "Property" }).click();
  await page
    .locator('[data-testid="mention-option"][data-kind="field"]')
    .filter({ hasText: "Status" })
    .click();
  const block = cards(page).nth(0).getByTestId("property-block");
  await expect(block).toContainText("Beta → ");
  await expect(block.getByTestId("property-block-value")).toHaveText("In progress");

  // A chip for the same field inherits it too, from another card's body.
  await page.keyboard.press("Escape");
  const source = cards(page).nth(1);
  await editBody(page, 1);
  await page.keyboard.type("@Bet");
  await page.keyboard.press(".");
  await page.keyboard.press("Enter");

  const chip = source.getByTestId("mention-chip");
  await expect(chip.getByTestId("mention-chip-value-template")).toHaveText("Beta → In progress");
  await expect(chip.getByTestId("mention-chip-value")).toHaveText("In progress");

  // An empty value keeps the template but shows a placeholder instead of nothing.
  await page.keyboard.press("Escape");
  await cards(page).nth(0).getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const betaPanel = page.getByTestId("card-inspector");
  await betaPanel.getByTestId("card-panel-tab-details").click();
  await betaPanel.getByLabel("Status").fill("");
  await betaPanel.getByLabel("Status").blur();
  await betaPanel.getByTestId("inspector-close").click();
  await expect(block.getByTestId("property-block-value")).toHaveText("\u2014");
});

test("overrides one mention without touching the field", async ({ page }) => {
  await page.goto(workspaceUrl("override"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await renameCard(page, cards(page).nth(0), "Beta");
  await renameCard(page, cards(page).nth(1), "Notes");
  await addStatusField(page, "Beta", "Done");

  await editBody(page, 1);
  await page.keyboard.type("@Bet");
  await page.keyboard.press(".");
  await page.keyboard.press("Enter");

  const card = cards(page).nth(1);
  const chip = card.getByTestId("mention-chip");
  await expect(chip.getByTestId("mention-chip-value-template")).toHaveText("@Beta · Done");

  // Click the chip → Display… → "Just this one".
  await chip.click();
  await page.getByRole("menuitem", { name: "Display…" }).click();
  const dialog = page.getByTestId("display-style");
  await dialog.getByTestId("display-template-input").fill("{{value}} (verified)");
  await dialog.getByTestId("display-scope-instance").check();
  await dialog.getByTestId("display-save").click();

  await expect(chip.getByTestId("mention-chip-value-template")).toHaveText("Done (verified)");
  await expect(chip).toHaveAttribute("data-overridden", "true");

  // The field is untouched: a second chip for the same field reads normally.
  // The dialog ended the edit session, so the body is reopened first.
  await editBody(page, 1);
  await page.keyboard.press("End");
  await page.keyboard.type(" @Bet");
  await page.keyboard.press(".");
  await page.keyboard.press("Enter");
  const chips = card.getByTestId("mention-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1).getByTestId("mention-chip-value-template")).toHaveText("@Beta · Done");

  // An override is stored on the mention, so it survives a reload.
  await page.reload();
  const reloaded = cards(page).nth(1).getByTestId("mention-chip");
  await expect(reloaded.nth(0).getByTestId("mention-chip-value-template")).toHaveText(
    "Done (verified)",
  );
  await expect(reloaded.nth(1).getByTestId("mention-chip-value-template")).toHaveText(
    "@Beta · Done",
  );
});
