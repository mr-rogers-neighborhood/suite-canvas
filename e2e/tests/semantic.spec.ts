import { expect, type Locator, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-sem-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function openInspector(page: Page, card: Locator): Promise<void> {
  await card.getByTestId("card-type").click();
  await expect(page.getByTestId("card-inspector")).toBeVisible();
}

async function addTextField(page: Page, name: string): Promise<void> {
  await page.getByTestId("manage-types").click();
  await expect(page.getByTestId("type-settings")).toBeVisible();
  await page.getByLabel("New field name").fill(name);
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel(`Field name ${name}`)).toHaveValue(name);
  await page.getByRole("button", { name: "Done" }).click();
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

  await page.getByRole("button", { name: "Initiative", exact: true }).click();
  await expect(page.getByLabel("Stage").last()).toBeVisible();
  await expect(cards(page).first().getByTestId("card-type")).toHaveAttribute(
    "aria-label",
    "Card type: Initiative",
  );
});

test("shows a type switch and keeps the hidden property dormant", async ({ page }) => {
  await page.goto(workspaceUrl("switch"));
  await expect(cards(page)).toHaveCount(2);

  await openInspector(page, cards(page).first());
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
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(2);

  await page.locator('[data-testid^="facet-tag-"]').first().click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(1);

  await page.getByTestId("clear-filters").click();
  await expect(page.locator('[data-testid^="library-item-"]')).toHaveCount(2);

  await page.locator('[data-testid^="facet-type-"]').first().click();
  await expect(page.getByTestId("clear-filters")).toBeVisible();
});
