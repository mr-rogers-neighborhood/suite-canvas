import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-delete-workspace");

async function openDeleteDialog(page: Page): Promise<void> {
  await page.getByTestId("workspace-file").click();
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
  await page.goto(withOwnerKey(`/?workspace=${workspace}`));
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
 * The other half of the delete: the workspace stops being owned, so its URL no
 * longer belongs to the key this browser held. Another browser can claim the id
 * instead of being refused, which is what "deleted" means for a workspace with
 * no accounts to notify.
 *
 * Known product bug, 2026-10-22, deliberately not asserted here: the relay does
 * not close the live room after the owner DELETE (`WorkspaceRequestHooks.
 * onDeleted` is declared for it and `apps/collab-server/src/server.ts` never
 * passes it), so the room rewrites the deleted document into SQLite seconds
 * later. Verified against the relay's database: the documents row is gone right
 * after the 200 response and back with a fresh `updated_at` a few seconds
 * later, and a brand-new browser then opens the old cards. Whether the latest
 * edit made it into that write varies with sync timing, which is why a
 * content-based assertion here is flaky rather than red. Fix belongs in the
 * server; this test pins the half that is deterministic.
 */
test("after deleting, another browser can claim the workspace id", async ({ page, browser }) => {
  const workspace = id("gone");
  await page.goto(withOwnerKey(`/?workspace=${workspace}`));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Vanishing note");

  // Before the delete the id is owned: a different key is refused.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(withOwnerKey(`/?workspace=${workspace}`));
  await expect(strangerPage.getByTestId("workspace-protected")).toBeVisible();
  await stranger.close();

  await openDeleteDialog(page);
  await confirmDelete(page);
  await expect(page.getByTestId(`launcher-recent-${workspace}`)).toHaveCount(0);

  // After it, the owner row is gone, so the same different key claims the id.
  const fresh = await browser.newContext();
  try {
    const freshPage = await fresh.newPage();
    await freshPage.goto(withOwnerKey(`/?workspace=${workspace}`));
    await expect(freshPage.locator('.app-canvas[data-ready="true"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(freshPage.getByTestId("workspace-protected")).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});
