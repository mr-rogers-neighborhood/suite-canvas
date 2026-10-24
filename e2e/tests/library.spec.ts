import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { libraryRows, openLibrary } from "./support";

/**
 * The library drawer is shell, so it runs headless: every assertion here reads
 * rows, the inspector, or the view tabs. The canvas card faces ICE draws are
 * read-only and need WebGPU, so naming a card goes through the inspector — the
 * same document write, and the surface a headless run can see.
 *
 * Gone with the React Flow surfaces, and not replaced here:
 * - "shares one card across boards": placing a card on a second Board needs the
 *   ICE mat (a Board is a frame drawn on the desk, not a tab), so there is no
 *   shell path to it any more.
 * - "holds a card out of the drawer and drops it on the board": the drop target
 *   is still `[data-testid="ice-surface"]` in `LibraryDrawer`, which no longer
 *   exists, so the gesture is inert. That is an app bug, not a test bug; the
 *   test is deleted rather than pinned to broken behaviour.
 * - the section-subtree filter and grouping tests: their fixture was a Section
 *   drawn with `Control+g`, and the section layer is gone.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-ws-${name}-${Date.now()}-${++sequence}`);

/** Names the card opened from a library row through the inspector. */
async function nameFromInspector(page: Page, title: string): Promise<void> {
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  const inspector = page.getByTestId("card-inspector");
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
  // Leave the editor through the tab strip: Escape is the library's own shortcut
  // and would close the drawer the caller is still using.
  await page.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("inspector-close").click();
}

async function addTextField(page: Page, name: string): Promise<void> {
  // Metadata lives on the Details tab; blank cards open on Content.
  await page.getByTestId("card-panel-tab-details").click();
  await page.getByTestId("manage-types").click();
  await expect(page.getByTestId("type-settings")).toBeVisible();
  await page.getByLabel("New field name").fill(name);
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel(`Field name ${name}`)).toHaveValue(name);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("type-settings")).toHaveCount(0);
}

test("creates a card in the inbox and names it from the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("create"));
  await expect(page.getByTestId("ice-surface")).toBeVisible();

  await openLibrary(page, "inbox");
  await expect(libraryRows(page)).toHaveCount(0);
  await page.getByTestId("library-new-card").click();
  await expect(libraryRows(page)).toHaveCount(1);

  await libraryRows(page).first().click();
  await nameFromInspector(page, "Field notes");

  await page.getByTestId("library-tab-cards").click();
  await expect(libraryRows(page)).toHaveCount(3);
  await expect(libraryRows(page).filter({ hasText: "Field notes" })).toHaveCount(1);
});

test("trashes a card and restores it to its board", async ({ page }) => {
  await page.goto(workspaceUrl("trash"));
  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(2);

  await libraryRows(page).first().getByRole("button", { name: "Trash" }).click();
  await expect(libraryRows(page)).toHaveCount(1);

  await page.getByTestId("library-tab-trash").click();
  await expect(libraryRows(page)).toHaveCount(1);
  await libraryRows(page).first().getByRole("button", { name: "Restore" }).click();

  // Trash keeps the placement, so restoring puts the card back on its board.
  await page.getByTestId("library-tab-trash").click();
  await expect(libraryRows(page)).toHaveCount(0);
  await page.getByTestId("library-tab-cards").click();
  await expect(libraryRows(page)).toHaveCount(2);
});

test("still resolves a legacy ?doc= link to a workspace", async ({ page }) => {
  await page.goto(`/?doc=e2e-legacy-${Date.now()}`);
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(1);

  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(2);
});

