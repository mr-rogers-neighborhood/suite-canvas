import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The canvas is ICE and nothing else.
 *
 * `?canvas=flow` and `?canvas=scene` no longer select an engine: every
 * workspace mounts the ICE desk, and the React Flow surfaces are gone. Two
 * consequences shape this suite:
 *
 * - Navigation never appends `?canvas=`. `?canvas=ice` is accepted and
 *   harmless, but a plain workspace URL already lands on the same surface.
 * - The desk needs a real WebGPU adapter. Playwright's default headless
 *   Chromium has none, so a spec that reads or drives what the canvas *draws*
 *   (cards, mats, selection, drags) skips unless `SUITE_ICE_E2E=1`, which turns
 *   the `chromium` project into a headed system-Chrome run with the WebGPU
 *   flags (see `playwright.config.ts`). Anything that lives in the shell —
 *   launcher, inspector, library drawer, dialogs, view tabs — runs headless.
 */
export const ICE_E2E = process.env.SUITE_ICE_E2E === "1";

/** Skips the calling test unless the headed WebGPU harness is active. */
export function requireIceDesk(): void {
  test.skip(!ICE_E2E, "needs the live ICE desk: run with SUITE_ICE_E2E=1 (headed Chrome + WebGPU)");
}

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

/**
 * Creates a card and names it without touching the canvas.
 *
 * The dock hands a new card straight to its on-canvas title editor, and the card
 * face ICE draws is read-only, so both of those are GPU surfaces. The library's
 * inbox "New" button and the inspector's title editor write the same document —
 * which is what the shell specs (recovery, export, delete) care about: a titled
 * card that survives a reload or a round trip.
 */
export async function createTitledCard(page: Page, title: string): Promise<void> {
  await openLibrary(page, "inbox");
  await page.getByTestId("library-new-card").click();
  await expect(libraryRows(page)).toHaveCount(1);
  await libraryRows(page).first().click();

  const inspector = page.getByTestId("card-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
  // Closing the panel unmounts the editor; the title is already in the CRDT.
  await inspector.getByTestId("inspector-close").click();
}

/**
 * Asserts the workspace holds `count` live cards.
 *
 * Opens the library, reads it, and closes it again: the shell specs that use
 * this open their own dialogs next, and a drawer left over the canvas is one
 * more thing between them and the control they came for.
 */
export async function expectCardCount(page: Page, count: number): Promise<void> {
  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(count);
  await page.getByLabel("Close library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
}

/** Asserts one library row carries `title`; the card may be anywhere on a board. */
export async function expectCardTitled(page: Page, title: string): Promise<void> {
  await openLibrary(page, "cards");
  await expect(libraryRows(page).filter({ hasText: title })).toHaveCount(1);
  await page.getByLabel("Close library").click();
  await expect(page.getByTestId("library-drawer")).toHaveCount(0);
}

export async function openLibrary(page: Page, tab: "cards" | "inbox" | "trash"): Promise<void> {
  // Boot writes the page URL twice (`?board=` once the view resolves, then the
  // owner fragment), and a same-document navigation swallows a click that lands
  // mid-write. Retry the whole gesture rather than trusting one click.
  await expect(page.locator(".app-canvas")).toHaveAttribute("data-ready", "true");
  await expect(async () => {
    if ((await page.getByTestId("library-drawer").count()) === 0) {
      await page.getByTestId("dock-library").click({ timeout: 2_000 });
    }
    await expect(page.getByTestId("library-drawer")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(page.getByTestId("library-drawer")).toBeVisible();
}

/**
 * Library rows are the list entries (`li[data-row-id]`). The row title lives in
 * `library-title-<id>`, so a `library-item-` prefix selector would be a
 * different (and historically double-counted) thing.
 */
export const libraryRows = (page: Page) => page.locator("li[data-row-id]");

/** The inspector panel, open over either surface (a share viewer has none). */
export const inspector = (page: Page) => page.getByTestId("card-inspector");

/**
 * Opens a card's inspector by clicking its library row.
 *
 * The canvas card face is drawn by ICE and exposes no DOM (and it is read-only),
 * so the library row is how a spec reaches a specific card now: it opens the
 * same inspector, backed by the same document.
 */
export async function openCardInspector(
  page: Page,
  options: { title?: string; index?: number } = {},
): Promise<Locator> {
  await openLibrary(page, "cards");
  const rows =
    options.title === undefined
      ? libraryRows(page)
      : libraryRows(page).filter({ hasText: options.title });
  await rows.nth(options.index ?? 0).click();
  await expect(inspector(page)).toBeVisible();
  return inspector(page);
}

/** The `data-row-id` of the first library row carrying `title`. */
export async function rowIdFor(page: Page, title: string): Promise<string> {
  const id = await libraryRows(page).filter({ hasText: title }).first().getAttribute("data-row-id");
  if (!id) throw new Error(`no library row titled "${title}"`);
  return id;
}
