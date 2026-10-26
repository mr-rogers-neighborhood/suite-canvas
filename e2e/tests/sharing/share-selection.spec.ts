import { type Browser, expect, type Page, test } from "@playwright/test";
import { startBodyEdit } from "../../interactions";

// Every journey here opens a second browser context and waits on a live
// projection room, so they contend for the same worker and collab server.
test.describe.configure({ mode: "serial" });

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-share-selection-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const selectedNodes = (page: Page) => page.locator(".react-flow__node.selected");

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function cardBoxes(page: Page): Promise<Box[]> {
  return cards(page).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
}

/** A point on the pane that no card or panel covers. */
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
      return candidates[(variant * 17) % candidates.length];
    },
    { width: box.width, height: box.height, offsetX: box.x, offsetY: box.y, variant },
  );

  if (!point) throw new Error("no empty canvas point found");
  return point;
}

/** Creates a note from the canvas menu and commits its title. */
async function createNote(page: Page, title: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const point = await emptyCanvasPoint(page, attempt);
    await page.mouse.click(point.x, point.y, { button: "right" });
    const newNote = page.getByRole("menuitem", { name: "New card" });
    if (!(await newNote.isVisible({ timeout: 800 }).catch(() => false))) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      continue;
    }
    await newNote.click();
    await expect(page.locator(".card-title-editor.ProseMirror-focused")).toHaveCount(1);
    await page.waitForTimeout(250);
    await page.keyboard.type(title);
    await expect(page.locator(".card-title-editor.ProseMirror-focused")).toContainText(title);
    await page.keyboard.press("Escape");
    await expect(cards(page).filter({ hasText: title })).toHaveCount(1);
    return;
  }
  throw new Error("could not open the canvas menu");
}

async function boxFor(page: Page, cardId: string): Promise<Box> {
  const box = await page
    .locator(`[data-testid="node-card"][data-node-id="${cardId}"]`)
    .boundingBox();
  if (!box) throw new Error(`card ${cardId} is not visible`);
  return box;
}

/**
 * Shift-clicks the given cards so exactly those are selected, inspector closed.
 * React Flow mirrors the selection into the store asynchronously, so each click
 * waits for its own count before the next one lands.
 */
async function shiftSelect(page: Page, cardIds: readonly string[]): Promise<void> {
  await page.keyboard.press("Escape");
  let expected = 0;
  for (const cardId of cardIds) {
    const card = page.locator(`[data-testid="node-card"][data-node-id="${cardId}"]`);
    await card.click({ position: { x: 40, y: 60 }, modifiers: ["Shift"] });
    expected += 1;
    await expect(selectedNodes(page)).toHaveCount(expected);
  }
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);
}

async function cardIdsByTitle(page: Page, titles: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) {
    const card = cards(page).filter({ hasText: title }).first();
    const id = await card.getAttribute("data-node-id");
    if (!id) throw new Error(`no card id for ${title}`);
    ids.push(id);
  }
  return ids;
}

/** Opens Share from the app bar and creates a viewer link on the given tab. */
async function createSelectionLinkFor(
  page: Page,
  scope: "selection" | "card" = "selection",
): Promise<string> {
  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-menu-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await page.getByTestId(`share-tab-${scope}`).click();
  await expect(page.getByTestId("share-role-viewer")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("share-create").click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(new URL(url).searchParams.get("share")).toBeTruthy();
  return url;
}

/**
 * Fits the viewport to the board. React Flow only mounts nodes inside the
 * viewport, so a projection can hold every card while the DOM shows fewer;
 * counting nodes without fitting makes the assertion depend on scroll position.
 */
async function fitView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fit View" }).first().click();
  await page.waitForTimeout(400);
}

/**
 * Waits until exactly `count` cards are mounted. The projection arrives
 * asynchronously, and a fit performed before it lands frames an empty board, so
 * the view is re-fitted until the expected cards are all in the viewport.
 */
async function expectCardsInView(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await fitView(page);
        return page.locator('[data-testid="node-card"]').count();
      },
      { timeout: 20_000, intervals: [500, 1_000, 1_500] },
    )
    .toBe(count);
}

