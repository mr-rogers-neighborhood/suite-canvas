import { expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-section-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');

async function createSectionAroundFirstCard(page: Page, title: string): Promise<void> {
  const card = cards(page).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 40, box.y + 60);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  await page.keyboard.press("Control+g");
  await expect(page.locator(".section-header")).toHaveCount(1);
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(page.locator(".section-header")).toContainText(title);
}

test("creates a section from a card and persists its title", async ({ page }) => {
  await page.goto(workspaceUrl("create"));
  await expect(cards(page)).toHaveCount(2);

  await createSectionAroundFirstCard(page, "Research");

  const region = page.locator(".section-region").first();
  await expect(region).toBeVisible();
  await expect(page.locator(".section-header")).toContainText("1");

  // The member card sees the section in its inspector.
  await cards(page).first().getByTestId("card-body").click();
  await page.getByTestId("card-panel-tab-details").click();
  await expect(page.getByTestId("inspector-section")).toContainText("Research");
  await page.getByTestId("inspector-close").click();

  await page.locator(".section-title").dblclick();
  await page.getByTestId("section-title-input").fill("Renamed region");
  await page.getByTestId("section-title-input").press("Enter");
  await expect(page.locator(".section-header")).toContainText("Renamed region");

  await page.reload();
  await expect(page.locator(".section-header")).toContainText("Renamed region");
});

test("deletes a section without deleting its cards", async ({ page }) => {
  await page.goto(workspaceUrl("delete"));
  await expect(cards(page)).toHaveCount(2);

  await createSectionAroundFirstCard(page, "Temporary");
  await page.keyboard.press("Delete");

  await expect(page.locator(".section-region")).toHaveCount(0);
  await expect(cards(page)).toHaveCount(2);
});

test("resizes a section", async ({ page }) => {
  await page.goto(workspaceUrl("resize"));
  await expect(cards(page)).toHaveCount(2);

  await createSectionAroundFirstCard(page, "Resizable");
  const before = await page.locator(".section-region").first().boundingBox();
  const handle = await page.getByTestId("section-handle-se").boundingBox();
  if (!before || !handle) throw new Error("section handle not visible");

  await page.mouse.move(handle.x + 4, handle.y + 4);
  await page.mouse.down();
  await page.mouse.move(handle.x + 84, handle.y + 44, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const after = await page.locator(".section-region").first().boundingBox();
      return after ? Math.round(after.width - before.width) : 0;
    })
    .toBeGreaterThan(60);
});

test("drags a section with its cards and syncs to a peer", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = workspaceUrl("drag-peer");

  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageA.locator(".section-header")).toHaveCount(0);
  await expect(pageB.getByTestId("canvas-board")).toBeVisible();

  await createSectionAroundFirstCard(pageA, "Shared region");
  await expect(pageB.locator(".section-header")).toContainText("Shared region");

  const sectionBeforeB = await pageB.locator(".section-region").first().boundingBox();
  const cardA = cards(pageA).first();
  const cardB = cards(pageB).first();
  const beforeA = await cardA.boundingBox();
  const beforeB = await cardB.boundingBox();
  const header = await pageA.locator(".section-header").boundingBox();
  if (!beforeA || !beforeB || !header) throw new Error("section or card not visible");

  await pageA.mouse.move(header.x + 24, header.y + 12);
  await pageA.mouse.down();
  await pageA.mouse.move(header.x + 124, header.y + 72, { steps: 12 });

  // Before release, the peer sees the section move and its drag label.
  if (!sectionBeforeB) throw new Error("peer section not visible");
  await expect(pageB.getByTestId("peer-name-tag")).toBeVisible();
  await expect
    .poll(async () => {
      const after = await pageB.locator(".section-region").first().boundingBox();
      return after ? Math.round(after.x - sectionBeforeB.x) : 0;
    })
    .toBeGreaterThan(20);

  await pageA.mouse.up();

  await expect
    .poll(async () => {
      const after = await cardA.boundingBox();
      return after ? Math.round(after.x - beforeA.x) : 0;
    })
    .toBeGreaterThan(60);

  await expect
    .poll(async () => {
      const after = await cardB.boundingBox();
      return after ? Math.round(after.x - beforeB.x) : 0;
    })
    .toBeGreaterThan(40);

  await expect(pageB.locator(".section-header")).toContainText("Shared region");
});

test("collapses and expands card frontmatter from the header", async ({ page }) => {
  await page.goto(workspaceUrl("frontmatter"));
  await expect(cards(page)).toHaveCount(2);

  const card = cards(page).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 40, box.y + 60);
  await page.getByTestId("card-panel-tab-details").click();
  await page.getByTestId("tag-input").fill("Research");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("tag-chip")).toContainText("Research");

  await page.getByTestId("inspector-close").click();
  await expect(card.getByTestId("card-meta")).toHaveCount(0);
  await expect(card.getByTestId("card-meta-toggle")).toContainText("1");

  await card.getByTestId("card-meta-toggle").click();
  await expect(card.getByTestId("card-meta")).toContainText("#Research");

  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Hide details" }).click();
  await expect(card.getByTestId("card-meta")).toHaveCount(0);
});
