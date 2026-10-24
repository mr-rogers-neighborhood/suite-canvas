import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { libraryRows, openLibrary, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-views");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

const search = (page: Page) => page.getByTestId("library-search");
const viewsButton = (page: Page) => page.getByTestId("views-menu-button");

/**
 * A saved view is a query copied back into the library's own controls, so the
 * same result set means the same rows for the same search.
 */
async function rowIds(page: Page): Promise<(string | null)[]> {
  return page
    .locator("li[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
}

/**
 * Names one starter card through the inspector. The canvas card face ICE draws
 * is read-only (ICE owns the pointer), and its title editor is behind WebGPU, so
 * the inspector is the one naming surface that works headless — and it writes
 * the same document.
 */
async function renameFirstCard(page: Page, title: string): Promise<void> {
  await openLibrary(page, "cards");
  await libraryRows(page).first().click();
  const inspector = page.getByTestId("card-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
  await inspector.getByTestId("inspector-close").click();
  await expect(libraryRows(page).filter({ hasText: title })).toHaveCount(1);
}

test("saves a search as a view, reapplies it, renames it and deletes it", async ({ page }) => {
  await page.goto(workspaceUrl("save-apply"));
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await renameFirstCard(page, "Planning retro");

  // The app bar's menu is the only entry point, and it is named "Views".
  await expect(page.getByRole("button", { name: "Views" })).toBeVisible();

  await openLibrary(page, "cards");
  await search(page).fill("retro");
  await expect(libraryRows(page)).toHaveCount(1);
  const saved = await rowIds(page);

  await viewsButton(page).click();
  await expect(page.getByTestId("views-menu")).toBeVisible();
  await page.getByTestId("views-save").click();
  const nameInput = page.getByTestId("views-save-input");
  // The suggested name is the query itself, so saving is one Enter away.
  await expect(nameInput).toHaveValue("retro");
  await nameInput.fill("Retro pass");
  await page.getByTestId("views-save-commit").click();
  // Saving closes the menu; the button now names the active view.
  await expect(viewsButton(page)).toHaveText(/Retro pass/);

  // Leave the view: its query and filters are dropped from the controls.
  await viewsButton(page).click();
  await expect(page.locator('[data-testid^="views-item-"]').first()).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.getByTestId("views-exit").click();
  await expect(search(page)).toHaveValue("");
  await expect(libraryRows(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Views" })).toBeVisible();

  // Re-applying the stored query restores exactly the rows it was saved with.
  await viewsButton(page).click();
  await page.locator('[data-testid^="views-item-"]').first().click();
  await expect(search(page)).toHaveValue("retro");
  await expect(libraryRows(page)).toHaveCount(1);
  expect(await rowIds(page)).toEqual(saved);
  await expect(libraryRows(page)).toContainText("Planning retro");

  // The view owns its name; rename happens in the menu itself.
  await viewsButton(page).click();
  await page.getByRole("button", { name: "Rename Retro pass" }).click();
  await page.getByTestId("views-rename-input").fill("Retro review");
  await page.getByTestId("views-rename-input").press("Enter");
  await expect(viewsButton(page)).toHaveText(/Retro review/);

  // Deleting is confirmed inline and the active view is exited with it.
  await page.getByRole("button", { name: "Delete Retro review" }).click();
  await page.getByTestId("views-delete-confirm").click();
  await expect(page.getByTestId("views-empty")).toBeVisible();
  await expect(search(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Views" })).toBeVisible();
});

test("a saved view reopens the library on the Cards tab", async ({ page }) => {
  await page.goto(workspaceUrl("reopen"));
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await renameFirstCard(page, "Grading pass");

  await openLibrary(page, "cards");
  await search(page).fill("grading");
  await viewsButton(page).click();
  await page.getByTestId("views-save").click();
  await page.getByTestId("views-save-input").fill("Grading");
  await page.getByTestId("views-save-commit").click();

  // Closing the drawer entirely: the view must bring it back, on Cards.
  await page.getByTestId("dock-library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);

  await viewsButton(page).click();
  await page.locator('[data-testid^="views-item-"]').first().click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
  await expect(page.getByTestId("library-tab-cards")).toHaveAttribute("data-active", "true");
  await expect(search(page)).toHaveValue("grading");
  await expect(libraryRows(page)).toHaveCount(1);
  await expect(libraryRows(page)).toContainText("Grading pass");
});
