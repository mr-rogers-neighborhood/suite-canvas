import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-bar-menu-${name}-${Date.now()}-${++sequence}`;

const menu = (page: Page) => page.getByTestId("board-switcher-menu");

/**
 * A right click is a shortcut to the same menu, wherever the name is.
 *
 * The switcher, a pinned tab and the workspace name all name something the reader can
 * rename or pin, and each of them answered a right click differently: the tab and the
 * switcher offered colours and icons but no rename, because renaming was a row in a list
 * that was not open. The menu owns the verbs; what changed is that the rename lands where
 * names are edited instead of navigating to the board it is about.
 */
test("renaming from a pinned tab opens the list on that row, and never navigates", async ({
  page,
}) => {
  await page.goto(workspaceUrl("pinned"));
  await expect(page.getByTestId("node-card").first()).toBeVisible();
  const other = await page.evaluate(() => location.search);

  // Pin the board that is open, so it earns a tab.
  await page.getByTestId("board-switcher").click();
  await menu(page).getByRole("menuitem").first().click({ button: "right" });
  await page.getByTestId("board-row-menu-pin").click();

  const tab = page.locator('[data-testid^="board-pinned-tab-"]').first();
  await expect(tab).toBeVisible();
  await tab.click({ button: "right" });
  await expect(page.getByTestId("board-row-menu")).toBeVisible();
  await page.getByTestId("board-row-menu-rename").click();

  // The list opens with that row in edit mode: the name is edited where names live.
  await expect(menu(page)).toBeVisible();
  const input = page.locator('[data-testid^="board-switch-rename-"]');
  await expect(input).toBeFocused();
  await input.fill("Renamed from the tab");
  await input.press("Enter");
  await expect(tab).toHaveAttribute("aria-label", "Renamed from the tab");
  // Still the board it started on.
  expect(await page.evaluate(() => location.search)).toBe(other);
});

test("the switcher itself answers a right click with the current board's menu", async ({
  page,
}) => {
  await page.goto(workspaceUrl("switcher"));
  await expect(page.getByTestId("node-card").first()).toBeVisible();

  await page.getByTestId("board-switcher").click({ button: "right" });
  await expect(page.getByTestId("board-row-menu")).toBeVisible();
  // The trigger *is* the current board, so its menu is that board's.
  await expect(page.getByTestId("board-row-menu-rename")).toBeVisible();

  await page.getByTestId("board-row-menu-pin").click();
  await expect(page.locator('[data-testid^="board-pinned-tab-"]')).toHaveCount(1);
});

test("the workspace name answers a right click with rename and pin", async ({ page }) => {
  await page.goto(workspaceUrl("workspace"));
  const name = page.getByTestId("workspace-name");
  await expect(name).toBeVisible();

  await name.click({ button: "right" });
  await expect(page.getByTestId("workspace-name-menu")).toBeVisible();
  await page.getByTestId("workspace-name-menu-pin").click();

  // A pin is a promise about the list, not a tab: the bar has no workspace tab.
  await name.click({ button: "right" });
  await expect(page.getByTestId("workspace-name-menu-pin")).toHaveText(/unpin/i);

  await page.getByTestId("workspace-name-menu-rename").click();
  await expect(page.getByTestId("workspace-name-input")).toBeFocused();
});
