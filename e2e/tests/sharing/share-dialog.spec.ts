import { expect, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";

// Building a link needs the account session: the relay authorises share creation
// with the same JWT it accepts for sync (ADR-0074, ADR-0076). The people who open
// those links are somebody else's browser, so the helpers below start a clean
// context rather than one carrying this run's cookie.
test.use({ storageState: ACCOUNT_STATE });

const shareApi = process.env.VITE_COLLAB_HTTP_URL ?? "http://localhost:1235";

test("creates and revokes links from the Share dialog", { tag: "@smoke" }, async ({
  page,
  request,
}) => {
  // A fresh workspace per run: shares are stored per workspace id on the server.
  const workspaceId = `e2e-share-${Date.now()}`;
  await page.goto(hostedUrl(`/?workspace=${workspaceId}`));
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);

  // Management needs the owner key the editor holds; a bare request is refused.
  const denied = await request.get(`${shareApi}/api/shares?workspaceId=${workspaceId}`);
  expect(denied.status()).toBe(401);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-menu-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();

  // Nothing is selected, so a card link is not offered yet.
  await expect(page.getByTestId("share-tab-card")).toBeDisabled();

  // Workspace + editor is an edit-only token, not the owner link.
  await page.getByTestId("share-role-editor").click();
  await page.getByTestId("share-create").click();
  const editorLink = new URL(await page.getByLabel("Share link").inputValue());
  expect(editorLink.searchParams.get("share")).toBeTruthy();
  expect(editorLink.hash).toBe("");
  expect(editorLink.searchParams.has("workspace")).toBe(false);

  // Board + viewer is a capability link the server resolves.
  await page.getByTestId("share-tab-board").click();
  await page.getByTestId("share-role-viewer").click();
  await page.getByTestId("share-create").click();
  const viewerLink = new URL(await page.getByLabel("Share link").inputValue());
  const token = viewerLink.searchParams.get("share");
  expect(token).toBeTruthy();
  expect(viewerLink.searchParams.has("workspace")).toBe(false);

  await expect(page.getByTestId("share-list")).toContainText("Board");
  const resolved = await request.get(`${shareApi}/api/shares/${token}`);
  expect(resolved.status()).toBe(200);

  // Revoking every link is confirmed inside the dialog now that no `window.confirm`
  // is left in the canvas, so the confirmation is a press of its own.
  await page.getByTestId("share-revoke-all").click();
  await page.getByTestId("share-revoke-all-yes").click();
  await expect(page.getByTestId("share-empty")).toBeVisible();
  await expect
    .poll(async () => (await request.get(`${shareApi}/api/shares/${token}`)).status())
    .toBe(404);
});
