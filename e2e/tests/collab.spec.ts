import { expect, type Page, test } from "@playwright/test";

/**
 * Finds a point on the React Flow pane with no node or control panel under it,
 * so right-clicking opens the canvas menu rather than a node menu.
 */
async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");

  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.12; fy < 0.95; fy += 0.08) {
        for (let fx = 0.12; fx < 0.95; fx += 0.08) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          const element = document.elementFromPoint(offsetX + x, offsetY + y);
          if (!element) continue;
          if (element.closest('[data-testid="node-card"]')) continue;
          if (element.closest(".react-flow__panel")) continue;
          if (element.closest(".react-flow__pane")) return { x: offsetX + x, y: offsetY + y };
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );

  if (!point) throw new Error("no empty canvas point found");
  return point;
}

async function createNote(page: Page): Promise<void> {
  const point = await emptyCanvasPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page.locator('[data-testid="node-card"]:has([contenteditable="true"])')).toHaveCount(
    1,
  );
}

const editingCard = (page: Page) =>
  page.locator('[data-testid="node-card"]:has([contenteditable="true"])');

/** Each test gets its own document so parallel tests never share CRDT state. */
const docUrl = (name: string) => `/?doc=e2e-${name}-${Date.now()}`;

test("creates, edits, and deletes a note", async ({ page }) => {
  await page.goto(docUrl("create-edit-delete"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await createNote(page);
  await expect(editingCard(page).locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("note to delete");

  const created = page.locator('[data-testid="node-card"]').filter({ hasText: "note to delete" });
  await expect(created).toHaveCount(1);

  await created.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await expect(page.getByText("note to delete")).toHaveCount(0);
});

test("deletes the selected note with the keyboard", async ({ page }) => {
  await page.goto(docUrl("keyboard-delete"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  await createNote(page);
  await page.keyboard.type("keyboard delete");
  await page.keyboard.press("Escape");

  const created = page.locator('[data-testid="node-card"]').filter({ hasText: "keyboard delete" });
  await created.click();
  await page.keyboard.press("Delete");
  await expect(page.getByText("keyboard delete")).toHaveCount(0);
});

test("syncs content and presence between two clients", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl("two-clients");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();
  await expect(pageA.locator('[data-testid="node-card"]')).toHaveCount(2);
  await expect(pageB.locator('[data-testid="node-card"]')).toHaveCount(2);

  await createNote(pageA);
  await pageA.keyboard.type("hello from A");

  const noteOnB = pageB.locator('[data-testid="node-card"]').filter({ hasText: "hello from A" });
  await expect(noteOnB).toHaveCount(1);

  // Presence: B sees A's avatar on the card A is editing, plus A's caret.
  await expect(noteOnB.getByTestId("presence-avatar")).toBeVisible();
  await expect(noteOnB.locator(".ProseMirror-yjs-cursor")).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});
