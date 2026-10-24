import { expect, type Page, test } from "@playwright/test";
import {
  createTitledCard,
  inspector,
  libraryRows,
  openCardInspector,
  openLibrary,
} from "./support";

/**
 * The reference index is document data and the inspector is where its two lists
 * render (`links-in`, `links-out`), so this file runs headless.
 *
 * What is missing, and why: the "drawn arrow" test needed a connector drag
 * between two cards and an edge row that names the Board it was drawn on; ICE
 * has no connector or edge layer, so there is nothing to draw and nothing to
 * list. The "navigates to the source" half of the property test needed the same
 * card placed on a second Board, which is a mat gesture on the ICE desk.
 */

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-refs-${name}-${Date.now()}-${++sequence}`;

/** Names a card through the inspector, leaving the library open underneath. */
async function rename(page: Page, title: string): Promise<void> {
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await inspector(page).getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
}

/** Names the two starter cards so rows can be asserted by text. */
async function nameStarterCards(page: Page): Promise<void> {
  await openLibrary(page, "cards");
  const rows = libraryRows(page);
  await rows.nth(0).click();
  await rename(page, "Alpha");
  await inspector(page).getByTestId("inspector-close").click();
  await rows.nth(1).click();
  await rename(page, "Beta");
  await inspector(page).getByTestId("inspector-close").click();
}

test("links through a card property and both ends report the link", async ({ page }) => {
  await page.goto(workspaceUrl("property"));
  await nameStarterCards(page);

  // A `card` field's name is the relation, so the link is the property's value.
  await openCardInspector(page, { title: "Alpha" });
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await inspector(page).getByTestId("manage-types").click();
  await page.getByLabel("New field name").fill("Related");
  await page.getByLabel("New field kind").selectOption("card");
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel("Field name Related")).toHaveValue("Related");
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByLabel("Related").last().fill("Beta");
  await page.getByTestId("card-option").filter({ hasText: "Beta" }).click();
  await expect(page.getByTestId("card-picker-selected")).toHaveText("Beta");
  await inspector(page).getByTestId("inspector-close").click();

  // Both ends of the pair report one link, read from the inspector.
  await openCardInspector(page, { title: "Beta" });
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await expect(inspector(page).getByTestId("inspector-link-count")).toContainText("1");
  const incoming = inspector(page).getByTestId("links-in").getByTestId("link-row");
  await expect(incoming).toContainText("Related");
  await expect(incoming).toContainText("Alpha");
  await inspector(page).getByTestId("inspector-close").click();

  await openCardInspector(page, { title: "Alpha" });
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await expect(inspector(page).getByTestId("inspector-link-count")).toContainText("1");
  const outgoing = inspector(page).getByTestId("links-out").getByTestId("link-row");
  await expect(outgoing).toContainText("Beta");
});

test("shows the empty state and hides the count for a fresh card", async ({ page }) => {
  await page.goto(workspaceUrl("empty"));
  await openCardInspector(page, { index: 0 });
  await inspector(page).getByTestId("card-panel-tab-details").click();

  await expect(inspector(page).getByTestId("inspector-link-count")).toHaveCount(0);
  await expect(inspector(page).getByTestId("card-links")).toBeVisible();
  await expect(inspector(page).getByTestId("links-empty")).toHaveText(
    "No links yet. Type @ in a card, or draw an arrow between two cards.",
  );
});

test("a titled card has no links until something points at it", async ({ page }) => {
  await page.goto(workspaceUrl("titled"));
  await createTitledCard(page, "Lonely note");
  await openCardInspector(page, { title: "Lonely note" });
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await expect(inspector(page).getByTestId("links-empty")).toBeVisible();
});