async function openViewer(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test("the selection tab needs at least two cards", async ({ page }) => {
  await page.goto(workspaceUrl("needs-two"));
  await expect(cards(page)).toHaveCount(2);
  const [first] = await cardBoxes(page);
  if (!first) throw new Error("cards not visible");

  // One card selected: a subset of one is what the Card scope already does.
  await page.keyboard.down("Shift");
  await page.mouse.click(first.x + 40, first.y + 60);
  await page.keyboard.up("Shift");
  await expect(selectedNodes(page)).toHaveCount(1);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-menu-share").click();
  const selectionTab = page.getByTestId("share-tab-selection");
  await expect(selectionTab).toBeDisabled();
  await expect(selectionTab).toHaveAttribute("title", /Select two or more cards/);
  await page.getByTestId("share-close").click();

  // Two cards: the tab becomes available and preselects the viewer role.
  const boxes = await cardBoxes(page);
  const [, second] = boxes;
  if (!second) throw new Error("second card not visible");
  await page.keyboard.down("Shift");
  await page.mouse.click(second.x + 40, second.y + 60);
  await page.keyboard.up("Shift");
  await expect(selectedNodes(page)).toHaveCount(2);

  await page.getByTestId("workspace-menu").click();
  await page.getByTestId("workspace-menu-share").click();
  await expect(page.getByTestId("share-tab-selection")).toBeEnabled();
  await page.getByTestId("share-tab-selection").click();
  await expect(page.getByTestId("share-tab-selection")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("share-role-editor")).toBeDisabled();
});

test("a selection link projects exactly the shared cards and stays a snapshot", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("subset"));
  await expect(cards(page)).toHaveCount(2);

  // Two more cards, of which only these two will be shared. The two seeded
  // cards stay on the board and must not appear in the link.
  await createNote(page, "Shared A");
  await createNote(page, "Shared B");
  await expect(cards(page)).toHaveCount(4);

  const shared = await cardIdsByTitle(page, ["Shared A", "Shared B"]);
  await shiftSelect(page, shared);

  // The multi-select menu is the second entry point; it opens the dialog on
  // the selection scope.
  const anchor = await boxFor(page, shared[0] ?? "");
  await page.mouse.click(anchor.x + 40, anchor.y + 14, { button: "right" });
  await expect(page.getByRole("menuitem", { name: "Share 2 cards…" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Share 2 cards…" }).click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await expect(page.getByTestId("share-tab-selection")).toHaveAttribute("aria-pressed", "true");
  // The dialog must still hold both cards when the link is created.
  await expect(page.getByTestId("share-dialog")).toContainText("these 2 cards");

  await page.getByTestId("share-create").click();
  const link = await page.getByLabel("Share link").inputValue();
  expect(new URL(link).searchParams.get("share")).toBeTruthy();
  await page.getByTestId("share-close").click();

  const viewer = await openViewer(browser, link);
  await expect(viewer.getByTestId("sync-status")).toHaveAttribute("data-role", "viewer", {
    timeout: 15_000,
  });
  await expectCardsInView(viewer, 2);
  const visible = viewer.locator('[data-testid="node-card"]');
  await expect(visible.filter({ hasText: "Shared A" })).toHaveCount(1);
  await expect(visible.filter({ hasText: "Shared B" })).toHaveCount(1);
  await expect(viewer.getByText("Selection share")).toBeVisible();
  await expect(viewer.getByTestId("workspace-actions")).toHaveCount(0);
  await expect(viewer.getByTestId("workspace-menu")).toHaveCount(0);

  // Live: an owner edit reaches the viewer.
  const sharedA = cards(page).filter({ hasText: "Shared A" });
  await startBodyEdit(page, sharedA);
  await page.keyboard.type("Edited by the owner");
  await page.keyboard.press("Escape");
  await expect(
    viewer.locator('[data-testid="node-card"]').filter({ hasText: "Shared A" }),
  ).toContainText("Edited by the owner", { timeout: 15_000 });

  // Fixed snapshot: a card created after the link was made does not join it.
  await createNote(page, "Late C");
  await expect(cards(page)).toHaveCount(5);
  await page.waitForTimeout(1200);
  await expect(viewer.locator('[data-testid="node-card"]')).toHaveCount(2);
  await expect(viewer.getByText("Late C")).toHaveCount(0);

  await viewer.context().close();
});

test("a reference outside a projection reads as not shared, not unavailable", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("boundary"));
  await expect(cards(page)).toHaveCount(2);

  // A card that will stay outside the shared projection, and the card we share.
  await createNote(page, "Target card");
  await createNote(page, "Subject card");

  const subject = cards(page).filter({ hasText: "Subject card" });
  await startBodyEdit(page, subject);
  await page.keyboard.type("@Target");
  await expect(page.getByTestId("mention-picker")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(subject.getByTestId("mention-chip")).toContainText("Target card");

  // Sharing the card alone puts Target outside the projection.
  const box = await subject.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.getByTestId("card-inspector")).toBeVisible();
  const link = await createSelectionLinkFor(page, "card");
  await page.getByTestId("share-close").click();

  const viewer = await openViewer(browser, link);
  await expect(viewer.getByTestId("sync-status")).toHaveAttribute("data-role", "viewer", {
    timeout: 15_000,
  });
  await expectCardsInView(viewer, 1);
  const visible = viewer.locator('[data-testid="node-card"]');
  await expect(visible.filter({ hasText: "Subject card" })).toHaveCount(1);

  // The mention survives but is inert and labelled, not "Unavailable card".
  // A card share keeps the real title, so the label — not the absence of the
  // name — is what proves the boundary.
  const chip = visible.getByTestId("mention-chip");
  await expect(chip).toHaveAttribute("data-not-shared", "true");
  await expect(chip).toContainText("not shared");
  await expect(viewer.getByText("Unavailable card")).toHaveCount(0);

  // The chip is plain markup, not a button: clicking it never navigates to the
  // unshared card. The click may still bubble to the card itself.
  await expect(chip).not.toHaveAttribute("role", "button");
  await chip.click();
  await expect(viewer.locator('[data-testid="node-card"]')).toHaveCount(1);
  await expect(viewer.getByText("Untitled")).toHaveCount(0);

  await viewer.context().close();
});
