import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createTitledCard,
  expectCardCount,
  expectCardTitled,
  libraryRows,
  openLibrary,
} from "./support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-launcher-${name}-${Date.now()}-${++sequence}`;

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

test("seeds the example workspace from the launcher", async ({ page }) => {
  await page.getByTestId("launcher-new").click();
  // Creating a workspace offers the passphrase choice first; this test is about
  // the seeded example, so it takes the documented skip path.
  await expect(page.getByTestId("recovery-creation")).toBeVisible();
  await page.getByTestId("recovery-creation-skip").click();
  await expect(page).toHaveURL(/workspace=/);
  await expect(page.locator('.app-canvas[data-ready="true"]')).toBeVisible({ timeout: 15_000 });

  // The example workspace, not an empty board: three Views (a View is a camera,
  // and the tab ids kept their historical `board-tab-` prefix) named Atlas,
  // Research and Sources, holding the seeded cards.
  await expect(page.getByTestId("empty-board")).toHaveCount(0);
  await expect(page.getByTestId("board-tab-board-1")).toBeVisible();
  await expect(page.getByTestId("board-tab-demo-board-research")).toBeVisible();
  await expect(page.getByTestId("board-tab-demo-board-sources")).toBeVisible();

  // The seeded content is document truth; the library lists it without a GPU.
  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(14);
  await expect(libraryRows(page).filter({ hasText: "Welcome to Atlas" })).toHaveCount(1);
});

test("starts a blank board when asked for one", async ({ page }) => {
  await page.goto(`/?blank=1&workspace=e2e-launcher-blank-${Date.now()}-${++sequence}`);
  await expect(page.getByTestId("empty-board")).toBeVisible();
  await expectCardCount(page, 0);

  await page.getByTestId("empty-board").getByRole("button", { name: "New note" }).click();
  await expectCardCount(page, 1);
  await expect(page.getByTestId("empty-board")).toHaveCount(0);
});

test("exports a workspace and imports it as a new workspace", async ({ page }) => {
  await page.goto(workspaceUrl("roundtrip"));
  await expectCardCount(page, 2);
  await createTitledCard(page, "Export me");

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
  await expectCardTitled(page, "Export me");
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
  await expectCardCount(page, 2);
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
  await expectCardCount(page, 2);
  await createTitledCard(page, "Portable note");

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
