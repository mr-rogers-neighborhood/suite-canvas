import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards, createNote, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-templates");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

/** Opens the type editor from the dock and selects a type by id. */
async function openTypes(page: Page, typeId: string) {
  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-manage-types").click();
  const settings = page.getByTestId("type-settings");
  await expect(settings).toBeVisible();
  await settings.getByTestId(`settings-type-${typeId}`).click();
  return settings;
}

/**
 * A type template is an ordinary card (ADR-0038): author it once from the type
 * editor, and every new card of that type arrives written.
 */
test("seeds a new card from its type template", async ({ page }) => {
  await page.goto(workspaceUrl("seed"));
  await expect(cards(page)).toHaveCount(2);

  const settings = await openTypes(page, "note");
  await expect(settings.getByTestId("type-template-create")).toBeVisible();
  await settings.getByTestId("type-template-create").click();

  // Creating a template opens it in the focus surface. Write its body there:
  // the panel's body editor is the same editor a card uses.
  const focus = page.getByTestId("card-focus");
  await expect(focus).toBeVisible();
  await focus.getByTestId("card-panel-body").click();
  await page.keyboard.type("Answer these questions:");
  // The body lands in the document as it is typed, so the panel already shows it.
  await expect(focus.getByTestId("card-panel-body")).toContainText("Answer these questions");
  await focus.getByTestId("card-focus-close").click();
  await expect(focus).toHaveCount(0);

  // The editor now names the template instead of offering to create one.
  const reopened = await openTypes(page, "note");
  await expect(reopened.getByTestId("type-template-open")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("dock-new-card").click();
  await page.getByTestId("dock-type-note").click();

  // The template itself is unplaced, so the board gains exactly the new card.
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).filter({ hasText: "Answer these questions" })).toHaveCount(1);
});

test("creates a plain card when the type has no template", async ({ page }) => {
  await page.goto(workspaceUrl("plain"));
  await expect(cards(page)).toHaveCount(2);

  await createNote(page, "Just a note");
  await expect(cards(page).filter({ hasText: "Just a note" })).toHaveCount(1);
});
