import { expect, test } from "@playwright/test";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards, openLibrary, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-palette");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

test("opens the command palette from the app bar and jumps to an action", async ({ page }) => {
  await page.goto(workspaceUrl("bar"));
  await expect(cards(page)).toHaveCount(2);

  // The bar's trigger is the discoverable path; the shortcut is the fast one.
  await page.getByTestId("command-bar").click();
  const palette = page.getByTestId("command-palette");
  await expect(palette).toBeVisible();
  await expect(page.getByTestId("command-palette-row").first()).toBeVisible();

  await page.getByTestId("command-palette-input").fill("new board");
  await expect(page.getByTestId("command-palette-row")).toHaveCount(1);
  await page.getByTestId("command-palette-row").first().click();

  // "New board" runs and the palette closes; the new tab is proof it ran.
  await expect(palette).toHaveCount(0);
  // Scoped and exact: "Close Board 2" is also a button whose name contains "Board 2".
  await expect(
    page
      .getByRole("navigation", { name: "Boards" })
      .getByRole("button", { name: "Board 2", exact: true }),
  ).toBeVisible();
});

test("opens the palette with Cmd+K and closes it with Escape", async ({ page }) => {
  await page.goto(workspaceUrl("shortcut"));
  await expect(cards(page)).toHaveCount(2);

  await page.locator('[data-testid="canvas-board"]').click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
});

test("keeps library search on Cmd+Shift+K", async ({ page }) => {
  await page.goto(workspaceUrl("library-search"));
  await expect(cards(page)).toHaveCount(2);

  await page.locator('[data-testid="canvas-board"]').click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("Control+Shift+k");

  await expect(page.getByTestId("library-search")).toBeFocused();
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
  await openLibrary(page, "cards");
});
