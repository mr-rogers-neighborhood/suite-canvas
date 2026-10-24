import { readFile, writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { createTitledCard, expectCardCount, expectCardTitled } from "./support";

let sequence = 0;
const workspaceId = (name: string) => `e2e-owner-${name}-${Date.now()}-${++sequence}`;

async function openRecoveryDialog(page: Page): Promise<void> {
  await page.getByTestId("workspace-file").click();
  await expect(page.getByTestId("workspace-recovery-key")).toHaveCount(1);
  await page.getByTestId("workspace-recovery-key").click();
  await expect(page.getByTestId("recovery-dialog")).toBeVisible();
  await expect(page.getByTestId("recovery-dialog")).toContainText(
    "Keep it separate from document backups.",
  );
}

async function downloadText(
  page: Page,
  action: () => Promise<void>,
): Promise<{
  filename: string;
  path: string;
  json: Record<string, unknown>;
}> {
  const pending = page.waitForEvent("download");
  await action();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error("the recovery key download has no path");
  return {
    filename: download.suggestedFilename(),
    path,
    json: JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>,
  };
}

test("saves a recovery key and restores ownership from it", async ({ page, browser }) => {
  const id = workspaceId("save");
  await page.goto(`/?workspace=${id}`);
  await expectCardCount(page, 2);
  // Recovery is one File item, not a banner or first-run prompt.
  await expect(page.getByTestId("recovery-dialog")).toHaveCount(0);
  await expect(page.getByTestId("recovery-prompt")).toHaveCount(0);

  await openRecoveryDialog(page);
  const kit = await downloadText(page, () => page.getByTestId("recovery-save").click());
  expect(kit.filename).toMatch(/-recovery\.suitekey$/);
  expect(kit.filename.endsWith(".suite")).toBe(false);
  expect(kit.json.kind).toBe("suite.owner");
  expect(kit.json.version).toBe(1);
  expect(kit.json.workspaceId).toBe(id);
  expect(kit.json.ownerKey).toBeTruthy();
  expect(kit.json.document).toBeUndefined();
  await expect(page.getByTestId("recovery-saved")).toHaveText(/^Saved on this device/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("recovery-dialog")).toHaveCount(0);

  // A new browser has no stored key and no fragment, so the workspace is locked.
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto(`/?workspace=${id}`);
    await expect(fresh.getByTestId("workspace-protected")).toBeVisible();
    expect(fresh.url()).not.toContain("owner=");
    await expect(fresh.getByTestId("recovery-paste")).not.toBeVisible();

    await fresh.getByTestId("recovery-file").setInputFiles(kit.path);
    await expectCardCount(fresh, 2);
    await expect(fresh.locator('.app-canvas[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
    await expect(fresh.getByTestId("workspace-protected")).toHaveCount(0);

    // And it is editable, not just readable.
    await createTitledCard(fresh, "Recovered note");
    await expectCardTitled(fresh, "Recovered note");
  } finally {
    await context.close();
  }
});

test("offers a separate recovery key right after a backup export", async ({ page }) => {
  await page.goto(`/?workspace=${workspaceId("backup")}`);
  await expectCardCount(page, 2);

  await page.getByTestId("workspace-file").click();
  const backup = await downloadText(page, () =>
    page.getByTestId("workspace-export-backup").click(),
  );
  expect(backup.filename).toMatch(/\.suite$/);
  expect(backup.json.kind).toBe("suite.workspace");
  expect(backup.json.ownerKey).toBeUndefined();

  // The only export-time follow-up: one small prompt, not a bundle or banner.
  await expect(page.getByTestId("recovery-prompt")).toBeVisible();
  await expect(page.getByTestId("recovery-prompt")).toContainText(
    "Backup saved. Save a separate recovery key too?",
  );

  const kit = await downloadText(page, () => page.getByTestId("recovery-prompt-save").click());
  expect(kit.filename).toMatch(/-recovery\.suitekey$/);
  expect(kit.filename).not.toBe(backup.filename);
  expect(kit.json.kind).toBe("suite.owner");
  expect(kit.json.document).toBeUndefined();
  expect(kit.json.workspaceId).toBeTruthy();
  await expect(page.getByTestId("recovery-saved")).toHaveText(/^Saved on this device/);
});

test("replacing the recovery key retires the old fragment and old file", async ({
  page,
  browser,
}) => {
  const id = workspaceId("rotate");
  const oldKey = crypto.randomUUID();
  await page.goto(`/?workspace=${id}#owner=${oldKey}`);
  await expectCardCount(page, 2);

  await openRecoveryDialog(page);
  await page.getByTestId("recovery-replace").click();
  await expect(page.getByTestId("recovery-warning")).toContainText(
    "Existing editor links and old recovery files will stop working.",
  );

  const kit = await downloadText(page, () => page.getByTestId("recovery-confirm").click());
  expect(kit.filename).toMatch(/-recovery\.suitekey$/);
  expect(kit.json.kind).toBe("suite.owner");
  const newKey = String(kit.json.ownerKey);
  expect(newKey).not.toBe(oldKey);

  await expect(page.getByTestId("recovery-reload")).toBeVisible();
  await page.getByTestId("recovery-reload").click();
  await expectCardCount(page, 2);
  await expect.poll(() => decodeURIComponent(new URL(page.url()).hash)).toBe(`#owner=${newKey}`);

  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    // The old editor link no longer owns the workspace.
    await other.goto(`/?workspace=${id}#owner=${oldKey}`);
    await expect(other.getByTestId("workspace-protected")).toBeVisible();

    // The new key file does.
    await other.goto(`/?workspace=${id}`);
    await expect(other.getByTestId("workspace-protected")).toBeVisible();
    await other.getByTestId("recovery-file").setInputFiles(kit.path);
    await expect(other.locator('.app-canvas[data-ready="true"]')).toBeVisible({ timeout: 15_000 });
    await expect(other.getByTestId("workspace-protected")).toHaveCount(0);
    await expectCardCount(other, 2);
  } finally {
    await context.close();
  }
});

test("offers a recovery key after a launcher export and opens one from the launcher", async ({
  page,
  browser,
}) => {
  const id = workspaceId("launcher");
  await page.goto(`/?workspace=${id}`);
  await expectCardCount(page, 2);

  await page.getByTestId("workspace-file").click();
  await page.getByTestId("workspace-home").click();
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();

  // The launcher's per-row export is the second backup path, so it gets the
  // same one-question follow-up as File → Export backup.
  await page.getByTestId(`launcher-recent-${id}`).hover();
  const backup = await downloadText(page, () => page.getByTestId(`launcher-export-${id}`).click());
  expect(backup.filename).toMatch(/\.suite$/);

  await expect(page.getByTestId("recovery-prompt")).toBeVisible();
  await expect(page.getByTestId("recovery-prompt")).toContainText(
    "Backup saved. Save a separate recovery key too?",
  );
  const kit = await downloadText(page, () => page.getByTestId("recovery-prompt-save").click());
  expect(kit.filename).toMatch(/-recovery\.suitekey$/);
  expect(kit.json.workspaceId).toBe(id);
  await expect(page.getByTestId("recovery-saved")).toHaveText(/^Saved on this device/);

  // A fresh browser can start from the key file alone: the launcher writes the
  // key and opens that workspace instead of importing a new one.
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto("/");
    await expect(fresh.getByTestId("workspace-launcher")).toBeVisible();
    await fresh.getByTestId("launcher-recovery-file").setInputFiles(kit.path);

    await expect(fresh.locator('.app-canvas[data-ready="true"]')).toBeVisible({
      timeout: 15_000,
    });
    const opened = new URL(fresh.url());
    expect(opened.searchParams.get("workspace")).toBe(id);
    expect(decodeURIComponent(opened.hash)).toBe(`#owner=${String(kit.json.ownerKey)}`);
    await expectCardCount(fresh, 2);
    await expect(fresh.getByTestId("workspace-launcher")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("shows one inline error for a file that is not a recovery key", async ({ page }, testInfo) => {
  const path = testInfo.outputPath("backup.suitekey");
  await writeFile(
    path,
    JSON.stringify({
      kind: "suite.workspace",
      version: 1,
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      workspaceId: "not-a-key",
      document: "eA==",
      manifest: { boards: 0, cards: 0, types: 0, tags: 0 },
    }),
  );

  await page.goto("/");
  await page.getByTestId("launcher-recovery-file").setInputFiles(path);
  await expect(page.getByTestId("launcher-error")).toContainText("workspace backup");
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await expect(page.getByTestId("launcher-error")).toHaveCount(1);
});

test("forget this browser removes the key and cached copy, and the workspace reopens protected", async ({
  page,
}) => {
  const id = workspaceId("forget");
  await page.goto(`/?workspace=${id}`);
  await expectCardCount(page, 2);

  await openRecoveryDialog(page);
  await page.getByTestId("recovery-forget").click();
  await expect(page.getByTestId("recovery-forget-confirm")).toContainText(
    "The owner key and cached copy will be removed from this browser.",
  );
  await expect(page.getByTestId("recovery-forget-confirm")).toContainText(
    "The workspace stays on the server",
  );
  await page.getByTestId("recovery-forget-confirm-button").click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await expect(page.getByTestId(`launcher-recent-${id}`)).toHaveCount(0);

  // No key, no fragment and no cached document: the relay still owns it.
  await page.goto(`/?workspace=${id}`);
  await expect(page.getByTestId("workspace-protected")).toBeVisible();
});

test("keeps the local edit while claims fail, then claims without losing it", async ({
  page,
  browser,
}) => {
  const id = workspaceId("offline");

  // Establish the workspace and a local edit while the relay is healthy.
  await page.goto(`/?workspace=${id}`);
  await expectCardCount(page, 2);
  await createTitledCard(page, "Offline note");
  const ownerKey = decodeURIComponent(new URL(page.url()).hash.replace(/^#owner=/, ""));
  expect(ownerKey.length).toBeGreaterThan(0);

  // Now only the claim fails: the page still loads, which is the "reopened while
  // offline" case. The local document, not the relay, is what renders.
  let blocked = true;
  await page.route(`**/api/workspaces/${id}/claim`, (route) =>
    blocked ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.reload();
  await expectCardTitled(page, "Offline note");
  await expect(page.getByTestId("workspace-protected")).toHaveCount(0);

  // A reconnect retries immediately instead of waiting for the backoff.
  const claimed = page.waitForResponse(
    (response) => response.url().endsWith(`/workspaces/${id}/claim`) && response.status() === 200,
    { timeout: 20_000 },
  );
  blocked = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await claimed;

  // The claim belongs to this browser's key now: a browser without it is
  // refused, and is not told a local copy exists here.
  const stranger = await browser.newContext();
  try {
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`/?workspace=${id}`);
    await expect(strangerPage.getByTestId("workspace-protected")).toBeVisible();
    await expect(strangerPage.getByTestId("workspace-protected-detail")).toHaveAttribute(
      "data-conflict",
      "unknown",
    );
  } finally {
    await stranger.close();
  }

  // The edit survived the offline window: the owner sees it after a reload.
  await page.reload();
  await expectCardTitled(page, "Offline note");

  const owner = await browser.newContext();
  try {
    const ownerPage = await owner.newPage();
    await ownerPage.goto(`/?workspace=${id}#owner=${ownerKey}`);
    await expectCardTitled(ownerPage, "Offline note");
  } finally {
    await owner.close();
  }
});
