import { expect, test } from "@playwright/test";
import { expectPeersConnected } from "../../interactions";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";
import { cards, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-save-state");

/**
 * The save state as a status (ADR-0025
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
  await page.goto(`/?workspace=${id("anonymous")}`);
  await expect(cards(page)).toHaveCount(2);

  // One status in the chrome, and it answers "is anyone else here" — everything
  // about this device's own copy is one press away under the same control.
  //
  // This origin serves no account service, and the relay accepts only a session
  // JWT (ADR-0074), so the pill's honest word is "No access". It is not "Saved
  // temporarily": nothing about this device's copy depends on the relay.
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveAttribute("data-status", "unauthorized", { timeout: 20_000 });
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

test("an account keeps this browser quiet about its own copy", { tag: "@smoke" }, async ({
  browser,
}) => {
  const url = hostedUrl(`/?workspace=${id("shared-copy")}-${crypto.randomUUID()}`);
  const context = await browser.newContext({ storageState: ACCOUNT_STATE });
  try {
    const peer = await context.newPage();
    await peer.goto(url);
    const me = await context.newPage();
    await me.goto(url);
    await expectPeersConnected(me, peer);

    // The account is what makes the local copy a second copy: the ladder answers
    // "Saved" and the warning that exists for a sole copy on a browser that
    // promised nothing gives way to silence. "Saved here and synced" is the
    // no-account rung and needs an owner-key session this build no longer has.
    await me.getByTestId("sync-status").click();
    await expect(me.getByTestId("storage-status")).toHaveText("Saved");
    await expect(me.getByTestId("storage-warning")).toHaveCount(0);
    await expect(me.getByTestId("storage-sign-in")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a local-only reader is warned before leaving for the launcher", { tag: "@smoke" }, async ({
  page,
}) => {
  await page.goto(`/?workspace=${id("leaving")}`);
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
  await page.goto(`/?workspace=${id("once")}`);
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
