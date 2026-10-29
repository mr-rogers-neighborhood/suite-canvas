import { expect, type Locator, type Page, test } from "@playwright/test";
import { settleViewport } from "../fixtures/marquee";
import { boardId, cards, newBoard, openBoard } from "../fixtures/support";

/**
 * A board's cover is an image that stands in for the live miniature inside every
 * portal pointing at it. `coverAttachmentId` and the setter existed with nothing
 * to reach them; this is the reachable path — pick one, see it, clear it, and get
 * the miniature back.
 */

let sequence = 0;
const workspaceUrl = (name: string) => `/?workspace=e2e-cover-${name}-${Date.now()}-${++sequence}`;

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAoElEQVR42g3K0QAEMQxF0SAMQhAGIQhFeAhFCEIRgjAIQViEmNzt+T5mZrg9hDmyl7SgbNEmxjZm/uDuhL/Ig/RFuWjfjOcN4Xi8RASKRYao2HQkE+cGvbiC0EISqU0paR1GdUMGnotIodxkJpWHzmLyu6EWXiJqo0qyDlVF18dU39DCexOdqA/ZRfVHdzP9u2E2PknMQVPkfNQ0PT9mhj/jRpPBG+li2wAAAABJRU5ErkJggg==";

/** Pasts an 8x8 PNG into a card body, so the workspace has one image attachment. */
async function pastePng(page: Page, card: Locator): Promise<void> {
  // One click: the body is where a reader writes, so pressing it starts the
  // editor rather than selecting the card first.
  await card.getByTestId("card-body").click();
  await expect(page.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
  await page.waitForTimeout(250);
  await page.evaluate((base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    const target =
      document.querySelector(".node-card-editor.ProseMirror-focused") ??
      document.querySelector(".node-card-editor");
    if (target === null) throw new Error("the card body editor is not mounted");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  }, PNG_BASE64);
  await expect(card.locator("img.attachment-image")).toHaveCount(1, { timeout: 15_000 });
  await page.keyboard.press("Escape");
}

async function roomyPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("canvas-board").boundingBox();
  if (!box) throw new Error("canvas board not found");
  const point = await page.evaluate(
    ({ width, height, offsetX, offsetY }) => {
      for (let fy = 0.1; fy < 0.8; fy += 0.02) {
        for (let fx = 0.04; fx < 0.92; fx += 0.02) {
          const x = Math.round(width * fx);
          const y = Math.round(height * fy);
          if (x + 340 > width - 4 || y + 310 > height - 4) continue;
          const samples = [
            [x + 3, y + 3],
            [x + 337, y + 3],
            [x + 3, y + 307],
            [x + 337, y + 307],
          ];
          if (
            samples.every(([sx, sy]) => {
              const element = document.elementFromPoint(offsetX + sx, offsetY + sy);
              return Boolean(element?.closest(".react-flow__pane"));
            })
          ) {
            return { x: offsetX + x, y: offsetY + y };
          }
        }
      }
      return null;
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y },
  );
  if (!point) throw new Error("no room on the pane");
  return point;
}

/** Board 2 with a portal to it, on Board 1. */
async function boardWithPortal(page: Page): Promise<void> {
  const firstBoard = boardId(page);
  await newBoard(page);
  await openBoard(page, firstBoard);
  for (let step = 0; step < 3; step += 1)
    await page.getByRole("button", { name: "Zoom Out" }).click();
  await settleViewport(page);
  const point = await roomyPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "New portal" }).click();
  await page.getByTestId("context-submenu").getByRole("menuitem", { name: "Board 2" }).click();
  await expect(page.getByTestId("portal-node")).toHaveCount(1);
}

test("a board takes a cover, its portal paints it, and clearing restores the picture", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(workspaceUrl("pick"));
  await expect(cards(page)).toHaveCount(2);

  // One image attachment exists once a card body holds one.
  await pastePng(page, cards(page).first());
  await boardWithPortal(page);

  // The portal paints the live miniature until a cover is chosen.
  await page.getByTestId("portal-node").click();
  const picker = page.getByTestId("board-cover-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("portal-miniature")).toHaveCount(1);

  await page.getByTestId("board-cover-options").getByRole("button").first().click();
  // The miniature is replaced by the image …
  await expect(page.getByTestId("portal-miniature")).toHaveCount(0);
  await expect(page.locator('[data-testid="portal-node"] img.portal-cover')).toHaveCount(1);

  // … and the choice belongs to the board, so it survives a reload.
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('[data-testid="portal-node"] img.portal-cover')).toHaveCount(1);

  // Clearing goes back to the live picture.
  await page.getByTestId("portal-node").click();
  await page.getByTestId("board-cover-clear").click();
  await expect(page.getByTestId("portal-miniature")).toHaveCount(1);
  await expect(page.locator("img.portal-cover")).toHaveCount(0);
});
