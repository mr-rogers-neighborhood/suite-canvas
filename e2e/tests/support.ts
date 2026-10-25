import { expect, type Locator, type Page } from "@playwright/test";

/**
 * One workspace id per test. The caller wraps it in a URL, because recovery
 * tests deliberately open a workspace without an owner fragment while the rest
 * use `withOwnerKey`.
 */
export function workspaceIdFactory(prefix: string): (name: string) => string {
  let sequence = 0;
  return (name) => `${prefix}-${name}-${Date.now()}-${++sequence}`;
}

export const cards = (page: Page) => page.locator('[data-testid="node-card"]');

export const cardByTitle = (page: Page, title: string): Locator =>
  cards(page).filter({ hasText: title });

export async function cardId(page: Page, title: string): Promise<string> {
  const value = await cardByTitle(page, title).getAttribute("data-node-id");
  if (!value) throw new Error(`the card titled "${title}" has no data-node-id`);
  return value;
}

/** A note from the dock, titled and out of edit mode. */
export async function createNote(page: Page, title: string): Promise<void> {
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  // React StrictMode remounts the editor once in dev; let the focused instance
  // settle so the first keystrokes cannot land in the discarded one.
  await page.waitForTimeout(250);
  await page.keyboard.type(title);
  await expect(cardByTitle(page, title)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(0);
}

export async function openLibrary(page: Page, tab: "cards" | "inbox" | "trash"): Promise<void> {
  if ((await page.getByTestId("library-drawer").count()) === 0) {
    await page.getByTestId("dock-library").click();
  }
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

/**
 * Library rows are the list entries (`li[data-row-id]`). The row title lives in
 * `library-title-<id>`, so a `library-item-` prefix selector would be a
 * different (and historically double-counted) thing.
 */
export const libraryRows = (page: Page) => page.locator("li[data-row-id]");

/**
 * Runs one action from a library row's menu.
 *
 * A row offers up to six actions, which as buttons left no room for the entity's
 * title in a 460px drawer, so they live behind the ⋯ button (or a right-click) in
 * the same context menu the canvas uses ({@link ADR-0011} §6).
 */
export async function libraryRowAction(row: Locator, action: string): Promise<void> {
  await row.getByRole("button", { name: /^Actions for / }).click();
  await row.page().getByRole("menuitem", { name: action }).click();
}
