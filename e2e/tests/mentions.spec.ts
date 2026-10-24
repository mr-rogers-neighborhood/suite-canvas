import { expect, type Locator, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { inspector, libraryRows, openCardInspector, openLibrary } from "./support";

/**
 * Mentions are a Tiptap extension of the card's title and body. ICE paints the
 * card itself on the GPU and mounts no editor over it, so both surfaces are
 * exercised where they are editable: the inspector's title editor and its body
 * editor (`card-panel-body`). The chips, the picker, the arrow-key drills and
 * the derived reference index are the same code on either surface.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-mentions-${name}-${Date.now()}-${++sequence}`);

const body = (page: Page) => inspector(page).getByTestId("card-panel-body");

/** Renames a card from its library row, leaving the library open. */
async function rename(page: Page, title: string): Promise<void> {
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await inspector(page).getByTestId("card-panel-title").click();
  await page.locator(".card-inspector .card-title-editor.ProseMirror-focused").type(title);
}

/** Names the two starter cards, so rows and chips can be matched by text. */
async function nameStarterCards(page: Page, first: string, second: string): Promise<void> {
  await openLibrary(page, "cards");
  await libraryRows(page).nth(0).click();
  await rename(page, first);
  await inspector(page).getByTestId("inspector-close").click();
  await libraryRows(page).nth(1).click();
  await rename(page, second);
  await inspector(page).getByTestId("inspector-close").click();
}

/** Opens `title` in the inspector with its body editor focused. */
async function openBody(page: Page, title: string): Promise<void> {
  await openCardInspector(page, { title });
  await inspector(page).getByTestId("card-panel-tab-content").click();
  await body(page).click();
  await expect(body(page)).toHaveAttribute("data-editing", "true");
  // React StrictMode remounts the editor once in dev.
  await page.waitForTimeout(250);
}

/** Adds a `Owner` text field to the shared note type and fills it on `title`. */
async function addOwnerField(page: Page, title: string, value: string): Promise<void> {
  await openCardInspector(page, { title });
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await inspector(page).getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Owner");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Owner")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await inspector(page).getByLabel("Owner").fill(value);
  await inspector(page).getByLabel("Owner").blur();
  await inspector(page).getByTestId("inspector-close").click();
}

/** The body's text as typed, without the shadow completion decorations. */
async function typedText(page: Page): Promise<string> {
  return body(page)
    .locator(".node-card-editor p")
    .evaluate((node) =>
      [...node.childNodes]
        .filter((child) => !(child as HTMLElement).classList?.contains("mention-ghost"))
        .map((child) => child.textContent ?? "")
        .join(""),
    );
}

