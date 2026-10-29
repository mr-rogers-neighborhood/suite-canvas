import { expect, test } from "@playwright/test";
import { expectPeersConnected } from "../../interactions";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";
import { cards, skipAlphaNotice, workspaceIdFactory } from "../fixtures/support";

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

  // The one sentence says what is happening, not that the work is at risk on a
  // browser that has not promised to keep it.
  await expect(page.getByTestId("sync-room")).not.toHaveText(/temporary/i);
  await page.getByTestId("sync-details").click();
  const copy = page.getByTestId("sync-save-state");
  await expect(copy).toBeVisible();
  await expect(copy).toHaveText(/^Saved on this device$/);
  await expect(copy).not.toHaveText(/temporary/i);
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
    await expect(me.getByTestId("storage-warning")).toHaveCount(0);
    await expect(me.getByTestId("sync-sign-in")).toHaveCount(0);
    await me.getByTestId("sync-details").click();
    await expect(me.getByTestId("sync-save-state")).toHaveText("Saved on this device");
  } finally {
    await context.close();
  }
});

/**
 * Leaving asks nothing. An in-app dialog and a native tab-close prompt used to
 * stand here whenever the browser held the only copy; both are gone, because a
 * warning nobody can act on only teaches people to dismiss warnings
 * (`useLeaveTransition.ts`). What is left is the promise that matters: the work
 * is written before you go, and it is still there when you come back.
 */
test("leaving for the launcher asks nothing and the work is still there", {
  tag: "@smoke",
}, async ({ page }) => {
  await skipAlphaNotice(page);
  await page.goto(`/?workspace=${id("leaving")}`);
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-home").click();

  // One press, no question.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await expect(page.getByTestId("alpha-notice")).toHaveCount(0);

  // The workspace the reader just left is a recent one, and it still holds the
  // two cards this browser wrote.
  await expect(page.locator('[data-testid^="launcher-recent-"]').first()).toBeVisible();
  await page.goBack();
  await expect(cards(page)).toHaveCount(2);
});
