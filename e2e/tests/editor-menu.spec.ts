import { expect, type Page, test } from "@playwright/test";
import { inspector, openCardInspector } from "./support";

/**
 * The slash menu is a Tiptap extension of the card body, and the inspector is
 * where that body is edited now (`card-panel-body`). The canvas card face ICE
 * draws paints text on the GPU and mounts no editor, so every test here opens a
 * starter card in the panel and types there.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-editor-menu-${name}-${Date.now()}-${++sequence}`;

/** Focuses the inspector's body editor on the first card. */
async function editBody(page: Page): Promise<void> {
  await openCardInspector(page);
  await page.getByTestId("card-panel-body").click();
  await expect(page.getByTestId("card-panel-body")).toHaveAttribute("data-editing", "true");
  // React StrictMode remounts the editor once in dev; let the focused instance
  // settle so the first keystrokes cannot land in the discarded one.
  await page.waitForTimeout(250);
}

const body = (page: Page) => inspector(page).getByTestId("card-panel-body");

test("turns `/h1` into a heading", async ({ page }) => {
  await page.goto(workspaceUrl("heading"));
  await editBody(page);

  await page.keyboard.type("/h1");
  const menu = page.getByTestId("slash-menu");
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("slash-option")).toHaveCount(1);
  await expect(page.getByTestId("slash-option").first()).toContainText("Heading 1");

  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);

  await expect(body(page).locator("h1")).toHaveCount(1);
  // The typed query is consumed, not left in the heading.
  await expect(body(page)).not.toContainText("/h1");

  // Preflight resets headings; the editor must restore real heading type.
  const heading = await body(page)
    .locator("h1")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    });
  expect(heading.fontSize).toBe("20px");
  expect(Number(heading.fontWeight)).toBeGreaterThanOrEqual(600);
});

test("navigates the menu with the arrow keys", async ({ page }) => {
  await page.goto(workspaceUrl("arrows"));
  await editBody(page);

  // `/` lists every block in order; two downs from the first land on the
  // bulleted list, which is why the count only guards that the menu is complete.
  await page.keyboard.type("/");
  await expect(page.getByTestId("slash-option")).toHaveCount(10);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("slash-option").nth(2)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(body(page).locator("ul li")).toHaveCount(1);

  const list = await body(page)
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
  await editBody(page);

  await page.keyboard.type("/divider");
  await expect(page.getByTestId("slash-option").filter({ hasText: "Divider" })).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(body(page).locator("hr")).toHaveCount(1);
  await expect(body(page)).not.toContainText("/divider");

  const rule = await body(page)
    .locator("hr")
    .evaluate((element) => getComputedStyle(element).borderTopWidth);
  expect(Number.parseFloat(rule)).toBeGreaterThan(0);
});

test("styles quotes and code blocks", async ({ page }) => {
  await page.goto(workspaceUrl("blocks"));
  await editBody(page);

  await page.keyboard.type("/quote");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A quoted line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/code");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const x = 1;");

  await expect(body(page).locator("blockquote")).toContainText("A quoted line");
  await expect(body(page).locator("pre")).toContainText("const x = 1;");

  const quote = await body(page)
    .locator("blockquote")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { borderLeftWidth: style.borderLeftWidth, paddingLeft: style.paddingLeft };
    });
  expect(Number.parseFloat(quote.borderLeftWidth)).toBeGreaterThan(0);
  expect(Number.parseFloat(quote.paddingLeft)).toBeGreaterThan(0);

  const code = await body(page)
    .locator("pre")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontFamily: style.fontFamily, background: style.backgroundColor };
    });
  expect(code.fontFamily.toLowerCase()).toContain("mono");
  expect(code.background).not.toBe("rgba(0, 0, 0, 0)");
});

test("hands `/mention` over to the mention picker", async ({ page }) => {
  await page.goto(workspaceUrl("mention-handover"));
  await editBody(page);

  await page.keyboard.type("/mention");
  await page.keyboard.press("Enter");

  // The slash menu is replaced by the mention picker, which is the point.
  await expect(page.getByTestId("slash-menu")).toHaveCount(0);
  await expect(page.getByTestId("mention-picker")).toBeVisible();
  await expect(page.getByTestId("mention-option").first()).toBeVisible();
});

test("Escape dismisses the menu and keeps the typed text", async ({ page }) => {
  await page.goto(workspaceUrl("escape"));
  await editBody(page);

  await page.keyboard.type("/head");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("slash-menu")).toHaveCount(0);
  await expect(body(page)).toContainText("/head");
});

test("shows a field in the body, edits it inline, and removes the block", async ({ page }) => {
  await page.goto(workspaceUrl("field-block"));
  await openCardInspector(page);

  // The field the block will show: a Status text field on the shared note type.
  await page.getByTestId("card-panel-tab-details").click();
  await page.getByTestId("manage-types").click();
  await page.getByLabel("New field name").fill("Status");
  await page.getByTestId("create-field").click();
  await expect(page.getByLabel("Field name Status")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Status").fill("In progress");
  await page.getByLabel("Status").blur();

  await page.getByTestId("card-panel-tab-content").click();
  await page.getByTestId("card-panel-body").click();
  await page.waitForTimeout(250);

  await page.keyboard.type("/property");
  await expect(page.getByTestId("slash-menu")).toBeVisible();
  await page.getByTestId("slash-option").filter({ hasText: "Property" }).click();
  const fieldOption = page.locator('[data-testid="mention-option"][data-kind="field"]');
  await expect(fieldOption).toContainText("Status");
  await fieldOption.click();

  const block = body(page).getByTestId("property-block");
  await expect(block).toHaveCount(1);
  await expect(block.getByTestId("property-block-value")).toHaveText("In progress");

  await block.getByTestId("property-block-remove").click();
  await expect(body(page).getByTestId("property-block")).toHaveCount(0);
});
