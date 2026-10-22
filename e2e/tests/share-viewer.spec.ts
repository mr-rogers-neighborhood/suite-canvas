import { type Browser, expect, type Page, test } from "@playwright/test";

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-share-viewer-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const boardTabs = (page: Page) => page.locator('[role="tab"][data-testid^="board-tab"]');

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
    const newNote = page.getByRole("menuitem", { name: "New note" });
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

/** Starts body editing from the card menu, which does not open the inspector. */
async function editBody(page: Page, card: ReturnType<typeof cards>): Promise<void> {
  await card.getByTestId("card-menu").click();
  await page.getByRole("menuitem", { name: "Edit body" }).click();
  await expect(card.getByTestId("card-body").locator(".ProseMirror-focused")).toHaveCount(1);
}

/** Creates a viewer link for the active scope and returns its URL. */
async function createViewerLink(
  page: Page,
  scope: "workspace" | "board" | "card",
): Promise<string> {
  await page.getByTestId("workspace-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await page.getByTestId(`share-tab-${scope}`).click();
  await page.getByTestId("share-role-viewer").click();
  await page.getByTestId("share-create").click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(new URL(url).searchParams.get("share")).toBeTruthy();
  return url;
}

async function openViewer(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test("board viewer sees one board, read-only, with no editor chrome", async ({ page, browser }) => {
  await page.goto(workspaceUrl("board"));
  await expect(cards(page)).toHaveCount(2);
  // A card on the first board: it must not appear in the shared projection.
  await createNote(page, "Off board note");

  await page.getByTestId("board-create").click();
  await expect(boardTabs(page)).toHaveCount(2);
  await createNote(page, "Shared card");
  const shared = cards(page).filter({ hasText: "Shared card" });
  await editBody(page, shared);
  await page.keyboard.type("Visible to viewers");
  await page.keyboard.press("Escape");
  await expect(shared.getByTestId("card-body")).toContainText("Visible to viewers");

  const link = await createViewerLink(page, "board");
  await page.getByTestId("share-close").click();

  const viewer = await openViewer(browser, link);
  await expect(viewer.getByTestId("sync-status")).toHaveText(/Viewer/, { timeout: 15_000 });
  // Projections are built asynchronously; the card arrives when the room does.
  const visible = viewer.locator('[data-testid="node-card"]');
  await expect(visible).toHaveCount(1, { timeout: 15_000 });
  await expect(visible).toContainText("Shared card");
  await expect(visible).toContainText("Visible to viewers");
  await expect(viewer.getByText("Off board note")).toHaveCount(0);

  // No owner chrome: no share actions, no dock, no library, no board switching.
  await expect(viewer.getByTestId("workspace-actions")).toHaveCount(0);
  await expect(viewer.getByTestId("workspace-share")).toHaveCount(0);
  await expect(viewer.getByTestId("dock-library")).toHaveCount(0);
  await expect(viewer.getByTestId("library-drawer")).toHaveCount(0);
  await expect(viewer.locator('[data-testid^="board-tab-"]')).toHaveCount(0);
  await expect(viewer.getByTestId("board-create")).toHaveCount(0);
  await expect(viewer.getByTestId("card-menu")).toHaveCount(0);
  await expect(viewer.getByText("Board share")).toBeVisible();

  // The body stays read-only: a double click does not open an editor and
  // typing cannot change the text.
  const body = visible.getByTestId("card-body");
  await body.dblclick();
  await expect(body.locator(".node-card-editor")).toHaveAttribute("contenteditable", "false");
  await body.click();
  await viewer.keyboard.type("hacked");
  await expect(body).toContainText("Visible to viewers");
  await expect(body).not.toContainText("hacked");

  await viewer.context().close();
});

test("card viewer opens its inspector and keeps out-of-share links inert", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("card"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "Off board note");

  await page.getByTestId("board-create").click();
  await expect(boardTabs(page)).toHaveCount(2);
  await createNote(page, "Shared card");
  const shared = cards(page).filter({ hasText: "Shared card" });
  await editBody(page, shared);
  await page.keyboard.type("@Off");
  await expect(page.getByTestId("mention-picker")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type(" is linked");
  await page.keyboard.press("Escape");
  await expect(shared.getByTestId("mention-chip")).toContainText("Off board note");

  // The inspector supplies the card the dialog shares.
  const box = await shared.boundingBox();
  if (!box) throw new Error("card not visible");
  await page.mouse.click(box.x + 80, box.y + 24);
  await expect(page.getByTestId("card-inspector")).toBeVisible();

  const link = await createViewerLink(page, "card");
  await page.getByTestId("share-close").click();

  const viewer = await openViewer(browser, link);
  await expect(viewer.getByTestId("sync-status")).toHaveText(/Viewer/, { timeout: 15_000 });
  const inspector = viewer.getByTestId("card-inspector");
  await expect(inspector).toBeVisible({ timeout: 15_000 });
  await expect(inspector).toContainText("Shared card");
  await expect(viewer.locator('[data-testid="node-card"]')).toHaveCount(1);
  await expect(viewer.getByText("Card share")).toBeVisible();

  // A card with a body opens on Details; Content is where the body lives.
  await viewer.getByTestId("card-panel-tab-content").click();
  await expect(inspector.getByTestId("card-panel-body")).toContainText("is linked");
  await expect(inspector.getByTestId("inspector-edit")).toHaveCount(0);
  await inspector.getByTestId("card-panel-body").click();
  await expect(inspector.locator(".node-card-editor")).toHaveAttribute("contenteditable", "false");
  await viewer.keyboard.type("hacked");
  await expect(inspector.getByTestId("card-panel-body")).toContainText("is linked");
  await expect(inspector.getByTestId("card-panel-body")).not.toContainText("hacked");

  // The mention points outside the projection: the row reads but never navigates.
  await viewer.getByTestId("card-panel-tab-details").click();
  const inert = inspector.getByTestId("link-row-inert").first();
  await expect(inert).toBeVisible();
  await expect(inert).toContainText("Off board note");
  await expect(inert).toHaveAttribute("aria-disabled", "true");
  await inert.click();
  await expect(inspector).toContainText("Shared card");
  await expect(viewer.locator('[data-testid="node-card"]')).toHaveCount(1);

  await viewer.context().close();
});

test("workspace viewer reads every board and cannot manage", async ({ page, browser }) => {
  await page.goto(workspaceUrl("workspace"));
  await expect(cards(page)).toHaveCount(2);
  await createNote(page, "First board note");

  // A second board: the viewer must reach it through the tabs.
  await page.getByTestId("board-create").click();
  await expect(boardTabs(page)).toHaveCount(2);
  await createNote(page, "Second board note");
  await expect(cards(page)).toHaveCount(1);

  const link = await createViewerLink(page, "workspace");
  await page.getByTestId("share-close").click();

  const viewer = await openViewer(browser, link);
  await expect(viewer.getByTestId("sync-status")).toHaveText(/Viewer/, { timeout: 15_000 });

  // The viewer joins the real workspace room: every board is reachable.
  await expect(boardTabs(viewer)).toHaveCount(2);
  await expect(cards(viewer)).toHaveCount(3, { timeout: 15_000 });
  await expect(viewer.getByText("First board note")).toBeVisible();
  await expect(viewer.getByText("Second board note")).toHaveCount(0);

  await boardTabs(viewer).nth(1).click();
  await expect(cards(viewer)).toHaveCount(1, { timeout: 15_000 });
  await expect(viewer.getByText("Second board note")).toBeVisible();

  // Presence works for a viewer: the owner is another peer in the room.
  await expect(viewer.getByTestId("sync-status")).toContainText("here", { timeout: 15_000 });

  // No management or editing chrome.
  await expect(viewer.getByTestId("workspace-actions")).toHaveCount(0);
  await expect(viewer.getByTestId("workspace-share")).toHaveCount(0);
  await expect(viewer.getByTestId("board-create")).toHaveCount(0);
  await expect(viewer.getByTestId("card-menu")).toHaveCount(0);
  await expect(viewer.getByTestId("dock-library")).toHaveCount(0);

  // Board tabs cannot be renamed or deleted, and the body stays read-only.
  await boardTabs(viewer).nth(0).dblclick();
  await expect(viewer.getByLabel(/Rename /)).toHaveCount(0);
  const body = cards(viewer).first().getByTestId("card-body");
  await body.dblclick();
  await expect(body.locator(".node-card-editor")).toHaveAttribute("contenteditable", "false");
  await body.click();
  await viewer.keyboard.type("hacked");
  await expect(body).not.toContainText("hacked");

  // No management dialog is reachable from the viewer, and the API agrees.
  await expect(viewer.getByTestId("share-dialog")).toHaveCount(0);

  await viewer.context().close();

  // The owner editor path still works from the same dialog.
  await page.getByTestId("workspace-share").click();
  await page.getByTestId("share-role-editor").click();
  await page.getByTestId("share-create").click();
  const editorLink = new URL(await page.getByLabel("Share link").inputValue());
  expect(editorLink.searchParams.get("workspace")).toBeTruthy();
  expect(editorLink.searchParams.has("share")).toBe(false);
  expect(editorLink.hash).toContain("owner=");
});

test("revoking a link makes the viewer unavailable", async ({ page, browser }) => {
  await page.goto(workspaceUrl("revoke"));
  await expect(cards(page)).toHaveCount(2);

  const link = await createViewerLink(page, "board");
  const viewer = await openViewer(browser, link);
  await expect(viewer.locator('[data-testid="node-card"]').first()).toBeVisible({
    timeout: 15_000,
  });

  await page.getByTestId("share-close").click();
  await page.getByTestId("workspace-share").click();
  await page.locator('[data-testid^="share-revoke-"]').first().click();
  await expect(page.getByTestId("share-empty")).toBeVisible();

  await viewer.reload();
  const unavailable = viewer.getByTestId("share-unavailable");
  await expect(unavailable).toBeVisible({ timeout: 15_000 });
  await expect(unavailable).toContainText("This link is no longer available.");
  await expect(viewer.getByTestId("canvas-board")).toHaveCount(0);

  await viewer.context().close();
});
