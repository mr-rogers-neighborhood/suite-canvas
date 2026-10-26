import { expect, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards, workspaceIdFactory } from "./support";

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
test("an anonymous workspace says where the work is, never that it is temporary", async ({
  page,
}) => {
  await page.goto(withOwnerKey(`/?workspace=${id("anonymous")}`));
  await expect(cards(page)).toHaveCount(2);

  const status = page.getByTestId("storage-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveText(/^Saved on this device$/);
  await expect(status).not.toHaveText(/temporary/i);

  // The uncertainty lives in the panel, with an action beside it.
  await status.click();
  await expect(page.getByTestId("storage-panel")).toBeVisible();
  await expect(page.getByTestId("storage-headline")).toContainText(
    "Sign in to keep this workspace anywhere",
  );
  await expect(page.getByTestId("storage-persist")).not.toBeEmpty();
});

test("a local-only reader is warned before leaving for the launcher", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("leaving")}`));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("workspace-file").click();
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

test("asks once, until the work changes", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("once")}`));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("workspace-file").click();
  await page.getByTestId("workspace-home").click();
  await expect(page.getByTestId("leaving-dialog")).toBeVisible();

  // Staying is an answer: the same work does not get the same sentence twice.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("leaving-dialog")).toHaveCount(0);

  await page.getByTestId("workspace-file").click();
  await page.getByTestId("workspace-home").click();
  await expect(page).toHaveURL(/\/$/);
});
