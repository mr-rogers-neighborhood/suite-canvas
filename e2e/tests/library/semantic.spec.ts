import { expect, type Locator, type Page, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-sem-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
/** The library rows that are cards. Boards are rows in Cards too, and are not these. */
const cardRows = (page: Page) => page.locator('li[data-row-id][data-row-kind="card"]');

/**
 * Opens a card's inspector from its own menu. A press on the text does the same in
 * reading mode, but the menu is the door that means the same thing in every mode and
 * does not depend on where the card happens to sit on the board.
 */
async function openInspector(page: Page, card: Locator): Promise<void> {
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  // Blank cards open on Content; types, tags and properties live on Details.
  await page.getByTestId("card-panel-tab-details").click();
}

async function addTextField(page: Page, name: string): Promise<void> {
  await page.getByTestId("manage-types").click();
  await expect(page.getByTestId("type-settings")).toBeVisible();
  await page.getByLabel("New field name").fill(name);
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel(`Field name ${name}`)).toHaveValue(name);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("type-settings")).toHaveCount(0);
}

async function setProperty(page: Page, name: string, value: string): Promise<void> {
  const input = page.getByLabel(name).last();
  await input.fill(value);
  await input.blur();
}

test("adds a field, edits a property with a tag, and survives a reload", async ({ page }) => {
  await page.goto(workspaceUrl("persist"));
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cards(page).first());
  await addTextField(page, "Status");
  await setProperty(page, "Status", "active");

  await page.getByTestId("tag-input").fill("research");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("tag-chip")).toContainText("research");

  await page.reload();
  await expect(cards(page)).toHaveCount(2, { timeout: 20_000 });
  await openInspector(page, cards(page).first());

  await expect(page.getByLabel("Status").last()).toHaveValue("active");
  await expect(page.getByTestId("tag-chip")).toContainText("research");
});

test("creates a type with a field and applies it from the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("new-type"));
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cards(page).first());
  await page.getByTestId("manage-types").click();
  await page.getByLabel("New type name").fill("Initiative");
  await page.getByTestId("create-type").click();
  await page.getByLabel("New field name").fill("Stage");
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel("Field name Stage")).toHaveValue("Stage");
  await page.getByRole("button", { name: "Done" }).click();

  // A second type is added from the picker's "+ Type" menu (ADR-0053): it
  // contributes fields and cannot change how the card looks.
  await page.getByTestId("type-add").click();
  await page.getByRole("menuitem", { name: "Initiative" }).click();
  await expect(page.getByTestId("type-picker")).toContainText("Initiative");
  await expect(page.getByLabel("Stage").last()).toBeVisible();

  // Presentation belongs to the primary, so changing the primary is the action
  // that changes what the card reads as.
  await page.getByTestId("type-primary-menu").click();
  await page.getByRole("menuitem", { name: "Initiative" }).click();
  await expect(cards(page).first().getByTestId("card-type")).toHaveAttribute(
    "aria-label",
    "Card type: Initiative",
  );
});

test("adds a second type and keeps a removed type's property dormant", async ({ page }) => {
  await page.goto(workspaceUrl("switch"));
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cards(page).first());
  await addTextField(page, "Status");
  await setProperty(page, "Status", "active");

  // A second type unions fields in: the Note field the card already has stays.
  await page.getByTestId("type-add").click();
  await page.getByRole("menuitem", { name: "Concept" }).click();
  await expect(page.getByTestId("type-picker")).toContainText("Concept");
  await expect(page.getByLabel("Status").last()).toHaveValue("active");

  // Make Concept primary, then drop Note: its field hides with its type.
  await page.getByTestId("type-primary-menu").click();
  await page.getByRole("menuitem", { name: "Concept" }).click();
  await page.getByRole("button", { name: "Remove type Note" }).click();
  await expect(page.getByTestId("property-list")).toHaveCount(0);

  // Adding the type back revives the value, which was never erased.
  await page.getByTestId("type-add").click();
  await page.getByRole("menuitem", { name: "Note" }).click();
  await expect(page.getByLabel("Status").last()).toHaveValue("active");
});

