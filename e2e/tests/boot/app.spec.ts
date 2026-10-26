import { expect, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";

test("canvas app boots and renders the board", { tag: "@smoke" }, async ({ page }) => {
  // A fresh workspace per run: the default one is shared state on the collab server.
  await page.goto(`/?workspace=e2e-boot-${Date.now()}`);
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await expect(page.getByTestId("dock-library")).toBeVisible();
  await expect(page.locator('[data-testid^="board-tab"]')).toHaveCount(1);
});

test("shows render counters with ?perf=1", { tag: "@smoke" }, async ({ page }) => {
  await page.goto(`/?workspace=e2e-perf-${Date.now()}&perf=1`);
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  // The overlay reports at least the canvas and per-card render rates.
  await expect(page.getByTestId("perf-key").first()).toBeVisible();
  await expect(page.getByText("renders/s")).toBeVisible();
  await expect
    .poll(async () => page.getByTestId("perf-key").allInnerTexts())
    .toEqual(expect.arrayContaining(["canvas", "card"]));
});

test("does not reseed a workspace another client emptied", { tag: "@smoke" }, async ({
  browser,
}) => {
  const url = hostedUrl(`/?workspace=e2e-no-reseed-${Date.now()}`);

  const first = await browser.newContext({ storageState: ACCOUNT_STATE });
  const pageA = await first.newPage();
  await pageA.goto(url);
  await expect(pageA.locator('[data-testid="node-card"]')).toHaveCount(2);

  // Empty the board (the cards go to the trash, the workspace stays seeded).
  for (let remaining = 2; remaining > 0; remaining -= 1) {
    await pageA
      .locator('[data-testid="node-card"]')
      .first()
      .click({ position: { x: 40, y: 14 } });
    await pageA.keyboard.press("Shift+Delete");
  }
  await expect(pageA.locator('[data-testid="node-card"]')).toHaveCount(0);

  // A fresh client has an empty IndexedDB but must not treat that as a new
  // workspace. Seeding waits for the server's snapshot, so a slow sync cannot
  // resurrect starter cards here (the gate is asserted in the store, this test
  // pins the end state a joining client must reach).
  const second = await browser.newContext({ storageState: ACCOUNT_STATE });
  const pageB = await second.newPage();
  await pageB.goto(url);
  await expect(pageB.locator(".app-canvas")).toHaveAttribute("data-ready", "true");
  await pageB.waitForTimeout(500);
  await expect(pageB.locator('[data-testid="node-card"]')).toHaveCount(0);

  await first.close();
  await second.close();
});
