import { expect, test } from "@playwright/test";

/**
 * ADR-0071 Q2: does a shared workspace carry its style to a visitor?
 *
 * Yes, and the visitor's light/dark choice still works — because a palette is
 * authored *per mode*, "the author's colours" never means "the author's
 * brightness". The visitor below is in the opposite mode from the author and
 * still sees the author's surface, painted from the palette that travels in the
 * document.
 */

const LIGHT_SURFACE = "#fdf6e3";
const DARK_SURFACE = "#241f1c";

/** `#241f1c` as the browser echoes it back, since a computed colour is always rgb(). */
function rgbOf(hex: string): string {
  const value = hex.replace("#", "");
  const parts = [0, 2, 4].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
  return `rgb(${parts.join(", ")})`;
}

/** What `--surface` resolves to, and what a card's face actually paints. */
async function paint(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const probe = document.querySelector('[data-testid="node-card"]');
    return {
      token: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
      card: probe ? getComputedStyle(probe).backgroundColor : null,
      dark: document.documentElement.classList.contains("dark"),
    };
  });
}

test("a share renders the author's palette in the visitor's own mode", async ({
  page,
  browser,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/?workspace=e2e-theme-${Date.now()}`);
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);

  // Author the two modes from the one place styles are written.
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-styles").click();
  await expect(page.getByTestId("styles-dialog")).toBeVisible();
  await page.getByTestId("styles-workspace-theme").click();
  await expect(page.getByTestId("workspace-theme")).toBeVisible();
  await page.getByTestId("workspace-theme-light-surface").fill(LIGHT_SURFACE);
  await page.getByTestId("workspace-theme-dark-surface").fill(DARK_SURFACE);
  await page.getByTestId("styles-close").click();

  // The author is in light mode and sees the light value, painted on the root.
  await expect
    .poll(async () => (await paint(page)).token.toLowerCase())
    .toBe(LIGHT_SURFACE.toLowerCase());

  // A viewer link for the workspace, then a visitor who prefers dark.
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-menu-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await page.getByTestId("share-role-viewer").click();
  await page.getByTestId("share-create").click();
  const link = await page.getByLabel("Share link").inputValue();
  await page.getByTestId("share-close").click();

  const context = await browser.newContext({ colorScheme: "dark" });
  try {
    const visitor = await context.newPage();
    await visitor.goto(link);
    await expect(visitor.locator('[data-testid="node-card"]').first()).toBeVisible({
      timeout: 15_000,
    });

    // Same palette, the visitor's mode: dark resolves to the author's dark value.
    await expect
      .poll(async () => (await paint(visitor)).token.toLowerCase())
      .toBe(DARK_SURFACE.toLowerCase());
    const visitorPaint = await paint(visitor);
    expect(visitorPaint.dark).toBe(true);
    expect(visitorPaint.card).toBe(rgbOf(DARK_SURFACE));
  } finally {
    await context.close();
  }
});
