import { expect, type Page, test } from "@playwright/test";
import { startBodyEdit as editBody } from "../interactions";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-editor-menu-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function emptyCanvasPoint(page: Page, variant = 0): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");

  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY, variant }) => {
      const candidates: { x: number; y: number }[] = [];
      for (let fy = 0.12; fy < 0.95; fy += 0.08) {
        for (let fx = 0.12; fx < 0.95; fx += 0.08) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          const element = document.elementFromPoint(offsetX + x, offsetY + y);
          if (!element) continue;
          if (element.closest('[data-testid="node-card"]')) continue;
          if (element.closest(".react-flow__panel")) continue;
          if (element.closest(".react-flow__pane"))
            candidates.push({ x: offsetX + x, y: offsetY + y });
        }
      }
      if (candidates.length === 0) return null;
      return candidates[(variant * 17) % candidates.length];
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y, variant },
  );

  if (!point) throw new Error("no empty canvas point found");
  return point;
}

/** Creates a note and commits a title, leaving no editor focused. */
async function createNote(page: Page, title: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const point = await emptyCanvasPoint(page, attempt);
    await page.mouse.click(point.x, point.y, { button: "right" });
    const newNote = page.getByRole("menuitem", { name: "New card" });
    if (!(await newNote.isVisible({ timeout: 800 }).catch(() => false))) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      continue;
    }
    await newNote.click();
    await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await page.waitForTimeout(300);
    await page.keyboard.type(title);
    await page.keyboard.press("Escape");
    await expect(cards(page).filter({ hasText: title })).toHaveCount(1);
    return;
  }
  throw new Error("could not open the canvas menu");
}

/** Starts canvas body editing from the card menu. */

/** Opens the inspector with a click on the card header, not the editors. */
async function openCardInfo(page: Page, card = cards(page).first()): Promise<void> {
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await page.getByTestId("card-panel-tab-details").click();
}

test("turns `/h1` into a heading", async ({ page }) => {
  await page.goto(workspaceUrl("heading"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  await createNote(page, "Menu host");
  const card = cards(page).filter({ hasText: "Menu host" });
  await editBody(page, card);

  await page.keyboard.type("/h1");
  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("slash-option")).toHaveCount(1);
  await expect(page.getByTestId("slash-option").first()).toContainText("Heading 1");

  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);

  const body = card.getByTestId("card-body");
  await expect(body.locator("h1")).toHaveCount(1);
  // The typed query is consumed, not left in the heading.
  await expect(body).not.toContainText("/h1");

  // Preflight resets headings; the editor must restore real heading type.
  const heading = await body.locator("h1").evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight };
  });
  expect(heading.fontSize).toBe("20px");
  expect(Number(heading.fontWeight)).toBeGreaterThanOrEqual(600);
});

test("navigates the menu with the arrow keys", async ({ page }) => {
  await page.goto(workspaceUrl("arrows"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Arrow host");
  const card = cards(page).filter({ hasText: "Arrow host" });
  await editBody(page, card);

  // `/` lists every block in order; two downs from the first land on the
  // bulleted list, which is why the count only guards that the menu is complete.
  await page.keyboard.type("/");
  await expect(page.getByTestId("slash-option")).toHaveCount(11);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("slash-option").nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(card.getByTestId("card-body").locator("ul li")).toHaveCount(1);

  const list = await card
    .getByTestId("card-body")
    .locator("ul")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { listStyleType: style.listStyleType, paddingLeft: style.paddingLeft };
    });
  expect(list.listStyleType).toBe("disc");
  expect(Number.parseFloat(list.paddingLeft)).toBeGreaterThan(0);
});

