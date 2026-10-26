import { expect, type Page, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "../fixtures/support";

// Deleting a workspace is an account action now: the relay half needs the session
// JWT (ADR-0074), so this file runs on the hosted origin with the run's sign-in.
test.use({ storageState: ACCOUNT_STATE });

const id = workspaceIdFactory("e2e-delete-workspace");

async function openDeleteDialog(page: Page): Promise<void> {
  await page.getByTestId("workspace-menu").click();
  await expect(page.getByTestId("workspace-delete")).toBeVisible();
  await page.getByTestId("workspace-delete").click();
  await expect(page.getByTestId("delete-workspace-dialog")).toBeVisible();
}

async function confirmDelete(page: Page): Promise<void> {
  const input = page.getByTestId("delete-workspace-confirm-input");
  const confirm = page.getByTestId("delete-workspace-confirm-button");
  await expect(confirm).toBeDisabled();

  // A near miss is not enough: the typed value must be the name (or the id).
  await input.fill("Board");
  await expect(confirm).toBeDisabled();
  await input.fill("board 1");
  await expect(confirm).toBeDisabled();

  await input.fill("Board 1");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByTestId("workspace-launcher")).toBeVisible({ timeout: 15_000 });
}

/** Cached document rows this browser still holds for one workspace. */
async function cachedDocumentRows(page: Page, workspaceId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("suite-loro");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await open();
    const snapshot = await new Promise<number>((resolve) => {
      const request = db.transaction("snapshots").objectStore("snapshots").get(id);
      request.onsuccess = () => resolve(request.result === undefined ? 0 : 1);
    });
    const updates = await new Promise<number>((resolve) => {
      const store = db.transaction("updates").objectStore("updates").index("workspaceId");
      const request = store.count(IDBKeyRange.only(id));
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return snapshot + updates;
  }, workspaceId);
}

test("requires the exact name, then forgets the workspace in this browser", async ({ page }) => {
  const workspace = id("remove");
  await page.goto(hostedUrl(`/?workspace=${workspace}`));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Doomed note");
  await expect(cardByTitle(page, "Doomed note")).toHaveCount(1);

  await openDeleteDialog(page);
  // The dev build talks to the relay, so this is the relay copy of the dialog:
  // it says both halves go, and what it cannot reach.
  await expect(page.getByTestId("delete-workspace-copy")).toContainText(
    "This deletes the relay's copy and this browser's copy",
  );
  await expect(page.getByTestId("delete-workspace-dialog")).toContainText(
    "Type Board 1 to confirm.",
  );

  await confirmDelete(page);

  // The delete returns to the launcher with nothing to reopen.
  await expect(page.getByTestId(`launcher-recent-${workspace}`)).toHaveCount(0);

  // And this browser's cached document is gone, the half the dialog promises to
  // erase here.
  expect(await cachedDocumentRows(page, workspace)).toBe(0);
});

/**
 * The other half of the delete: the relay forgets the workspace, so the id is
 * claimable again rather than refused to every later session.
 *
 * Owning the id is only half of it. The relay used to keep the live room open
 * after the owner DELETE, and because a room saves every `saveInterval` (2 s)
 * the deleted document came back with its content seconds later: a brand-new
 * browser then opened the old cards. `server.ts` now passes `onDeleted`, which
 * disconnects the room and forgets its document, so this test also waits out
 * that save interval and then checks the content is gone and stays gone.
 *
 * The second browser is a *different browser profile* of the same account — the
 * run's session rides in as storage state, and a browser context is where
 * IndexedDB, and therefore the local copy, lives. That is exactly the "other
 * device" the dialog warns about, and it is the honest shape now that ownership
 * is an organization rather than a fragment a stranger could mint.
 */
test("after deleting, another browser opens an empty workspace", async ({ page, browser }) => {
  const workspace = id("gone");
  await page.goto(hostedUrl(`/?workspace=${workspace}`));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Vanishing note");

  await openDeleteDialog(page);
  await confirmDelete(page);
  await expect(page.getByTestId(`launcher-recent-${workspace}`)).toHaveCount(0);

  // Deliberately waiting on a server-side interval, which is the point of this
  // test: the relay's room saves every 2 s, so a room that outlived the delete
  // has had its chance to write the document back before we look. Opening the
  // fresh browser immediately would pass even with the bug.
  await page.waitForTimeout(4_000);

  // After it, the relay holds nothing for the id, so another browser gets a new
  // workspace rather than the deleted one.
  const fresh = await browser.newContext();
  try {
    const freshPage = await fresh.newPage();
    await freshPage.goto(hostedUrl(`/?workspace=${workspace}`));
    await expect(freshPage.locator('.app-canvas[data-ready="true"]')).toBeVisible({
      timeout: 15_000,
    });
    // And it claims an empty document, not the deleted one: the deleted note is
    // nowhere, and the only cards are the two starters a new workspace seeds.
    await expect(freshPage.getByText("Vanishing note")).toHaveCount(0);
    await expect(cards(freshPage)).toHaveCount(2);

    // Give a stale room another save interval to reintroduce the note. Same
    // deliberate server-side wait as above.
    await freshPage.waitForTimeout(3_000);
    await expect(freshPage.getByText("Vanishing note")).toHaveCount(0);

    // A reload re-reads whatever the relay holds now; it must not resurrect it
    // either.
    await freshPage.reload();
    await expect(freshPage.locator('.app-canvas[data-ready="true"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(freshPage.getByText("Vanishing note")).toHaveCount(0);
    await expect(cards(freshPage)).toHaveCount(2);
  } finally {
    await fresh.close();
  }
});
