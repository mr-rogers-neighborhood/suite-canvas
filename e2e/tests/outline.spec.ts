import { expect, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

/**
 * The outline rail is still in the shell, but nothing in the product can create
 * the thing it lists any more: a Section was the drawable, resizable region the
 * React Flow canvas owned (`Control+g`, `.section-region`, its header and its
 * south-east handle), and that layer is gone. The Board replaced it, and ICE
 * draws Boards as mats it owns, so a Section can no longer be made from the UI.
 *
 * The rail still has one rule worth pinning: it appears only when the active
 * plane holds a Section. The nested ordering, drag-into-parent and peer-dot
 * tests needed the section layer as their fixture and went with it.
 */
test("hides the rail on a board without sections", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=e2e-outline-empty-${Date.now()}`));
  await expect(page.getByTestId("ice-surface")).toBeVisible();

  await expect(page.getByTestId("outline-rail")).toHaveCount(0);
  await expect(page.getByTestId("outline-panel")).toHaveCount(0);
  await expect(page.getByTestId("outline-row")).toHaveCount(0);
});
