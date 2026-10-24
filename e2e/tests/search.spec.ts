import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import {
  createTitledCard,
  inspector,
  libraryRows,
  openCardInspector,
  openLibrary,
  rowIdFor,
  workspaceIdFactory,
} from "./support";

/**
 * Search is a library feature, so this file needs no GPU: cards are created and
 * named through the inbox and the inspector, and every assertion reads rows.
 * The body that used to be typed into the canvas card is written in the
 * inspector's body editor, which is the only editable body left.
 */

const id = workspaceIdFactory("e2e-search");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

const search = (page: Page) => page.getByTestId("library-search");

test("finds a card by a title word and marks the match", async ({ page }) => {
  await page.goto(workspaceUrl("title-word"));
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await createTitledCard(page, "Planning retro");

  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(3);
  const noteId = await rowIdFor(page, "Planning retro");

  await search(page).fill("retro");

  // Exactly one row, and it is the note: the two starter cards are untitled.
  await expect(libraryRows(page)).toHaveCount(1);
  const title = page.getByTestId(`library-title-${noteId}`);
  await expect(title).toContainText("Planning retro");
  await expect(title.locator("mark")).toHaveText("retro");
});

test("finds a word that only appears in a card body", async ({ page }) => {
  await page.goto(workspaceUrl("body-word"));
  await createTitledCard(page, "Team agenda");

  // The body is typed in the inspector; the panel owns the editable surface.
  await openCardInspector(page, { title: "Team agenda" });
  await inspector(page).getByTestId("card-panel-tab-content").click();
  await inspector(page).getByTestId("card-panel-body").click();
  await expect(inspector(page).getByTestId("card-panel-body")).toHaveAttribute(
    "data-editing",
    "true",
  );
  await page.waitForTimeout(250);
  await page.keyboard.type("The zebra crossing is closed");
  await expect(inspector(page).getByTestId("card-panel-body")).toContainText("zebra");
  await inspector(page).getByTestId("inspector-close").click();

  await openLibrary(page, "cards");
  const noteId = await rowIdFor(page, "Team agenda");
  await search(page).fill("zebra");

  await expect(libraryRows(page)).toHaveCount(1);
  // A body hit is shown as a snippet with the term marked; the title itself
  // does not contain the word, so it carries no mark.
  const snippet = page.getByTestId(`library-snippet-${noteId}`);
  await expect(snippet).toBeVisible();
  await expect(snippet.locator("mark")).toHaveText("zebra");
  await expect(page.getByTestId(`library-title-${noteId}`).locator("mark")).toHaveCount(0);
});

/**
 * Regression for the shipped bug: the index is built on the first query and
 * patched afterwards, so a card created after that first build used to be
 * invisible until a reload. The library is searched once before the card is
 * written, which is exactly the state the bug needed.
 */
test("finds a card created after the index was built", async ({ page }) => {
  await page.goto(workspaceUrl("index-built"));

  await openLibrary(page, "cards");
  await search(page).fill("retro");
  await expect(page.getByTestId("library-search-empty")).toBeVisible();
  await search(page).fill("");
  await expect(libraryRows(page)).toHaveCount(2);

  // Close the drawer, write a card, and search again: no reload happens, so the
  // cached index is the only thing that can find the new card.
  await page.getByLabel("Close library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
  await createTitledCard(page, "Freshly written retrospective");
  await expect(libraryRows(page)).toHaveCount(1);

  await openLibrary(page, "cards");
  await search(page).fill("retrospective");
  await expect(libraryRows(page)).toHaveCount(1);
  await expect(libraryRows(page)).toContainText("Freshly written retrospective");
});

test("shows the empty state for a miss and restores the list when cleared", async ({ page }) => {
  await page.goto(workspaceUrl("empty-state"));
  await createTitledCard(page, "Planning retro");

  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(3);

  await search(page).fill("nothing matches this");
  await expect(page.getByTestId("library-search-empty")).toContainText(
    "No cards match \u201cnothing matches this\u201d.",
  );
  await expect(libraryRows(page)).toHaveCount(0);

  await page.getByTestId("library-search-clear").click();
  await expect(search(page)).toHaveValue("");
  await expect(libraryRows(page)).toHaveCount(3);
});
