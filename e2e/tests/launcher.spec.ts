import { writeFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-launcher-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function createNote(page: Page, title: string): Promise<void> {
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.keyboard.type(title);
  await page.keyboard.press("Escape");
  await expect(cards(page).filter({ hasText: title })).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("suite.recentWorkspaces.v1"));
  await page.reload();
});

test("starts on the workspace launcher", async ({ page }) => {
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await expect(page.getByTestId("launcher-new")).toBeVisible();
  await expect(page.getByTestId("launcher-import")).toBeVisible();
  await expect(page.getByTestId("workspace-launcher")).toContainText("Recent workspaces");
});

test("creates an empty workspace from the launcher", async ({ page }) => {
  await page.getByTestId("launcher-new").click();
  // Creating a workspace offers the passphrase choice first; this test is about
  // the empty board, so it takes the documented skip path.
  await expect(page.getByTestId("recovery-creation")).toBeVisible();
  await page.getByTestId("recovery-creation-skip").click();
  await expect(page).toHaveURL(/workspace=/);
  await expect(page.getByTestId("empty-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);

  await page.getByTestId("empty-board").getByRole("button", { name: "New note" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("empty-board")).toHaveCount(0);
});

test("exports a workspace and imports it as a new workspace", async ({ page }) => {
  await page.goto(workspaceUrl("roundtrip"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Export me");

  await page.getByTestId("workspace-file").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("workspace-export-backup").click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error("no download path");

  const original = page.url();
  await page.goto("/");
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await page.getByTestId("launcher-file").setInputFiles(path);
  await expect(page).toHaveURL(/workspace=/);
  expect(page.url()).not.toBe(original);
  await expect(cards(page).filter({ hasText: "Export me" })).toHaveCount(1);
});

test("refuses a backup from a newer Suite", async ({ page }, testInfo) => {
  const path = testInfo.outputPath("future.suite");
  await writeFile(
    path,
    JSON.stringify({
      kind: "suite.workspace",
      version: 99,
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      workspaceId: "future",
      document: "eA==",
      manifest: { boards: 0, cards: 0, types: 0, tags: 0 },
    }),
  );

  await page.getByTestId("launcher-file").setInputFiles(path);
  await expect(page.getByTestId("launcher-error")).toContainText("newer Suite");
});

test("lists and exports a recent workspace from the launcher", async ({ page }) => {
  await page.goto(workspaceUrl("recent"));
  await expect(cards(page)).toHaveCount(2);
  await page.getByTestId("workspace-file").click();
  await page.getByTestId("workspace-home").click();
  await expect(page).toHaveURL(/\/$/);
  const entry = page.locator('[data-testid^="launcher-recent-"]').first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText("Board 1");

  const downloadPromise = page.waitForEvent("download");
  await entry.locator('[data-testid^="launcher-export-"]').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.suite$/);
});

test("exports portable JSON and Markdown from the workspace", async ({ page }) => {
  await page.goto(workspaceUrl("portable"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Portable note");

  await page.getByTestId("workspace-file").click();
  const jsonPromise = page.waitForEvent("download");
  await page.getByTestId("workspace-export-json").click();
  const json = await jsonPromise;
  expect(json.suggestedFilename()).toMatch(/\.json$/);

  await page.getByTestId("workspace-file").click();
  const markdownPromise = page.waitForEvent("download");
  await page.getByTestId("workspace-export-markdown").click();
  const markdown = await markdownPromise;
  expect(markdown.suggestedFilename()).toMatch(/\.md$/);
});
