import { expect, test } from "@playwright/test";
import { expectPeersConnected } from "../../interactions";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-save-state");

/**
 * The save state as a status ([ADR-0025](../../docs/decisions/0025-client-durability-and-offline-scope.md)
 * amendment).
 *
 * The pill answers "where is my work", so it cannot change with the browser's answer about
 * durability — that was the hedge. An anonymous workspace in a fresh browser profile is
 * exactly the case that used to read "Saved temporarily": the work is written on every edit,
 * and the browser has not promised to keep it.
 */
test("an anonymous workspace says where the work is, never that it is temporary", {
  tag: "@smoke",
}, async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("anonymous")}`));
  await expect(cards(page)).toHaveCount(2);

  // One status in the chrome, and it answers "is anyone else here" — everything
  // about this device's own copy is one press away under the same control.
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveText(/Synced/);
  await status.click();
  await expect(page.getByTestId("sync-panel")).toBeVisible();

  const copy = page.getByTestId("storage-status");
  await expect(copy).toBeVisible();
  await expect(copy).toHaveText(/^Saved on this device$/);
  await expect(copy).not.toHaveText(/temporary/i);
  await expect(page.getByTestId("storage-headline")).toContainText(
    "Sign in to keep this workspace anywhere",
  );
  await expect(page.getByTestId("storage-persist")).not.toBeEmpty();
});

test("goes quiet about this device once someone else is in the room", { tag: "@smoke" }, async ({
  browser,
}) => {
  const url = withOwnerKey(`/?workspace=${id("shared-copy")}-${crypto.randomUUID()}`);
  const context = await browser.newContext();
  try {
    const peer = await context.newPage();
    await peer.goto(url);
    const me = await context.newPage();
    await me.goto(url);
    await expectPeersConnected(me, peer);

    // Two copies exist, so this browser's own copy is not the only one: the warning
    // that exists for exactly that case gives way to one calm line.
    await me.getByTestId("sync-status").click();
    await expect(me.getByTestId("storage-status")).toHaveText("Saved here and synced");
    await expect(me.getByTestId("storage-warning")).toHaveCount(0);
    await expect(me.getByTestId("storage-sign-in")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a local-only reader is warned before leaving for the launcher", { tag: "@smoke" }, async ({
  page,
}) => {
  await page.goto(withOwnerKey(`/?workspace=${id("leaving")}`));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-home").click();

  // The one moment before the only copy is left behind, in plain words.
  await expect(page.getByTestId("leaving-dialog")).toBeVisible();
  await expect(page.getByTestId("leaving-sentence")).toContainText("only in this browser");

  // Both ways to make the work safe are the affordances that already exist.
  await expect(page.getByTestId("leaving-sign-in")).toBeVisible();
  await expect(page.getByTestId("leaving-export")).toBeVisible();

  await page.getByTestId("leaving-anyway").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
});

test("asks once, until the work changes", { tag: "@smoke" }, async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("once")}`));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-home").click();
  await expect(page.getByTestId("leaving-dialog")).toBeVisible();

  // Staying is an answer: the same work does not get the same sentence twice.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("leaving-dialog")).toHaveCount(0);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-home").click();
  await expect(page).toHaveURL(/\/$/);
});
