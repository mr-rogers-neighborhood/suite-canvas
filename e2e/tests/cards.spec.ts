import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-card-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

/** Creates a card from the canvas menu, which leaves its title focused. */
async function createCard(page: Page): Promise<void> {
  const board = await page.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("board not visible");
  await page.mouse.click(board.x + board.width * 0.5, board.y + board.height * 0.75, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
  await page.keyboard.press("Escape");
}

test("moves a card by dragging its header", async ({ page }) => {
  await page.goto(workspaceUrl("drag"));
  await expect(cards(page)).toHaveCount(2);
  await createCard(page);

  const card = cards(page).last();
  const before = await card.boundingBox();
  if (!before) throw new Error("card not visible");

  // The title area doubles as the card's drag handle.
  await page.mouse.move(before.x + 60, before.y + 24);
  await page.mouse.down();
  await page.mouse.move(before.x + 220, before.y + 160, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const box = await card.boundingBox();
      return box ? Math.round(box.x - before.x) : 0;
    })
    .toBeGreaterThan(100);

  // Dragging must not leave the title in edit mode.
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(0);
});

test("selects on the first title click and edits on the second", async ({ page }) => {
  await page.goto(workspaceUrl("title"));
  const card = cards(page).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");

  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(0);

  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);

  await page.keyboard.type("Renamed card");
  await expect(page.locator(".card-title-editor").filter({ hasText: "Renamed card" })).toHaveCount(
    1,
  );
});

test("clicks the body to edit and drags the body to move", async ({ page }) => {
  await page.goto(workspaceUrl("body-click"));
  const card = cards(page).first();
  const body = card.getByTestId("card-body");
  const bodyBox = await body.boundingBox();
  if (!bodyBox) throw new Error("card body not visible");
  const point = { x: bodyBox.x + 40, y: bodyBox.y + 28 };

  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
  await page.keyboard.type("Body click");
  await expect(card.getByTestId("card-body")).toHaveText("Body click");
  await page.keyboard.press("Escape");
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(0);

  const before = await card.boundingBox();
  if (!before) throw new Error("card not visible");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 140, point.y + 90, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const after = await card.boundingBox();
      return after ? Math.round(after.x - before.x) : 0;
    })
    .toBeGreaterThan(80);
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(0);
});

test("resizes a card and projects the resize to a peer", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = workspaceUrl("resize");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(pageB)).toHaveCount(2);

  const cardA = cards(pageA).first();
  const boxA = await cardA.boundingBox();
  if (!boxA) throw new Error("card not visible");
  await pageA.mouse.click(boxA.x + 60, boxA.y + 6);
  await expect(pageA.locator(".react-flow__resize-control")).not.toHaveCount(0);

  const handle = pageA.locator(".react-flow__resize-control.bottom.right").first();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("resize handle not visible");

  const cardB = cards(pageB).first();
  const beforeB = await cardB.boundingBox();

  await pageA.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(handleBox.x + 120, handleBox.y + 80, { steps: 10 });

  // The peer follows the gesture, not just the result.
  await expect(cardB).toHaveAttribute("data-resizing-by-peer", "true");
  await expect
    .poll(async () => Math.round((await cardB.boundingBox())?.width ?? 0))
    .toBeGreaterThan(Math.round(beforeB?.width ?? 0) + 40);

  await pageA.mouse.up();
  await expect(cardB).not.toHaveAttribute("data-resizing-by-peer", "true");

  const resized = Math.round((await cardB.boundingBox())?.width ?? 0);
  await pageB.reload();
  await expect
    .poll(async () => Math.round((await cards(pageB).first().boundingBox())?.width ?? 0))
    .toBe(resized);

  await contextA.close();
  await contextB.close();
});
