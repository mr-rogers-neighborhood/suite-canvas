import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "../fixtures/ownerUrl";
import { cards, createNote, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-style-rules");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

/**
 * Style rules you can write ([ADR-0071](../../docs/decisions/0071-style-is-derived-not-configured.md)
 * amendment).
 *
 * The feature is one promise: the controls in the inspector reach every rung of the ladder, so "every
 * Concept looks like this" is the same gesture as "this card is rounded". These prove it through the UI,
 * including the two ways it could quietly be a lie — creating a rule just by *looking* at a scope, and a
 * promotion that overstates how many cards it changes.
 */

async function openStyleTab(page: Page) {
  const card = cards(page).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("the card is not measurable");
  await page.mouse.click(box.x + 140, box.y + 90);
  await page.getByTestId("card-panel-tab-style").click();
  await expect(page.getByTestId("style-scope-select")).toBeVisible();
}

test("a rule created from the inspector repaints every card of that type", async ({ page }) => {
  await page.goto(workspaceUrl("type-rule"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Third note");
  await expect(cards(page)).toHaveCount(3);

  await openStyleTab(page);

  // Choosing a scope is free: it must not litter the document with a rule that names nothing.
  await page.getByTestId("style-scope-select").selectOption({ label: "every Note" });
  await expect(page.getByTestId("style-scope-note")).toContainText(
    "Choosing a scope on its own changes nothing",
  );
  await expect(page.getByTestId("style-shape-diamond")).toBeVisible();

  await page.getByTestId("style-shape-diamond").click();
  // The scope note flips from "will create" to "editing", which is what tells the reader the rule exists.
  await expect(page.getByTestId("style-scope-note")).toContainText("Editing a rule: Every Note");

  // Every note wears the rule, including the two that were never opened.
  for (let index = 0; index < 3; index += 1) {
    await expect(cards(page).nth(index)).toHaveClass(/is-painted/);
  }

  // And the card's own style is untouched: this edited the rule, not the card.
  await page.getByTestId("style-scope-select").selectOption({ label: "this card" });
  await expect(page.getByTestId("style-reset")).toBeDisabled();
});

test("the Styles list shows the rule, reorders it and deletes it", async ({ page }) => {
  await page.goto(workspaceUrl("list"));
  await expect(cards(page)).toHaveCount(2);
  await openStyleTab(page);

  await page.getByTestId("style-scope-select").selectOption({ label: "every card" });
  await page.getByTestId("style-shape-pill").click();
  await expect(page.getByTestId("style-scope-note")).toContainText("Editing a rule");

  // The door from the picker to the list.
  await page.getByTestId("style-scope-manage").click();
  await expect(page.getByTestId("styles-dialog")).toBeVisible();
  await expect(page.getByTestId("styles-group-kind")).toContainText("Every card");

  await page.getByTestId("styles-add-global").click();
  await expect(page.getByTestId("styles-group-global")).toContainText("Everywhere");

  // Deleting is the list's verb, and the editor follows the list rather than naming what is gone.
  await page.getByTestId("styles-close").click();
  await expect(page.getByTestId("styles-dialog")).toHaveCount(0);
});

test("a promotion names what changes and leaves exceptions alone", async ({ page }) => {
  await page.goto(workspaceUrl("promote"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Second bare note");
  await expect(cards(page)).toHaveCount(3);

  // Give one card an exception of its own.
  const exception = cards(page).nth(1);
  const box = await exception.boundingBox();
  if (!box) throw new Error("the card is not measurable");
  await page.mouse.click(box.x + 100, box.y + 70);
  await page.getByTestId("card-panel-tab-style").click();
  await page.getByTestId("style-shape-circle").click();
  await page.getByTestId("inspector-close").click();
  // The exception's own paint, as the document gave it to the element.
  const exceptionPaint = await cards(page).nth(1).getAttribute("style");

  // Now paint the first card and promote it.
  await openStyleTab(page);
  await page.getByTestId("style-shape-diamond").click();
  await page.getByTestId("style-promote").click();

  // The sentence counts the cards that will actually move, which excludes the exception *and* the card
  // being promoted (it already looks like this).
  await expect(page.getByTestId("dialog")).toContainText("card");
  await expect(page.getByTestId("dialog")).toContainText("keep it");
  // Scoped to the confirm: "Apply to every Note…" is also a button whose name starts with Apply.
  await page.getByTestId("dialog").getByRole("button", { name: "Apply", exact: true }).click();

  // The exception is untouched — a card beats a rule — and a card that had nothing now wears the rule.
  expect(await cards(page).nth(1).getAttribute("style")).toBe(exceptionPaint);
  await expect(cards(page).nth(2)).toHaveClass(/is-painted/);
});
