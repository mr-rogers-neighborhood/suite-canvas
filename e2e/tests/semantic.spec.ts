import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { expectCardCount, openCardInspector } from "./support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-sem-${name}-${Date.now()}-${++sequence}`);

/**
 * Opens one card's inspector from the library and lands on Details.
 *
 * Types, tags and properties are inspector state; the canvas card that used to
 * be clicked (its `card-type` button) is drawn by ICE and has no DOM.
 */
async function openInspector(page: Page, index = 0): Promise<void> {
  await openCardInspector(page, { index });
  // Blank cards open on Content; types, tags and properties live on Details.
  await page.getByTestId("card-panel-tab-details").click();
  await expect(page.getByTestId("card-panel-details")).toBeVisible();
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
  await expectCardCount(page, 2);

  await openInspector(page);
  await addTextField(page, "Status");
  await setProperty(page, "Status", "active");

  await page.getByTestId("tag-input").fill("research");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("tag-chip")).toContainText("research");

  await page.reload();
  await expectCardCount(page, 2);
  await openInspector(page);

  await expect(page.getByLabel("Status").last()).toHaveValue("active");
  await expect(page.getByTestId("tag-chip")).toContainText("research");
});

test("creates a type with a field and applies it from the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("new-type"));
  await expectCardCount(page, 2);

  await openInspector(page);
  await page.getByTestId("manage-types").click();
  await page.getByLabel("New type name").fill("Initiative");
  await page.getByTestId("create-type").click();
  await page.getByLabel("New field name").fill("Stage");
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel("Field name Stage")).toHaveValue("Stage");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Initiative", exact: true }).click();
  await expect(page.getByLabel("Stage").last()).toBeVisible();
  // The type switch is where the applied type is readable now. The new type's
  // id is generated, so the switch's own label is the stable handle.
  await expect(
    page.getByTestId("type-picker").getByRole("button", { name: "Initiative", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("shows a type switch and keeps the hidden property dormant", async ({ page }) => {
  await page.goto(workspaceUrl("switch"));
  await expectCardCount(page, 2);

  await openInspector(page);
  await addTextField(page, "Status");
  await setProperty(page, "Status", "active");

  await page.getByTestId("type-option-concept").click();
  await expect(page.getByTestId("type-option-concept")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("property-list")).toHaveCount(0);

  await page.getByTestId("type-option-note").click();
  await expect(page.getByLabel("Status").last()).toHaveValue("active");
});

test("propagates a property and a tag to a collaborator", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = workspaceUrl("collab");

  await pageA.goto(url);
  await pageB.goto(url);
  await expectCardCount(pageA, 2);
  await expectCardCount(pageB, 2);

  await openInspector(pageA);
  await addTextField(pageA, "Status");

  await setProperty(pageA, "Status", "active");
  await pageA.getByTestId("tag-input").fill("research");
  await pageA.getByTestId("tag-input").press("Enter");

  await openInspector(pageB);
  await expect(pageB.getByLabel("Status").last()).toHaveValue("active");
  await expect(pageB.getByTestId("tag-chip")).toContainText("research");

  await contextA.close();
  await contextB.close();
});

test("filters the library by type and tag, then clears", async ({ page }) => {
  await page.goto(workspaceUrl("facets"));
  await expectCardCount(page, 2);

  await openInspector(page);
  await page.getByTestId("tag-input").fill("research");
  await page.getByTestId("tag-input").press("Enter");
  await page.getByTestId("inspector-close").click();

  // The row that opened the inspector left the drawer open on Cards.
  await expect(page.getByTestId("library-drawer")).toBeVisible();
  await page.getByTestId("library-tab-cards").click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(2);

  await page.locator('[data-testid^="facet-tag-"]').first().click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(1);

  await page.getByTestId("clear-filters").click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(2);

  await page.locator('[data-testid^="facet-type-"]').first().click();
  await expect(page.getByTestId("clear-filters")).toBeVisible();
});

test("edits every scalar field kind and survives a reload", async ({ page }) => {
  await page.goto(workspaceUrl("kinds"));
  await expectCardCount(page, 2);

  await openInspector(page);
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
  await expectCardCount(page, 2);
  await openInspector(page);
  const reloaded = page.getByTestId("card-panel");
  await expect(reloaded.getByLabel("Owner")).toHaveValue("Ada");
  await expect(reloaded.getByLabel("Estimate")).toHaveValue("5.5");
  await expect(reloaded.getByLabel("Due")).toHaveValue("2026-10-22");
  await expect(reloaded.getByLabel("Stage")).toHaveValue(/.+/);
  await expect(reloaded.getByLabel("Labels: Research")).toHaveAttribute("aria-pressed", "true");
  await expect(reloaded.getByLabel("Labels: Design")).toHaveAttribute("aria-pressed", "true");
  await expect(reloaded.getByLabel("Done")).toBeChecked();
});
