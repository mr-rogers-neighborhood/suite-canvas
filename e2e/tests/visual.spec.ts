import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

/**
 * Visual regression baselines for the surfaces where layout is the contract:
 * the mention/property chips that carry share-boundary state, the sharing and
 * library dialogs, the card shell, and the app bar.
 *
 * The React Flow board and the recursive-portal scene projection are gone (the
 * canvas is ICE), so their baselines went with them; ICE draws on a GPU and a
 * screenshot of it would encode one machine's adapter, which is why the ICE
 * spec writes a failure screenshot under `test-results` instead of a baseline.
 *
 * Baselines live in `tests/visual/` (committed), not in Playwright's default
 * `tests/visual.spec.ts-snapshots/` sibling: this file sets the path template
 * itself because the shared `playwright.config.ts` is owned by another lane.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const STORYBOOK_APP_DIR = path.join(REPO_ROOT, "apps/canvas");
const STORYBOOK_DIR = path.join(STORYBOOK_APP_DIR, "storybook-static");
const STORYBOOK_PORT = 6006;
const STORYBOOK_URL = `http://127.0.0.1:${STORYBOOK_PORT}`;

/**
 * Text antialiasing and font hinting differ between machines, so a strict
 * pixel compare fails for reasons that are not layout regressions. The
 * `threshold` (YIQ distance, Playwright's default) ignores per-pixel colour
 * noise from subpixel rendering; `maxDiffPixels` bounds how many pixels may
 * still differ. A real layout change moves glyphs and boxes by orders of
 * magnitude more pixels than these budgets.
 */
const COMPONENT_MAX_DIFF_PIXELS = 60;

const STABILITY = {
  animations: "disabled",
  caret: "hide",
  scale: "css",
  threshold: 0.2,
} as const;

interface StableOptions {
  maxDiffPixels?: number;
  /** Regions whose text changes per run (names, ids, peers) are painted over. */
  mask?: Locator[];
}