test("inserts a divider", async ({ page }) => {
  await page.goto(workspaceUrl("divider"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Divider host");
  const card = cards(page).filter({ hasText: "Divider host" });
  await editBody(page, card);

  await page.keyboard.type("/divider");
  await expect(page.getByTestId("slash-option").filter({ hasText: "Divider" })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(card.getByTestId("card-body").locator("hr")).toHaveCount(1);
  await expect(card.getByTestId("card-body")).not.toContainText("/divider");

  const rule = await card
    .getByTestId("card-body")
    .locator("hr")
    .evaluate((element) => getComputedStyle(element).borderTopWidth);
  expect(Number.parseFloat(rule)).toBeGreaterThan(0);
});

test("styles quotes and code blocks", async ({ page }) => {
  await page.goto(workspaceUrl("blocks"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Block host");
  const card = cards(page).filter({ hasText: "Block host" });
  await editBody(page, card);

  await page.keyboard.type("/quote");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A quoted line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/code");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const x = 1;");

  const body = card.getByTestId("card-body");
  await expect(body.locator("blockquote")).toContainText("A quoted line");
  await expect(body.locator("pre")).toContainText("const x = 1;");

  const quote = await body.locator("blockquote").evaluate((element) => {
    const style = getComputedStyle(element);
    return { borderLeftWidth: style.borderLeftWidth, paddingLeft: style.paddingLeft };
  });
  expect(Number.parseFloat(quote.borderLeftWidth)).toBeGreaterThan(0);
  expect(Number.parseFloat(quote.paddingLeft)).toBeGreaterThan(0);

  const code = await body.locator("pre").evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontFamily: style.fontFamily, background: style.backgroundColor };
  });
  expect(code.fontFamily.toLowerCase()).toContain("mono");
  expect(code.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("hands `/mention` over to the mention picker", async ({ page }) => {
  await page.goto(workspaceUrl("mention"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Target card");
  await createNote(page, "Mention host");
  const card = cards(page).filter({ hasText: "Mention host" });
  await editBody(page, card);

  await page.keyboard.type("/mention");
  await expect(page.getByTestId("slash-option")).toHaveCount(1);
  await page.keyboard.press("Enter");

  // The slash query is gone and the `@` picker is the one open now.
  await expect(page.getByTestId("slash-menu")).toHaveCount(0);
  const picker = page.getByTestId("mention-picker");
  await expect(picker).toBeVisible();
  // The picker takes over the query: typing filters it as usual.
  await page.keyboard.type("Targ");
  await expect(page.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(card.getByTestId("mention-chip")).toContainText("Target card");
  await expect(card.getByTestId("card-body")).not.toContainText("/mention");
});

test("Escape dismisses the menu and keeps the typed text", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Escape host");
  const card = cards(page).filter({ hasText: "Escape host" });
  await editBody(page, card);

  await page.keyboard.type("/quote");
  await expect(page.getByTestId("slash-menu")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("slash-menu")).toHaveCount(0);
  // Escape only closes the menu: the query stays as ordinary text.
  await expect(card.getByTestId("card-body")).toContainText("/quote");
  await expect(card.getByTestId("card-body").locator("blockquote")).toHaveCount(0);
});

test("shows a field in the body, edits it inline, and removes the block", async ({ page }) => {
  await page.goto(workspaceUrl("property-block"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Field host");
  const card = cards(page).filter({ hasText: "Field host" });

  await openCardInfo(page, card);
  const panel = page.getByTestId("card-inspector");

  // Field creation stays in type settings; the editor only shows fields.
  await panel.getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await expect(settings).toBeVisible();
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Owner");
  await settings.getByTestId("create-field").click();
  // The row's name lives in an input, so match it by its accessible name.
  await expect(settings.getByLabel("Field name Owner")).toBeVisible();
  // The overlay is behind the panel, so use the dialog's own Done button.
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toHaveCount(0);

  await panel.getByLabel("Owner").fill("Ada");
  await panel.getByLabel("Owner").blur();

  // A block is inserted from the body: `/property` hands over to the same
  // picker as `@`, which lists this card's fields above its cards.
  await expect(panel.getByTestId("property-block")).toHaveCount(0);
  await panel.getByTestId("card-panel-tab-content").click();
  await panel.getByTestId("card-panel-body").click();
  await expect(panel.locator(".card-panel-body .node-card-editor")).toHaveClass(
    /ProseMirror-focused/,
  );

  await page.keyboard.type("/property");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.getByTestId("slash-option").filter({ hasText: "Property" }).click();

  // This card's own field is the row that inserts a block; a card's field row
  // (which links instead) can be open in the submenu at the same time.
  const fieldOption = page.locator('[data-testid="mention-option"][data-kind="field"]');
  await expect(fieldOption).toContainText("Owner");
  await fieldOption.click();

  const panelBlock = panel.getByTestId("property-block");
  await expect(panelBlock).toHaveCount(1);
  await expect(panelBlock).toContainText("Owner");
  await expect(panelBlock.getByTestId("property-block-value")).toHaveText("Ada");
  await expect(card.getByTestId("property-block")).toHaveCount(1);

  // Inline editing writes through setProperty; the panel input follows.
  await panelBlock.getByTestId("property-block-value").click();
  const inline = panelBlock.getByTestId("property-block-input");
  await expect(inline).toBeFocused();
  await inline.fill("Grace Hopper");
  await inline.press("Enter");

  await expect(panelBlock.getByTestId("property-block-value")).toHaveText("Grace Hopper");
  await expect(card.getByTestId("property-block")).toContainText("Grace Hopper");

  // The property row follows the inline edit, on its own tab.
  await panel.getByTestId("card-panel-tab-details").click();
  await expect(panel.getByLabel("Owner")).toHaveValue("Grace Hopper");

  // Removing the block removes the view only: the property value stays.
  await panel.getByTestId("card-panel-tab-content").click();
  await panelBlock.hover();
  await panelBlock.getByTestId("property-block-remove").click();
  await expect(panel.getByTestId("property-block")).toHaveCount(0);
  await expect(card.getByTestId("property-block")).toHaveCount(0);
  await panel.getByTestId("card-panel-tab-details").click();
  await expect(panel.getByLabel("Owner")).toHaveValue("Grace Hopper");
});
