import { type Browser, chromium, expect, test } from "@playwright/test";
import { windowArgs } from "../../scripts/e2e-window.mjs";
import { ICE_LAUNCH_OPTIONS } from "../playwright.config";

/**
 * The live ICE desk is the one surface that needs a real WebGPU adapter, and
 * Playwright's bundled headless Chromium has none (every headless mode reports
 * SwiftShader and loses the device within seconds). So this spec launches its
 * own system Chrome — headed, on whatever display the run was given. Under
 * `scripts/with-display.mjs` that display is virtual: the desk gets the
 * hardware adapter and no window appears on the user's screen.
 *
 * It skips unless `SUITE_ICE_E2E` is set, which the virtual-display wrapper sets
 * for the whole suite. `SUITE_ICE_VISIBLE=1` puts it back on the real screen so a
 * human can watch. A screenshot is written only on failure, under
 * `e2e/test-results/`, because a committed baseline would encode one machine's
 * adapter and font stack.
 */
const ENABLED = process.env.SUITE_ICE_E2E === "1";
/** On a virtual display there is no second monitor to move out of the way of. */
const VISIBLE = process.env.SUITE_ICE_VISIBLE === "1";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A machine without the Chrome channel is a skip, not a failing WebGPU claim. */
async function launchChrome(): Promise<Browser> {
  try {
    return await chromium.launch({
      ...ICE_LAUNCH_OPTIONS,
      // Only a watched run needs putting out of the way: a virtual-display
      // window is never mapped, so there is nothing to move it off of.
      args: [...ICE_LAUNCH_OPTIONS.args, ...(VISIBLE ? windowArgs() : [])],
    });
  } catch (error) {
    test.skip(true, `system Chrome is not available to Playwright: ${messageOf(error)}`);
    throw error;
  }
}

test.describe("ICE demo surface", () => {
  test.skip(!ENABLED, "set SUITE_ICE_E2E=1 to run the headed WebGPU check");

  test("seeds a rich desk on a headed Chrome with WebGPU", async () => {
    test.setTimeout(120_000);

    const testInfo = test.info();

    const origin = testInfo.project.use.baseURL ?? "http://localhost:5173";
    const url = "/ice.html";

    const browser = await launchChrome();
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    try {
      await page.goto(url);

      // The adapter acquisition and the engine import are a one-time cost; the
      // desk reports `ready` only after the layer is drawing.
      await expect(page.getByTestId("ice-status")).toHaveText("engine: ready", { timeout: 60_000 });
      await expect(page.getByTestId("ice-seed")).toHaveText("10/10 objects seeded");
      await expect(page.locator('[data-testid="ice-surface"] canvas').first()).toBeVisible();
      await expect(page.getByTestId("ice-seed-failures")).toHaveCount(0);

      // Diagnostic only: software is an allowed fallback for this check, so the
      // adapter is reported rather than asserted.
      console.log(`ICE adapter: ${await page.getByTestId("ice-adapter").innerText()}`);
    } catch (error) {
      const path = testInfo.outputPath("ice-failure.png");
      const captured = await page
        .screenshot({ path, fullPage: true })
        .then(() => true)
        .catch(() => false);
      if (captured) await testInfo.attach("ice-failure", { path, contentType: "image/png" });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  });

  test("projects the Suite example into the desk", async () => {
    test.setTimeout(120_000);

    const testInfo = test.info();
    const origin = testInfo.project.use.baseURL ?? "http://localhost:5173";
    const browser = await launchChrome();
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    try {
      await page.goto("/ice.html?demo=suite");
      await expect(page.getByTestId("ice-status")).toHaveText("engine: ready", { timeout: 60_000 });
      // The example's shape after ADR-0039: three Boards inside one View, four
      // mats in total, ten projected objects. A Boards change moves these
      // numbers, so they read from the desk rather than being recomputed here.
      await expect(page.getByTestId("ice-seed")).toHaveText("10/10 objects seeded");
      await expect(page.getByTestId("ice-demo-summary")).toHaveText(
        "Suite demo: 10 objects / 4 boards",
      );
      await expect(page.locator('[data-testid="ice-surface"] canvas').first()).toBeVisible();
      console.log(`ICE Suite adapter: ${await page.getByTestId("ice-adapter").innerText()}`);
    } catch (error) {
      const path = testInfo.outputPath("ice-suite-failure.png");
      const captured = await page
        .screenshot({ path, fullPage: true })
        .then(() => true)
        .catch(() => false);
      if (captured) await testInfo.attach("ice-suite-failure", { path, contentType: "image/png" });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  });

  test("opens a live workspace and drops a pin", async () => {
    test.setTimeout(120_000);

    const testInfo = test.info();
    const origin = testInfo.project.use.baseURL ?? "http://localhost:5173";
    const browser = await launchChrome();
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    try {
      const workspace = `suite-ice-live-${Date.now()}`;
      await page.goto(`/?workspace=${workspace}&fresh=1&canvas=ice`);

      // The app has to hydrate the real document before ICE can project it, so
      // this is slower than the standalone demo by design.
      await expect(page.getByTestId("ice-status")).toHaveText("engine: ready", { timeout: 90_000 });
      await expect(page.getByTestId("ice-hud")).toContainText("Live workspace", {
        timeout: 60_000,
      });
      await expect(page.getByTestId("ice-demo-summary")).toContainText("Workspace:");
      await expect(page.locator('[data-testid="ice-surface"] canvas').first()).toBeVisible();

      // The pins list lives in the existing library; a pin is one write and one
      // marker, and it must show up in the list without a reload.
      if ((await page.getByTestId("library-drawer").count()) === 0) {
        await page.getByTestId("dock-library").click();
      }
      await page.getByTestId("library-tab-pins").click();
      await page.getByTestId("library-drop-pin").click();
      await expect(page.locator('[data-testid^="pin-row-"]')).toHaveCount(1, { timeout: 15_000 });

      console.log(`ICE live adapter: ${await page.getByTestId("ice-adapter").innerText()}`);
    } catch (error) {
      const path = testInfo.outputPath("ice-live-failure.png");
      const captured = await page
        .screenshot({ path, fullPage: true })
        .then(() => true)
        .catch(() => false);
      if (captured) await testInfo.attach("ice-live-failure", { path, contentType: "image/png" });
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