async function expectStable(
  name: string,
  target: Locator,
  options: StableOptions = {},
): Promise<void> {
  await expect(target).toHaveScreenshot(name, {
    ...STABILITY,
    maxDiffPixels: options.maxDiffPixels ?? COMPONENT_MAX_DIFF_PIXELS,
    ...(options.mask ? { mask: options.mask } : {}),
  });
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Serial on purpose. The file owns one static server on a fixed port, so with
 * Playwright's `fullyParallel` each worker would start its own `--strictPort`
 * server and the first `afterAll` would kill the one its peers depend on. Serial
 * mode pins the whole file to one worker, which costs a few seconds and removes
 * the race entirely.
 */
test.describe.configure({ mode: "serial" });

let storybook: ChildProcess | undefined;

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires the fixtures argument to be a destructuring pattern.
test.beforeAll(async ({}, testInfo: TestInfo) => {
  // Point `toHaveScreenshot` at `tests/visual/` rather than the default
  // `tests/visual.spec.ts-snapshots/`. Playwright's public per-file knob for
  // this (`snapshotPathTemplate`) lives in the config, which this lane must
  // not touch, so the worker's project config is adjusted here instead.
  const internal = (testInfo as unknown as { _projectInternal?: { snapshotPathTemplate?: string } })
    ._projectInternal;
  if (!internal) {
    throw new Error(
      "Playwright's internal project config is unavailable, so baselines would land outside tests/visual/.",
    );
  }
  internal.snapshotPathTemplate = "{testDir}/visual/{arg}{ext}";

  if (!existsSync(path.join(STORYBOOK_DIR, "index.json"))) {
    throw new Error(
      "storybook-static is missing; run `pnpm build-storybook` before the visual suite.",
    );
  }
  // An already-running server (local iteration) is reused, like `webServer`.
  if (await reachable(`${STORYBOOK_URL}/index.json`)) return;

  const vite = path.join(STORYBOOK_APP_DIR, "node_modules/.bin/vite");
  storybook = spawn(
    vite,
    ["preview", "--outDir", "storybook-static", "--port", String(STORYBOOK_PORT), "--strictPort"],
    { cwd: STORYBOOK_APP_DIR, stdio: "ignore" },
  );

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await reachable(`${STORYBOOK_URL}/index.json`)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Storybook static server did not come up on ${STORYBOOK_URL}.`);
});

test.afterAll(() => {
  storybook?.kill();
  storybook = undefined;
});

async function openStory(page: Page, id: string, target: Locator): Promise<void> {
  await page.goto(`${STORYBOOK_URL}/iframe.html?id=${id}&viewMode=story`);
  await target.waitFor({ state: "visible" });
  // Local woff2 files are part of the static build, so waiting for them is
  // enough to keep text metrics stable; the short settle lets portals finish
  // their first layout.
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForTimeout(150);
}

interface StoryCase {
  name: string;
  story: string;
  target: (page: Page) => Locator;
  /**
   * Regions whose copy is relative to "now" (a share's "Last used 9 months
   * ago") change without any code changing, so they are painted over rather
   * than frozen into a baseline that would rot.
   */
  mask?: (page: Page) => Locator[];
}

test.describe("visual: stories", () => {
  test.use({
    viewport: { width: 1000, height: 700 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });

  const cases: StoryCase[] = [
    {
      name: "mention-chip-default.png",
      story: "components-mentionchip--default",
      target: (page) => page.getByTestId("mention-chip"),
    },
    {
      name: "mention-chip-not-shared.png",
      story: "components-mentionchip--not-shared",
      target: (page) => page.getByTestId("mention-chip"),
    },
    {
      name: "mention-chip-unavailable.png",
      story: "components-mentionchip--unavailable",
      target: (page) => page.getByTestId("mention-chip"),
    },
    {
      name: "share-dialog-selection.png",
      story: "components-sharedialog--selection",
      target: (page) => page.getByTestId("share-dialog"),
      mask: (page) => [page.locator('[data-testid^="share-last-used-"]')],
    },
    {
      name: "library-drawer-search-query.png",
      story: "components-librarydrawer--search-query",
      target: (page) => page.getByTestId("library-drawer"),
    },
    {
      name: "node-card-default.png",
      story: "components-nodecard--read-only",
      target: (page) => page.getByTestId("node-card"),
    },
    {
      name: "node-card-expanded-metadata.png",
      story: "components-nodecard--with-expanded-frontmatter",
      target: (page) => page.getByTestId("node-card"),
    },
    {
      name: "property-block-chip-linked-card-states.png",
      story: "components-propertyblockchip--linked-card-states",
      target: (page) => page.locator("#storybook-root p > span"),
    },
  ];

  for (const entry of cases) {
    test(entry.name, async ({ page }) => {
      const target = entry.target(page);
      await openStory(page, entry.story, target);
      await expectStable(entry.name, target, entry.mask ? { mask: entry.mask(page) } : {});
    });
  }
});

test.describe("visual: app", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });

  async function openWorkspace(page: Page): Promise<void> {
    // A fresh workspace per run: the collab server keeps documents, so a fixed
    // id would inherit whatever a previous run (or a person) left behind.
    await page.goto(withOwnerKey(`/?workspace=visual-${Date.now()}-${crypto.randomUUID()}`));
    // The canvas is ICE and needs WebGPU, which headless Chromium has none of.
    // The bar is shell, so the frame waits for the surface element and a synced
    // document, never for a drawn card.
    await expect(page.getByTestId("ice-surface")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".app-canvas")).toHaveAttribute("data-ready", "true");
    await expect(page.getByTestId("sync-status")).toHaveText("Live");
  }

  test("app bar at rest", async ({ page }) => {
    await openWorkspace(page);

    // The workspace name is generated per workspace and the board name is per
    // run; neither is part of the bar's layout contract, but a screenshot
    // compares pixels, so both are replaced with a fixed label and then masked
    // out. Renaming instead would also reflow the tabs and Views menu.
    await page.evaluate(() => {
      const name = document.querySelector('[data-testid="workspace-name"]');
      if (name) name.textContent = "Workspace name";
    });

    await expectStable("app-bar.png", page.locator("header.app-bar"), {
      mask: [
        page.getByTestId("workspace-name"),
        page.getByRole("tab").first(),
        page.getByTestId("sync-status"),
      ],
    });
  });
});
