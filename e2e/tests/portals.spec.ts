import { expect, type Page, test } from "@playwright/test";
import { emptyPanePoint } from "./marquee";
import { withOwnerKey } from "./ownerUrl";
import { createNote } from "./support";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-portal-${name}-${Date.now()}-${++sequence}`);

const portalNodes = (page: Page) => page.getByTestId("portal-node");
const boardTabs = (page: Page) => page.locator('[role="tab"]');

async function createBoard(page: Page): Promise<void> {
  await page.getByTestId("board-create").click();
  await expect(boardTabs(page)).toHaveCount(2);
}

async function createPortal(page: Page, target: string): Promise<void> {
  const point = await emptyPanePoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New portal" }).click();
  const submenu = page.getByTestId("context-submenu");
  await expect(submenu).toBeVisible();
  await submenu.getByRole("menuitem", { name: target }).click();
  await expect(portalNodes(page)).toHaveCount(1);
}

test("creates a portal and enters the target board through the camera", async ({ page }) => {
  await page.goto(workspaceUrl("enter"));
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);

  await createBoard(page);
  await createNote(page, "Target Two");
  await page.getByRole("tab", { name: "Board 1" }).click();
  await expect(page.locator('[data-testid="node-card"]')).toHaveCount(2);

  await createPortal(page, "Board 2");
  const portal = portalNodes(page);
  await expect(portal).toContainText("Board 2");
  await expect(portal.getByTestId("portal-miniature")).toBeVisible();

  await portal.dblclick();
  // The overlay exists for at least one frame; the board switch is the proof
  // that the completed transition landed.
  await expect(page.getByTestId("portal-transition")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: "Board 2" })).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator('[data-testid="node-card"]').filter({ hasText: "Target Two" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("portal-transition")).toHaveCount(0);
});

test("the back control exists only for a board entered through a portal", async ({ page }) => {
  await page.goto(workspaceUrl("back"));
  await createBoard(page);
  await createNote(page, "Target Two");
  await page.getByRole("tab", { name: "Board 1" }).click();
  await createPortal(page, "Board 2");

  // A tab click leaves every board one click away, so it gets no back control.
  await expect(page.getByTestId("portal-back")).toHaveCount(0);

  await portalNodes(page).dblclick();
  await expect(page.getByRole("tab", { name: "Board 2" })).toHaveAttribute("aria-selected", "true");

  // The portal entry is the one place the reader was *taken* somewhere.
  await page.getByTestId("portal-back").click();
  await expect(page.getByRole("tab", { name: "Board 1" })).toHaveAttribute("aria-selected", "true");
  await expect(portalNodes(page)).toHaveCount(1);
  // History is spent, so the control disappears with it.
  await expect(page.getByTestId("portal-back")).toHaveCount(0);
});

test("Escape leaves a portal entry the same way the back control does", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await createBoard(page);
  await createNote(page, "Target Two");
  await page.getByRole("tab", { name: "Board 1" }).click();
  await createPortal(page, "Board 2");

  await portalNodes(page).dblclick();
  await expect(page.getByRole("tab", { name: "Board 2" })).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Board 1" })).toHaveAttribute("aria-selected", "true");
  await expect(portalNodes(page)).toHaveCount(1);
});

test("survives an A to B to A cycle", async ({ page }) => {
  await page.goto(workspaceUrl("cycle"));
  await createBoard(page);
  await createNote(page, "Target Two");
  await page.getByRole("tab", { name: "Board 1" }).click();
  await createPortal(page, "Board 2");

  await portalNodes(page).dblclick();
  await expect(page.getByRole("tab", { name: "Board 2" })).toHaveAttribute("aria-selected", "true");

  await createPortal(page, "Board 1");
  await portalNodes(page).dblclick();
  await expect(page.getByRole("tab", { name: "Board 1" })).toHaveAttribute("aria-selected", "true");
  await expect(portalNodes(page)).toHaveCount(1);
});

test("opens a card full-canvas from the inspector and restores the board on Escape", async ({
  page,
}) => {
  await page.goto(workspaceUrl("focus"));
  const card = page.locator('[data-testid="node-card"]').first();
  await expect(card).toBeVisible();

  // The inspector's Edit is the documented path, and it must hand the caret to
  // the body without a second click.
  await card.click();
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await page.getByTestId("inspector-edit").click();

  const focus = page.getByTestId("card-focus");
  await expect(focus).toBeVisible();
  await expect(focus.getByRole("textbox", { name: "Note body" })).toBeFocused();
  // Focus owns the canvas, so the inspector must not duplicate the same card.
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(focus).toHaveCount(0);
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(card).toBeVisible();
});

test("opens a card full-canvas from the card menu", async ({ page }) => {
  await page.goto(workspaceUrl("focus-menu"));
  const card = page.locator('[data-testid="node-card"]').first();
  await expect(card).toBeVisible();

  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Open in focus" }).click();
  await expect(page.getByTestId("card-focus")).toBeVisible();

  await page.getByTestId("card-focus-back").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
});

test("marks a portal unavailable instead of breaking when its board is deleted", async ({
  page,
}) => {
  await page.goto(workspaceUrl("missing"));
  await createBoard(page);
  await page.getByRole("tab", { name: "Board 1" }).click();
  await createPortal(page, "Board 2");

  await page.getByRole("tab", { name: "Board 2" }).click();
  await page.getByRole("button", { name: "Delete Board 2" }).click();
  await expect(boardTabs(page)).toHaveCount(1);
  await expect(portalNodes(page)).toHaveAttribute("data-unavailable", "true");
  await expect(portalNodes(page)).toContainText("Unavailable board");
});
