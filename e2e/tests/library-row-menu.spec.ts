import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

/**
 * The library's rows are a title and a menu, not a title and a wall of buttons
 * (ADR-0011 §6), and the whole library can open as an asset browser. Both are
 * one control each, so these tests pin the gesture and what it is allowed to
 * reach — never the list's contents, which other specs already cover.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-rowmenu-${name}-${Date.now()}-${++sequence}`);

const drawer = (page: Page) => page.getByTestId("library-drawer");
const rows = (page: Page) => page.locator("li[data-row-id]");

async function openLibrary(page: Page, tab: string): Promise<void> {
  if ((await drawer(page).count()) === 0) await page.getByTestId("dock-library").click();
  await page.getByTestId(`library-tab-${tab}`).click();
  await expect(drawer(page)).toBeVisible();
}

test("a row's actions live behind one button so the title has room", async ({ page }) => {
  await page.goto(workspaceUrl("menu"));
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await openLibrary(page, "cards");

  const row = rows(page).first();
  const id = await row.getAttribute("data-row-id");
  if (!id) throw new Error("row has no id");

  // Exactly one button per row, and it is the menu.
  await expect(row.getByRole("button")).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Locate" })).toHaveCount(0);

  await row.getByTestId(`library-row-menu-${id}`).click();
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  // A card on the board in front of the reader is located, not placed.
  await expect(menu.getByRole("menuitem", { name: "Locate" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Open details" })).toBeVisible();

  // Choosing one runs it and closes the menu.
  await menu.getByRole("menuitem", { name: "Open details" }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
});

test("right-clicking a row opens the same menu the button does", async ({ page }) => {
  await page.goto(workspaceUrl("context"));
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await openLibrary(page, "cards");

  const row = rows(page).first();
  await row.click({ button: "right" });

  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  // Same first item as the button path, which is what makes them one menu.
  await expect(menu.getByRole("menuitem").first()).toHaveText("Open details");
});

test("the library expands to the window and comes back", async ({ page }) => {
  await page.goto(workspaceUrl("expand"));
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
  await openLibrary(page, "cards");

  const before = await drawer(page).boundingBox();
  if (!before) throw new Error("drawer not measurable");

  const toggle = page.getByTestId("library-expand");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(drawer(page)).toHaveAttribute("data-full", "true");
  const after = await drawer(page).boundingBox();
  if (!after) throw new Error("expanded drawer not measurable");
  // It takes the window: much wider and much taller than the floating drawer.
  expect(after.width).toBeGreaterThan(before.width * 1.5);
  expect(after.height).toBeGreaterThan(before.height * 1.5);

  await toggle.click();
  await expect(drawer(page)).not.toHaveAttribute("data-full", "true");
  const restored = await drawer(page).boundingBox();
  expect(Math.round(restored?.width ?? 0)).toBe(Math.round(before.width));
});

test("a row still places a card while the library is expanded", async ({ page }) => {
  await page.goto(workspaceUrl("expanded-place"));
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);

  // Unplace one card, so the inbox has a row whose action is Place.
  await page.locator('[data-testid="node-card"]').first().getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Remove from board" }).click();
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(1);

  await openLibrary(page, "inbox");
  await page.getByTestId("library-expand").click();
  await expect(drawer(page)).toHaveAttribute("data-full", "true");

  const row = rows(page).first();
  const id = await row.getAttribute("data-row-id");
  await row.getByTestId(`library-row-menu-${id}`).click();
  await page.getByRole("menuitem", { name: "Place on board" }).click();

  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);
});
