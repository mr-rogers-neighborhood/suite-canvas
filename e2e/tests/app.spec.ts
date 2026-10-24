import { expect, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { libraryRows, openLibrary } from "./support";

test("canvas app boots on the ICE surface", async ({ page }) => {
  // A fresh workspace per run: the default one is shared state on the collab server.
  await page.goto(`/?workspace=e2e-boot-${Date.now()}`);
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await expect(page.locator(".app-canvas")).toHaveAttribute("data-ready", "true");

  // The shell around the desk: one View tab (a View is a camera, not a board),
  // the dock, and the ICE HUD. The desk itself needs WebGPU, which headless
  // Chromium does not have, so what is asserted here is the boot, not the draw.
  await expect(page.locator('[role="tab"][data-testid^="board-tab"]')).toHaveCount(1);
  await expect(page.getByTestId("dock-library")).toBeVisible();
  await expect(page.getByTestId("dock-new-card")).toBeVisible();
  await expect(page.getByTestId("ice-hud")).toBeVisible();
  await expect(page.getByTestId("ice-status")).toHaveText(/^engine: /);

  // The starter workspace seeds two cards; the library is where that truth is
  // visible without a GPU.
  await openLibrary(page, "cards");
  await expect(libraryRows(page)).toHaveCount(2);
});

test("shows render counters with ?perf=1", async ({ page }) => {
  await page.goto(`/?workspace=e2e-perf-${Date.now()}&perf=1`);
  await expect(page.getByTestId("ice-surface")).toBeVisible();

  // The overlay reports at least the shell and its own render rates. `card` joins
  // only once ICE mounts DOM faces, which needs WebGPU.
  await expect(page.getByTestId("perf-key").first()).toBeVisible();
  await expect(page.getByText("renders/s")).toBeVisible();
  await expect
    .poll(async () => page.getByTestId("perf-key").allInnerTexts())
    .toEqual(expect.arrayContaining(["shell", "overlay"]));
});

test("does not reseed a workspace another client emptied", async ({ browser }) => {
  const url = withOwnerKey(`/?workspace=e2e-no-reseed-${Date.now()}`);

  const first = await browser.newContext();
  const pageA = await first.newPage();
  await pageA.goto(url);
  await expect(pageA.locator(".app-canvas")).toHaveAttribute("data-ready", "true");

  // Empty the board through the library (the cards go to the trash): the desk
  // is not available headless, and the library reads the same document truth.
  await openLibrary(pageA, "cards");
  await expect(libraryRows(pageA)).toHaveCount(2);
  await libraryRows(pageA).first().getByRole("button", { name: "Trash" }).click();
  await expect(libraryRows(pageA)).toHaveCount(1);
  await libraryRows(pageA).first().getByRole("button", { name: "Trash" }).click();
  await expect(libraryRows(pageA)).toHaveCount(0);

  // A fresh client has an empty IndexedDB but must not treat that as a new
  // workspace. Seeding waits for the server's snapshot, so a slow sync cannot
  // resurrect starter cards here (the gate is asserted in the store, this test
  // pins the end state a joining client must reach).
  const second = await browser.newContext();
  const pageB = await second.newPage();
  await pageB.goto(url);
  await expect(pageB.locator(".app-canvas")).toHaveAttribute("data-ready", "true");
  await openLibrary(pageB, "cards");
  await pageB.waitForTimeout(500);
  await expect(libraryRows(pageB)).toHaveCount(0);

  await first.close();
  await second.close();
});