test("propagates a property and a tag to a collaborator", async ({ browser }) => {
  const contextA = await browser.newContext({ storageState: ACCOUNT_STATE });
  const contextB = await browser.newContext({ storageState: ACCOUNT_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = hostedUrl(workspaceUrl("collab"));

  await pageA.goto(url);
  await pageB.goto(url);
  await expect(cards(pageA)).toHaveCount(2);
  await expect(cards(pageB)).toHaveCount(2);

  await openInspector(pageA, cards(pageA).first());
  await addTextField(pageA, "Status");
  await expect(cards(pageB).first()).toBeVisible();

  await setProperty(pageA, "Status", "active");
  await pageA.getByTestId("tag-input").fill("research");
  await pageA.getByTestId("tag-input").press("Enter");

  await openInspector(pageB, cards(pageB).first());
  await expect(pageB.getByLabel("Status").last()).toHaveValue("active");
  await expect(pageB.getByTestId("tag-chip")).toContainText("research");

  await contextA.close();
  await contextB.close();
});

test("filters the library by type and tag, then clears", async ({ page }) => {
  await page.goto(workspaceUrl("facets"));
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cards(page).first());
  await page.getByTestId("tag-input").fill("research");
  await page.getByTestId("tag-input").press("Enter");
  await page.getByTestId("inspector-close").click();

  await page.getByTestId("dock-library").click();
  await page.getByTestId("library-tab-cards").click();
  await expect(cardRows(page)).toHaveCount(2);

  await page.locator('[data-testid^="facet-tag-"]').first().click();
  await expect(cardRows(page)).toHaveCount(1);

  await page.getByTestId("clear-filters").click();
  await expect(cardRows(page)).toHaveCount(2);

  await page.locator('[data-testid^="facet-type-"]').first().click();
  await expect(page.getByTestId("clear-filters")).toBeVisible();
});

test("edits every scalar field kind and survives a reload", async ({ page }) => {
  await page.goto(workspaceUrl("kinds"));
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cards(page).first());
  await page.getByTestId("manage-types").click();
  await expect(page.getByTestId("type-settings")).toBeVisible();

  const fields: Array<{ name: string; kind: string; options?: string }> = [
    { name: "Owner", kind: "text" },
    { name: "Estimate", kind: "number" },
    { name: "Due", kind: "date" },
    { name: "Stage", kind: "select", options: "Backlog, Doing" },
    { name: "Labels", kind: "multiSelect", options: "Research, Design" },
    { name: "Done", kind: "checkbox" },
  ];
  for (const entry of fields) {
    await page.getByLabel("New field name").fill(entry.name);
    await page.getByLabel("New field kind").selectOption(entry.kind);
    if (entry.options) await page.getByLabel("New field options").fill(entry.options);
    await page.getByTestId("create-field").click();
    await expect(page.getByLabel(`Field name ${entry.name}`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByTestId("type-settings")).toHaveCount(0);

  const panel = page.getByTestId("card-panel");
  await panel.getByLabel("Owner").fill("Ada");
  await panel.getByLabel("Owner").blur();
  await panel.getByLabel("Estimate").fill("5.5");
  await panel.getByLabel("Estimate").blur();
  await panel.getByLabel("Due").fill("2026-10-22");
  await panel.getByLabel("Due").blur();
  await panel.getByLabel("Stage").selectOption({ label: "Doing" });
  await panel.getByLabel("Labels: Research").click();
  await panel.getByLabel("Labels: Design").click();
  await panel.getByLabel("Done").click();

  await page.reload();
  await expect(cards(page)).toHaveCount(2, { timeout: 20_000 });
  await openInspector(page, cards(page).first());
  const reloaded = page.getByTestId("card-panel");
  await expect(reloaded.getByLabel("Owner")).toHaveValue("Ada");
  await expect(reloaded.getByLabel("Estimate")).toHaveValue("5.5");
  await expect(reloaded.getByLabel("Due")).toHaveValue("2026-10-22");
  await expect(reloaded.getByLabel("Stage")).toHaveValue(/.+/);
  await expect(reloaded.getByLabel("Labels: Research")).toHaveAttribute("aria-pressed", "true");
  await expect(reloaded.getByLabel("Labels: Design")).toHaveAttribute("aria-pressed", "true");
  await expect(reloaded.getByLabel("Done")).toBeChecked();
});
