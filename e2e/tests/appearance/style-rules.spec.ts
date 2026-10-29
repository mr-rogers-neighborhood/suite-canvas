import { expect, type Locator, type Page, test } from "@playwright/test";
import { cards, createNote, selectCard, workspaceIdFactory } from "../fixtures/support";

const id = workspaceIdFactory("e2e-style-rules");
const workspaceUrl = (name: string) => `/?workspace=${id(name)}`;

/**
 * The type default, and what it does and does not reach.
 *
 * One control, `style-make-default`, writes a card's style onto its type. That is the
 * promise a reader hears as "every Note looks like this", and there are two ways it could
 * quietly be a lie: a new card that ignores it, and an existing card that loses a choice
 * its owner made. Both are checked here, through the panel a reader uses.
 */

/** One paint custom property as the browser resolved it on a card. */
async function clipOf(card: Locator): Promise<string> {
  return card.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--paint-clip").trim(),
  );
}

async function openStyleTab(page: Page): Promise<void> {
  await page.getByTestId("card-panel-tab-style").click();
  await expect(page.getByTestId("style-tab")).toBeVisible();
}

test("a card makes its style the type default, and a later card wears it", async ({ page }) => {
  await page.goto(workspaceUrl("inherits"));
  await expect(cards(page)).toHaveCount(2);

  await selectCard(page);
  await openStyleTab(page);
  await page.getByTestId("style-shape-diamond").click();
  await expect.poll(() => clipOf(cards(page).first())).toContain("polygon");

  const makeDefault = page.getByTestId("style-make-default");
  await expect(makeDefault).toContainText("Make this the default for Note cards");
  await makeDefault.click();
  // The label flips once the type states it, which is the only confirmation there is.
  await expect(makeDefault).toContainText("Replace the default for Note cards");

  // A card with no style of its own reads its type, so the card nobody opened changes too.
  // That is the promise a reader hears, and it would be easy to ship a button that only
  // reached cards made after it.
  await expect(cards(page).nth(1)).toHaveClass(/is-painted/);
  await expect.poll(() => clipOf(cards(page).nth(1))).toContain("polygon");

  await createNote(page, "Made later");
  const later = cards(page).filter({ hasText: "Made later" });
  await expect.poll(() => clipOf(later)).toContain("polygon");
});

test("writing a default leaves a card's own exception alone", async ({ page }) => {
  await page.goto(workspaceUrl("exception"));
  await expect(cards(page)).toHaveCount(2);

  const exception = cards(page).nth(1);
  await selectCard(page, exception);
  await openStyleTab(page);
  await page.getByTestId("style-shape-circle").click();
  const circled = await clipOf(exception);
  expect(circled).not.toContain("polygon");

  await selectCard(page);
  await openStyleTab(page);
  await page.getByTestId("style-shape-diamond").click();
  await page.getByTestId("style-make-default").click();

  // A card beats a type, so the exception still wears what its owner chose.
  expect(await clipOf(cards(page).nth(1))).toBe(circled);
});

test("reset drops a card's own style, and the type default shows through", async ({ page }) => {
  await page.goto(workspaceUrl("reset"));
  await expect(cards(page)).toHaveCount(2);

  // The plain card first, so the second half of the test never has to click a card that
  // is already drawn as a diamond: a clipped silhouette leaves the header's corner
  // outside the shape, and a click meant for the card lands on the pane instead.
  const plain = cards(page).nth(1);
  await selectCard(page, plain);
  await openStyleTab(page);
  // Nothing of its own yet, so there is nothing to reset.
  await expect(page.getByTestId("style-reset")).toBeDisabled();
  await page.getByTestId("style-shape-circle").click();
  await expect(page.getByTestId("style-reset")).toBeEnabled();
  await page.getByTestId("style-reset").click();
  await expect(page.getByTestId("style-reset")).toBeDisabled();
  await expect.poll(() => clipOf(plain)).not.toContain("polygon");

  // Now the type states a diamond. The card that just dropped its own style has nothing
  // left to say, so it reads the type and changes with it.
  await selectCard(page);
  await openStyleTab(page);
  await page.getByTestId("style-shape-diamond").click();
  await page.getByTestId("style-make-default").click();
  await expect.poll(() => clipOf(plain)).toContain("polygon");
});
