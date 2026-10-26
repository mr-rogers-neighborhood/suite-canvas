import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "../fixtures/ownerUrl";

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-outline-${name}-${Date.now()}-${++sequence}`);

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const rows = (page: Page) => page.getByTestId("outline-row");
const rowFor = (page: Page, title: string) => rows(page).filter({ hasText: title });
const regionFor = (page: Page, title: string) =>
  page.locator(`.section-region[aria-label="Section: ${title}"]`);
const headerFor = (page: Page, title: string) =>
  page.locator(".section-header").filter({ hasText: title });

/** Creates a section around one card with the canvas shortcut and titles it. */
async function createSection(
  page: Page,
  cardIndex: number,
  title: string,
  total: number,
): Promise<void> {
  const card = cards(page).nth(cardIndex);
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 40, box.y + 60);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(total);
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(headerFor(page, title)).toContainText(title);
}

test("hides the rail on a board without sections", async ({ page }) => {
  await page.goto(workspaceUrl("empty"));
  await expect(cards(page)).toHaveCount(2);

  await expect(page.getByTestId("outline-rail")).toHaveCount(0);
  await expect(page.getByTestId("outline-panel")).toHaveCount(0);
  await expect(page.getByTestId("outline-row")).toHaveCount(0);
});

test("lists nested sections in reading order with member counts", async ({ page }) => {
  await page.goto(workspaceUrl("nested"));
  await expect(cards(page)).toHaveCount(2);

  await createSection(page, 0, "Outer", 1);
  await createSection(page, 1, "Inner", 2);
  await expect(rows(page)).toHaveCount(2);
  await expect(rowFor(page, "Outer")).toHaveAttribute("data-depth", "0");
  await expect(rowFor(page, "Inner")).toHaveAttribute("data-depth", "0");

  // Grow the outer region, then drop the inner one inside it.
  const outerRegion = regionFor(page, "Outer");
  // Fit first: a section is at least a card plus padding, and the bottom-right
  // corner is where the selection click used to land. Off-screen there means no
  // selection, no handle, and a silent zero.
  await page.locator(".react-flow__controls-fitview").click();
  await page.waitForTimeout(400);
  const before = await outerRegion.boundingBox();
  if (!before) throw new Error("outer section not visible");
  // The padding band on the left edge is region, not card.
  await page.mouse.click(before.x + 6, before.y + before.height / 2);

  const handle = await page.getByTestId("section-handle-se").boundingBox();
  if (!handle) throw new Error("resize handle not visible");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 280, handle.y + handle.height / 2 + 200, {
    steps: 12,
  });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const after = await outerRegion.boundingBox();
      return after ? Math.round(after.width - before.width) : 0;
    })
    .toBeGreaterThan(200);

  const grown = await outerRegion.boundingBox();
  const inner = await regionFor(page, "Inner").boundingBox();
  const innerHeader = await headerFor(page, "Inner").boundingBox();
  if (!grown || !inner || !innerHeader) throw new Error("sections not visible");

  const deltaX = grown.x + grown.width - inner.width - 24 - inner.x;
  const deltaY = grown.y + grown.height - inner.height - 24 - inner.y;
  await page.mouse.move(innerHeader.x + 20, innerHeader.y + 12);
  await page.mouse.down();
  await page.mouse.move(innerHeader.x + 20 + deltaX, innerHeader.y + 12 + deltaY, { steps: 16 });
  await page.mouse.up();

  await expect(rowFor(page, "Inner")).toHaveAttribute("data-depth", "1");
  await expect(rows(page).first()).toContainText("Outer");
  await expect(rowFor(page, "Outer").getByTestId("outline-row-count")).toHaveText("1");
  await expect(rowFor(page, "Inner").getByTestId("outline-row-count")).toHaveText("1");
  await expect(page.getByTestId("outline-count")).toHaveText("2");
});

test("focuses the section and marks its row when the row is clicked", async ({ page }) => {
  await page.goto(workspaceUrl("focus"));
  await expect(cards(page)).toHaveCount(2);

  await createSection(page, 1, "Focus me", 1);
  // Creating the section selects it; clear that so the row click is the only
  // thing that can mark it active.
  await page.keyboard.press("Escape");

  const viewport = page.locator('[data-testid="canvas-board"] .react-flow__viewport');
  const before = await viewport.getAttribute("style");

  const row = rowFor(page, "Focus me");
  await expect(row).not.toHaveAttribute("aria-current", "true");
  await row.click();

  await expect(row).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => viewport.getAttribute("style")).not.toBe(before);
});

test("collapses and expands the rail with the [ key", async ({ page }) => {
  await page.goto(workspaceUrl("toggle"));
  await expect(cards(page)).toHaveCount(2);

  await createSection(page, 1, "Toggle", 1);
  await expect(page.getByTestId("outline-panel")).toBeVisible();

  await page.keyboard.press("BracketLeft");
  await expect(page.getByTestId("outline-panel")).toHaveCount(0);
  await expect(page.getByTestId("outline-tab")).toBeVisible();
  await expect(page.getByTestId("outline-tab")).toContainText("1");

  await page.keyboard.press("BracketLeft");
  await expect(page.getByTestId("outline-panel")).toBeVisible();
  await expect(page.getByTestId("outline-tab")).toHaveCount(0);
});

test("shows a peer dot when a collaborator selects a section", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = workspaceUrl("peer");

  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.getByTestId("canvas-board")).toBeVisible();
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();

  await createSection(pageA, 0, "Shared", 1);
  const sharedRegion = regionFor(pageB, "Shared");
  await expect(sharedRegion).toBeVisible();
  await expect(rowFor(pageB, "Shared")).toBeVisible();

  // Select on the canvas, clear of the rail and of the card inside the section.
  const box = await sharedRegion.boundingBox();
  if (!box) throw new Error("section not visible for the peer");
  await pageB.mouse.click(box.x + box.width - 12, box.y + box.height - 12);

  const peerDot = rowFor(pageA, "Shared").getByTestId("outline-peer-dot");
  await expect(peerDot).toHaveCount(1);
  await expect(peerDot).toBeVisible();
  await expect(peerDot).toHaveAttribute("data-peer-name", /.+/);

  await contextA.close();
  await contextB.close();
});