test("inserts a mention from the picker and keeps it after a reload", async ({ page }) => {
  await page.goto(workspaceUrl("insert"));
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await nameStarterCards(page, "Target card", "Source card");

  await openBody(page, "Source card");
  await page.keyboard.type("@Targ");
  const picker = page.getByTestId("mention-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible();
  // The query filters: a card that does not match is not offered.
  await expect(page.getByTestId("mention-option")).toHaveCount(1);

  await page.keyboard.press("Enter");

  const chip = body(page).getByTestId("mention-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Target card");
  await expect(picker).toHaveCount(0);

  // Typing continues after the atom, and the chip stays one node.
  await page.keyboard.type("done");
  await expect(body(page)).toContainText("done");
  await expect(body(page).getByTestId("mention-chip")).toHaveCount(1);

  // Clicking the chip opens the target's panel instead of editing this card.
  await chip.click();
  await expect(inspector(page)).toContainText("Target card");

  await page.reload();
  await expect(page.getByTestId("ice-surface")).toBeVisible();
  await openBody(page, "Source card");
  await expect(body(page).getByTestId("mention-chip")).toContainText("Target card");
});

test("mentions work in the title editor", async ({ page }) => {
  await page.goto(workspaceUrl("title"));
  await nameStarterCards(page, "Target card", "Title host");

  await openCardInspector(page, { title: "Title host" });
  await inspector(page).getByTestId("card-panel-tab-details").click();
  await inspector(page).getByTestId("card-panel-title").click();
  const titleEditor = page.locator(".card-inspector .card-title-editor.ProseMirror-focused");
  await expect(titleEditor).toHaveCount(1);

  await page.keyboard.press("End");
  await page.keyboard.type(" @Targ");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible({
    timeout: 10_000,
  });
  await page.keyboard.press("Enter");

  const chip = page.locator(".card-inspector .card-title-editor").getByTestId("mention-chip");
  await expect(chip).toContainText("Target card");
  // Enter picked the suggestion instead of committing the title.
  await expect(titleEditor).toHaveCount(1);

  await inspector(page).getByTestId("card-panel-tab-details").click();
  await expect(chip).toContainText("Target card");
});

test("shows no-match feedback without inserting anything", async ({ page }) => {
  await page.goto(workspaceUrl("empty"));
  await nameStarterCards(page, "Target card", "Source card");
  await openBody(page, "Source card");

  await page.keyboard.type("@zzzz");
  await expect(page.getByTestId("mention-empty")).toContainText("Nothing matches");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mention-picker")).toHaveCount(0);
  // Escape dismissed the picker; the typed text stays, and no chip was added.
  await expect(body(page).getByTestId("mention-chip")).toHaveCount(0);
});

test("links to one field of another card and lands on it", async ({ page }) => {
  await page.goto(workspaceUrl("field-ref"));
  await nameStarterCards(page, "Target card", "Source card");
  await addOwnerField(page, "Target card", "Ada");

  await openBody(page, "Source card");
  // Naming a single card opens its fields underneath it, so the property is
  // reachable without knowing the dot syntax: one arrow down starts browsing
  // that card's fields.
  await page.keyboard.type("@Targ");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  const options = page.getByTestId("mention-option");
  await expect(options.first()).toBeVisible({ timeout: 10_000 });
  await expect(options.first()).toHaveAttribute("data-kind", "card");
  await expect(options.nth(1)).toHaveAttribute("data-kind", "reference");
  await expect(options.nth(1)).toContainText("Owner");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  const chip = body(page).getByTestId("mention-chip");
  // Field ids are generated, so the chip is identified by what it shows.
  await expect(chip).toHaveAttribute("data-field-id", /[\w-]+/);
  await expect(chip).toContainText("Target card");
  // The chip reads the value live; it is a link, not a copy.
  await expect(chip.getByTestId("mention-chip-value")).toHaveText("Ada");

  // A field chip opens its menu first; opening the card is one row inside, and
  // it lands on the field rather than the top of the panel.
  await chip.click();
  await page.getByRole("menuitem", { name: "Open card" }).click();
  await expect(inspector(page)).toContainText("Target card");
  const row = page.locator('.property-row[data-focused="true"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Owner");
  await expect(row.getByLabel("Owner")).toBeFocused();
});

test("steps into a card's fields with the arrow keys", async ({ page }) => {
  await page.goto(workspaceUrl("submenu"));
  await nameStarterCards(page, "Target", "Source");
  await addOwnerField(page, "Target", "Ada");

  await openBody(page, "Source");
  // The card row advertises its fields, and arrowing onto it *shadows* the
  // completion instead of typing it: the card holds only what was typed.
  await page.keyboard.type("@Tar");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  const cardRows = page.locator('[data-testid="mention-option"][data-kind="card"]');
  const targetRow = cardRows.filter({ hasText: "Target" });
  await expect(targetRow).toBeVisible({ timeout: 10_000 });
  await expect(targetRow).toHaveAttribute("aria-selected", "true");
  await expect(targetRow.getByTestId("mention-option-submenu")).toContainText("1");
  await expect(body(page).locator(".mention-ghost")).toHaveText("get");
  expect(await typedText(page)).toBe("@Tar");

  // Right steps in, Left steps back out to the card.
  const nested = page.locator('[data-testid="mention-option"][data-nested="true"]');
  await page.keyboard.press("ArrowRight");
  await expect(nested).toHaveAttribute("aria-selected", "true");
  await expect(nested).toContainText("Owner");
  await page.keyboard.press("ArrowLeft");
  await expect(targetRow).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(nested).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");
  const chip: Locator = body(page).getByTestId("mention-chip");
  await expect(chip).toHaveAttribute("data-field-id", /[\w-]+/);
  await expect(chip.getByTestId("mention-chip-value")).toHaveText("Ada");
  await expect(page.getByTestId("mention-option")).toHaveCount(0);
  await expect(body(page).locator(".mention-ghost")).toHaveCount(0);
});

test("opens the submenu with a dot without typing it", async ({ page }) => {
  await page.goto(workspaceUrl("dot-drill"));
  await nameStarterCards(page, "Target", "Source");
  await addOwnerField(page, "Target", "Ada");

  await openBody(page, "Source");
  // `.` is a gesture on the highlighted card, not text: nothing is inserted,
  // so a title with a space is no obstacle either.
  await page.keyboard.type("@Tar");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press(".");
  const fields = page.locator('[data-testid="mention-option"][data-kind="reference"]');
  await expect(fields).toHaveCount(1);
  await expect(fields.first()).toContainText("Owner");
  expect(await typedText(page)).toBe("@Tar");

  // Typing while the submenu is open filters its fields, not the cards.
  await page.keyboard.type("Ow");
  await expect(fields).toHaveCount(1);
  await expect(fields.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(body(page).getByTestId("mention-chip").getByTestId("mention-chip-value")).toHaveText(
    "Ada",
  );
});

test("syncs a mention and its live title to a peer", async ({ browser }) => {
  test.setTimeout(60_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = workspaceUrl("two-clients");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageB.locator(".app-canvas")).toHaveAttribute("data-ready", "true");

  await nameStarterCards(pageA, "Target card", "Source card");

  await openBody(pageA, "Source card");
  await pageA.keyboard.type("@Target");
  await expect(pageA.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  await expect(pageA.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible({
    timeout: 10_000,
  });
  await pageA.keyboard.press("Enter");

  // B reads the shared body and renders its own chip with the live title.
  await openBody(pageB, "Source card");
  await expect(body(pageB).getByTestId("mention-chip")).toContainText("Target card", {
    timeout: 20_000,
  });

  // Renaming the target on B renames it inside A's mention.
  await openCardInspector(pageB, { title: "Target card" });
  await inspector(pageB).getByTestId("card-panel-tab-details").click();
  await inspector(pageB).getByTestId("card-panel-title").click();
  await pageB
    .locator(".card-inspector .card-title-editor.ProseMirror-focused")
    .type(" renamed", { delay: 10 });
  await inspector(pageB).getByTestId("card-panel-tab-details").click();

  await expect(body(pageA).getByTestId("mention-chip")).toContainText("Target card renamed", {
    timeout: 20_000,
  });

  await contextA.close();
  await contextB.close();
});
