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
