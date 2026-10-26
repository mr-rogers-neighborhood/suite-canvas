import { expect, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cards, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-appearance");

/**
 * The appearance entry point ([ADR-0071](../../docs/decisions/0071-style-is-derived-not-configured.md)).
 *
 * The author's note was that the theme switcher is the obvious door to the style system.
 * What has to be true end to end: it opens from that switcher, a change reaches the
 * canvas immediately (no apply button, no preview pane), and it survives a reload —
 * because a preference that forgets itself is a setting nobody will use.
 */
test("the theme switcher opens Appearance, and a change sticks", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=${id("appearance")}`));
  await expect(cards(page)).toHaveCount(2);

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-density", /comfortable|compact/);

  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("theme-appearance").click();
  await expect(page.getByTestId("appearance-dialog")).toBeVisible();

  // The sentence that keeps the boundary honest.
  await expect(page.getByTestId("appearance-dialog")).toContainText(
    "These change this device only",
  );

  await page.getByTestId("appearance-density").selectOption("compact");
  await page.getByTestId("appearance-canvas").selectOption("plain");
  await page.getByTestId("appearance-radius").fill("4");

  // Applied to the root, which is what makes the canvas behind the dialog the preview.
  await expect(root).toHaveAttribute("data-density", "compact");
  await expect(root).toHaveAttribute("data-canvas", "plain");
  await expect(page.locator("html")).toHaveCSS("--reader-card-radius", "4px");

  // A card actually wears it: the radius default reaches the card face.
  const card = page.locator('[data-testid="node-card"]').first();
  await expect(card).toHaveCSS("border-radius", "4px");

  // And so does the chrome inside it. A fixed corner on the header is what left a
  // notch inside the card's own curve once the radius could pass 6px, so the one
  // silhouette is published to the card's children rather than restated by them.
  await page.getByTestId("appearance-radius").fill("28");
  await expect(card).toHaveCSS("border-radius", "28px");
  const header = card.locator(".card-header");
  await expect(header).toHaveCSS("border-top-left-radius", "27px");
  await expect(header).toHaveCSS("border-top-right-radius", "27px");
  // Published, not restated: anything else that has to hug the corner reads this.
  await expect(card).toHaveCSS("--card-radius", "28px");

  await page.getByTestId("appearance-close").click();
  await expect(page.getByTestId("appearance-dialog")).toHaveCount(0);

  // Persisted per device: a reload keeps what the reader chose.
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-canvas", "plain");
});
