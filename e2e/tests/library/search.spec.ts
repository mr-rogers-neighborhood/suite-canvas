import { expect, type Page, test } from "@playwright/test";
import {
  cardByTitle,
  cardId,
  cards,
  createNote,
  libraryRows,
  openLibrary,
  workspaceIdFactory,
} from "../fixtures/support";

const id = workspaceIdFactory("e2e-search");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

const search = (page: Page) => page.getByTestId("library-search");

test("finds a card by a title word and marks the match", async ({ page }) => {
  await page.goto(workspaceUrl("title-word"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Planning retro");
  const noteId = await cardId(page, "Planning retro");

  await openLibrary(page, "cards");
  await search(page).fill("retro");

  // Exactly one row, and it is the note: the two starter cards are untitled.
  await expect(libraryRows(page)).toHaveCount(1);
  const title = page.getByTestId(`library-title-${noteId}`);
  await expect(title).toContainText("Planning retro");
  await expect(title.locator("mark")).toHaveText("retro");
});

test("finds a word that only appears in a card body", async ({ page }) => {
  await page.goto(workspaceUrl("body-word"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Team agenda");

  const card = cardByTitle(page, "Team agenda");
  await card.getByTestId("card-body").dblclick();
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
  await page.keyboard.type("The zebra crossing is closed");
  await expect(card.getByTestId("card-body")).toContainText("zebra");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(0);

  const noteId = await cardId(page, "Team agenda");
  await openLibrary(page, "cards");
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
 * invisible until a reload. The library stays open (and searched once) while
 * the card is written, which is exactly the state the bug needed.
 */
test("finds a card created after the index was built", async ({ page }) => {
  await page.goto(workspaceUrl("index-built"));
  await expect(cards(page)).toHaveCount(2);

  await openLibrary(page, "cards");
  await search(page).fill("retro");
  await expect(page.getByTestId("library-search-empty")).toBeVisible();
  await search(page).fill("");
  await expect(libraryRows(page)).toHaveCount(2);

  // Close the drawer, write something, and search again: no reload happens, so
  // the cached index is the only thing that can find the new card.
  await page.getByTestId("dock-library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
  await createNote(page, "Freshly written retrospective");
  await expect(cards(page)).toHaveCount(3);

  await openLibrary(page, "cards");
  await search(page).fill("retrospective");
  await expect(libraryRows(page)).toHaveCount(1);
  await expect(libraryRows(page)).toContainText("Freshly written retrospective");
});

test("shows the empty state for a miss and restores the list when cleared", async ({ page }) => {
  await page.goto(workspaceUrl("empty-state"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Planning retro");

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
