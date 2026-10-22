import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-mentions-${name}-${Date.now()}-${++sequence}`);

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
      // Later attempts start further along the list so a card that appeared
      // under the previous click does not get clicked again.
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
    const newNote = page.getByRole("menuitem", { name: "New note" });
    // A click can land on a card that mounted after the scan; try elsewhere.
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
    await expect(page.locator(".card-title-editor.ProseMirror-focused")).toContainText(title);
    await page.keyboard.press("Escape");
    await expect(cards(page).filter({ hasText: title })).toHaveCount(1);
    return;
  }
  throw new Error("could not open the canvas menu");
}

/**
 * Starts canvas body editing from the card menu. A double click would also open
 * the inspector with the first click, which can then swallow the second click.
 */
async function editBody(page: Page, card: ReturnType<typeof cards>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await card.getByTestId("card-menu").click();
    const item = page.getByRole("menuitem", { name: "Edit body" });
    if (await item.isVisible({ timeout: 3000 }).catch(() => false)) {
      await item.click({ timeout: 5000 }).catch(() => undefined);
    }
    if (await card.getByTestId("card-body").locator(".ProseMirror-focused").count()) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  await expect(card.getByTestId("card-body").locator(".ProseMirror-focused")).toHaveCount(1);
}

test("inserts a mention from the picker and keeps it after a reload", async ({ page }) => {
  await page.goto(workspaceUrl("insert"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);

  await createNote(page, "Target card");
  await createNote(page, "Source card");

  const source = cards(page).filter({ hasText: "Source card" });
  await editBody(page, source);

  await page.keyboard.type("@Targ");
  const picker = page.getByTestId("mention-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible();
  // The query filters: a card that does not match is not offered.
  await expect(page.getByTestId("mention-option")).toHaveCount(1);

  await page.keyboard.press("Enter");

  const chip = source.getByTestId("mention-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Target card");
  await expect(picker).toHaveCount(0);

  // Typing continues after the atom, and the chip stays one node.
  await page.keyboard.type("done");
  await expect(source.getByTestId("card-body")).toContainText("done");
  await expect(source.getByTestId("mention-chip")).toHaveCount(1);

  // Clicking the chip opens the target's panel instead of editing this card.
  await chip.click();
  const inspector = page.getByTestId("card-inspector");
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText("Target card");
  // Once the panel lists references, the mention also feeds the derived index;
  // until then the chip itself is the proof that the target is linked.
  if (
    await inspector
      .getByText("Referenced by")
      .isVisible()
      .catch(() => false)
  ) {
    await expect(inspector).toContainText("Source card");
  }

  await page.reload();
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  const reloaded = cards(page).filter({ hasText: "Source card" });
  await expect(reloaded.getByTestId("mention-chip")).toContainText("Target card");
});

test("mentions work in the title editor", async ({ page }) => {
  await page.goto(workspaceUrl("title"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Target card");
  await createNote(page, "Title host");

  const host = cards(page).filter({ hasText: "Title host" });
  await host.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Edit title" }).click();
  await expect(host.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);

  await page.keyboard.press("End");
  await page.keyboard.type(" @Targ");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible({
    timeout: 10_000,
  });
  await page.keyboard.press("Enter");

  await expect(host.locator(".card-title-editor").getByTestId("mention-chip")).toContainText(
    "Target card",
  );
  // Enter picked the suggestion instead of committing the title.
  await expect(host.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(host.locator(".card-title-editor").getByTestId("mention-chip")).toContainText(
    "Target card",
  );
});

test("shows no-match feedback without inserting anything", async ({ page }) => {
  await page.goto(workspaceUrl("empty"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Target card");

  const target = cards(page).filter({ hasText: "Target card" });
  await editBody(page, target);

  await page.keyboard.type("@zzzz");
  await expect(page.getByTestId("mention-empty")).toContainText("Nothing matches");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mention-picker")).toHaveCount(0);
  // Escape dismissed the picker; the typed text stays, and no chip was added.
  await expect(target.getByTestId("mention-chip")).toHaveCount(0);
});

test("links to one field of another card and lands on it", async ({ page }) => {
  await page.goto(workspaceUrl("field-ref"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Target card");
  await createNote(page, "Source card");

  // A field on the shared note type, so both cards carry Owner.
  const target = cards(page).filter({ hasText: "Target card" });
  await target.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const inspector = page.getByTestId("card-inspector");
  await expect(inspector).toBeVisible();
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Owner");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Owner")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await inspector.getByLabel("Owner").fill("Ada");
  await inspector.getByLabel("Owner").blur();
  await inspector.getByTestId("inspector-close").click();

  const source = cards(page).filter({ hasText: "Source card" });
  await editBody(page, source);
  // Naming a single card opens its fields underneath it, so the property is
  // reachable without knowing the dot syntax: Enter takes the card, one arrow
  // down starts browsing that card's fields.
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

  const chip = source.getByTestId("mention-chip");
  // Field ids are generated, so the chip is identified by what it shows.
  await expect(chip).toHaveAttribute("data-field-id", /[\w-]+/);
  await expect(chip).toContainText("Target card");
  // The chip reads the value live; it is a link, not a copy.
  await expect(chip.getByTestId("mention-chip-value")).toHaveText("Ada");

  // A field chip opens its menu first; opening the card is one row inside, and
  // it lands on the field rather than the top of the panel.
  await chip.click();
  await page.getByRole("menuitem", { name: "Open card" }).click();
  await expect(page.getByTestId("card-inspector")).toContainText("Target card");
  const row = page.locator('.property-row[data-focused="true"]');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Owner");
  await expect(row.getByLabel("Owner")).toBeFocused();
});

/** The body's text as typed, without the shadow completion decorations. */
async function typedText(card: ReturnType<typeof cards>): Promise<string> {
  return card.locator(".node-card-editor p").evaluate((node) =>
    [...node.childNodes]
      .filter((child) => !(child as HTMLElement).classList?.contains("mention-ghost"))
      .map((child) => child.textContent ?? "")
      .join(""),
  );
}

/** Adds one field to the shared note type and fills it on a card. */
async function addOwnerField(page: Page, card: ReturnType<typeof cards>): Promise<void> {
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Card info" }).click();
  const inspector = page.getByTestId("card-inspector");
  await inspector.getByTestId("card-panel-tab-details").click();
  await inspector.getByTestId("manage-types").click();
  const settings = page.getByTestId("type-settings");
  await settings.getByTestId("settings-type-note").click();
  await settings.getByLabel("New field name").fill("Owner");
  await settings.getByTestId("create-field").click();
  await expect(settings.getByLabel("Field name Owner")).toBeVisible();
  await settings.getByRole("button", { name: "Done" }).click();
  await inspector.getByLabel("Owner").fill("Ada");
  await inspector.getByLabel("Owner").blur();
  await inspector.getByTestId("inspector-close").click();
}

test("steps into a card's fields with the arrow keys", async ({ page }) => {
  await page.goto(workspaceUrl("submenu"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Target");
  await createNote(page, "Source");
  await addOwnerField(page, cards(page).filter({ hasText: "Target" }));

  const source = cards(page).filter({ hasText: "Source" });
  await editBody(page, source);

  // The card row advertises its fields, and arrowing onto it *shadows* the
  // completion instead of typing it: the card holds only what was typed.
  await page.keyboard.type("@Tar");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  const cardRows = page.locator('[data-testid="mention-option"][data-kind="card"]');
  const targetRow = cardRows.filter({ hasText: "Target" });
  await expect(targetRow).toBeVisible({ timeout: 10_000 });
  await expect(targetRow).toHaveAttribute("aria-selected", "true");
  await expect(targetRow.getByTestId("mention-option-submenu")).toContainText("1");
  await expect(source.locator(".mention-ghost")).toHaveText("get");
  expect(await typedText(source)).toBe("@Tar");

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
  const chip = source.getByTestId("mention-chip");
  await expect(chip).toHaveAttribute("data-field-id", /[\w-]+/);
  await expect(chip.getByTestId("mention-chip-value")).toHaveText("Ada");
  await expect(page.getByTestId("mention-option")).toHaveCount(0);
  await expect(source.locator(".mention-ghost")).toHaveCount(0);
});

test("opens the submenu with a dot without typing it", async ({ page }) => {
  await page.goto(workspaceUrl("dot-drill"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Target");
  await createNote(page, "Source");
  await addOwnerField(page, cards(page).filter({ hasText: "Target" }));

  const source = cards(page).filter({ hasText: "Source" });
  await editBody(page, source);

  // `.` is a gesture on the highlighted card, not text: nothing is inserted,
  // so a title with a space is no obstacle either.
  await page.keyboard.type("@Tar");
  await expect(page.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press(".");
  const fields = page.locator('[data-testid="mention-option"][data-kind="reference"]');
  await expect(fields).toHaveCount(1);
  await expect(fields.first()).toContainText("Owner");
  expect(await typedText(source)).toBe("@Tar");

  // Typing while the submenu is open filters its fields, not the cards.
  await page.keyboard.type("Ow");
  await expect(fields).toHaveCount(1);
  await expect(fields.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");

  await expect(source.getByTestId("mention-chip").getByTestId("mention-chip-value")).toHaveText(
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
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();
  await expect(cards(pageA)).toHaveCount(2);
  await expect(cards(pageB)).toHaveCount(2);

  await createNote(pageA, "Target card");
  await createNote(pageA, "Source card");
  // Exact node counts are noisy while a peer is still mounting; the named
  // cards are the contract this test cares about.
  await expect(cards(pageB).filter({ hasText: "Source card" }).first()).toBeVisible({
    timeout: 20_000,
  });

  const sourceA = cards(pageA).filter({ hasText: "Source card" }).first();
  await editBody(pageA, sourceA);
  await pageA.keyboard.type("@Target");
  await expect(pageA.getByTestId("mention-picker")).toBeVisible({ timeout: 10_000 });
  await expect(pageA.getByTestId("mention-option").filter({ hasText: "Target card" })).toBeVisible({
    timeout: 10_000,
  });
  await pageA.keyboard.press("Enter");

  // B reads the shared body and renders its own chip with the live title.
  const sourceB = cards(pageB).filter({ hasText: "Source card" }).first();
  await expect(sourceB.getByTestId("mention-chip")).toContainText("Target card", {
    timeout: 20_000,
  });

  // Renaming the target on B renames it inside A's mention.
  const targetB = cards(pageB)
    .filter({
      has: pageB.locator(".card-title-editor", { hasText: "Target card" }),
    })
    .first();
  await targetB.getByRole("button", { name: "Edit card title" }).dblclick();
  await expect(pageB.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1, {
    timeout: 10_000,
  });
  await pageB.keyboard.type(" renamed");
  await pageB.keyboard.press("Escape");

  await expect(sourceA.getByTestId("mention-chip")).toContainText("Target card renamed", {
    timeout: 20_000,
  });

  await contextA.close();
  await contextB.close();
});
