import { expect, test } from "@playwright/test";

const shareApi = process.env.VITE_COLLAB_HTTP_URL ?? "http://localhost:1235";

test("creates and revokes links from the Share dialog", async ({ page, request }) => {
  // A fresh workspace per run: shares are stored per workspace id on the server.
  const workspaceId = `e2e-share-${Date.now()}`;
  await page.goto(`/?workspace=${workspaceId}`);
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

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("share-revoke-all").click();
  await expect(page.getByTestId("share-empty")).toBeVisible();
  await expect
    .poll(async () => (await request.get(`${shareApi}/api/shares/${token}`)).status())
    .toBe(404);
});
