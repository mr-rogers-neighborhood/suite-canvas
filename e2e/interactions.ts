import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared canvas interactions.
 *
 * These exist because "the menu is open" is not "the menu can be clicked": the
 * card menu is portalled and painted over a React Flow pane, and under load the
 * first click occasionally lands while the portal is still settling. The
 * symptom was not a failed assertion but a bare "Test timeout of 60000ms
 * exceeded" with the menu open in the snapshot, which tells whoever reads the
 * report nothing at all.
 *
 * So every step here is bounded and named: a step that cannot proceed fails in
 * seconds and says which step. The retry is the one `mentions.spec.ts` already
 * used, which is why that spec never showed the flake.
 */
export async function startBodyEdit(page: Page, card: Locator): Promise<void> {
  const body = card.getByTestId("card-body").locator(".ProseMirror-focused");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await card
      .getByTestId("card-menu")
      .click({ timeout: 5_000 })
      .catch(() => undefined);
    const item = page.getByRole("menuitem", { name: "Edit body" });
    if (await item.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await item.click({ timeout: 5_000 }).catch(() => undefined);
    }
    if (await body.count()) return;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  await expect(
    body,
    "the card body never took focus: the card menu did not hand over to the editor",
  ).toHaveCount(1);
}