test("scopes the cards list to the active board", async ({ page }) => {
  await page.goto(workspaceUrl("scope"));

  // One card leaves the board: a card created in the inbox has no placement.
  await openLibrary(page, "inbox");
  await page.getByTestId("library-new-card").click();
  await expect(libraryRows(page)).toHaveCount(1);

  await page.getByTestId("library-tab-cards").click();
  await expect(page.getByTestId("library-scope")).toBeVisible();
  await expect(libraryRows(page)).toHaveCount(3);

  await page.getByTestId("library-scope-board").click();
  await expect(libraryRows(page)).toHaveCount(2);

  await page.getByTestId("library-scope-all").click();
  await expect(libraryRows(page)).toHaveCount(3);

  // Inbox and Trash ignore scope, so they do not offer it.
  await page.getByTestId("library-tab-inbox").click();
  await expect(page.getByTestId("library-scope")).toHaveCount(0);
  await page.getByTestId("library-tab-trash").click();
  await expect(page.getByTestId("library-scope")).toHaveCount(0);
});

test("deletes an empty view without asking", async ({ page }) => {
  await page.goto(workspaceUrl("view-delete"));
  const tabs = page.locator('[role="tab"][data-testid^="board-tab"]');
  await expect(tabs).toHaveCount(1);

  await page.getByTestId("view-create").click();
  await expect(tabs).toHaveCount(2);

  // Nothing to lose, so no confirmation dialog.
  await page.getByLabel(/^Delete /).click();
  await expect(page.getByTestId("dialog")).toHaveCount(0);
  await expect(tabs).toHaveCount(1);
});

test("a library row opens the inspector, and edits land in the document", async ({ page }) => {
  await page.goto(workspaceUrl("row-panel"));
  await openLibrary(page, "cards");
  await libraryRows(page).first().click();

  const panel = page.getByTestId("card-inspector");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("card-panel")).toHaveAttribute("data-variant", "inspector");
  // The row is a list entry, never an editor of its own.
  await expect(page.getByTestId("library-row-panel")).toHaveCount(0);
  await expect(page.getByTestId("library-row-expand")).toHaveCount(0);

  await addTextField(page, "Status");
  const status = panel.getByLabel("Status");
  await status.fill("active");
  await status.blur();

  // A body typed in the inspector is the card's shared body.
  await panel.getByTestId("card-panel-tab-content").click();
  await panel.getByTestId("card-panel-body").click();
  await expect(panel.getByTestId("card-panel-body")).toHaveAttribute("data-editing", "true");
  // React StrictMode remounts the editor once in dev; let the focused instance settle.
  await page.waitForTimeout(300);
  await page.keyboard.type("From the row");
  await expect(panel.getByTestId("card-panel-body")).toContainText("From the row");

  // Reopening the same row keeps the document write: the field, not just the view.
  await panel.getByTestId("inspector-close").click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
  await libraryRows(page).first().click();
  await expect(panel.getByTestId("card-panel-tab-details")).toBeVisible();
  await panel.getByTestId("card-panel-tab-details").click();
  await expect(panel.getByLabel("Status")).toHaveValue("active");
});

test("syncs a card title to a peer's library", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = workspaceUrl("title-sync");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageB.locator(".app-canvas")).toHaveAttribute("data-ready", "true");

  await openLibrary(pageA, "cards");
  await expect(libraryRows(pageA)).toHaveCount(2);

  await openLibrary(pageB, "cards");
  await expect(libraryRows(pageB)).toHaveCount(2);

  await libraryRows(pageA).first().click();
  await nameFromInspector(pageA, "Shared title");
  await expect(libraryRows(pageA).filter({ hasText: "Shared title" })).toHaveCount(1);

  // The title is document truth, so the peer's list follows without a reload.
  await expect(libraryRows(pageB).filter({ hasText: "Shared title" })).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});

test("Control+K opens the library on Cards with the search focused", async ({ page }) => {
  await page.goto(workspaceUrl("shortcut"));
  // The chord is a window listener the dock installs on mount; wait for the
  // shell before pressing it.
  await expect(page.getByTestId("dock-library")).toBeVisible();
  await page.keyboard.press("Control+k");

  // The one shortcut that reaches across the app: it opens the drawer, picks the
  // Cards tab and hands focus to the query box.
  await expect(page.getByTestId("library-drawer")).toBeVisible();
  await expect(page.getByTestId("library-tab-cards")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("library-search")).toBeFocused();
});
