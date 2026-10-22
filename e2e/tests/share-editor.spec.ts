import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

let sequence = 0;
const workspaceUrl = (name: string) =>
  `/?workspace=e2e-share-editor-${name}-${Date.now()}-${++sequence}`;

const cards = (page: Page) => page.locator('[data-testid="node-card"]');
const cardByTitle = (page: Page, title: string) => cards(page).filter({ hasText: title });

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
    await expect(cardByTitle(page, title)).toHaveCount(1);
    return;
  }
  throw new Error("could not open the canvas menu");
}

async function selectCard(page: Page, card: Locator): Promise<void> {
  const inspector = page.getByTestId("card-inspector");
  // The first projection can land while React Flow is still settling; click
  // through the card's own actionability checks and retry if the hit misses.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await card.click({ position: { x: 80, y: 18 } });
    if (await inspector.isVisible().catch(() => false)) return;
    await page.waitForTimeout(150);
  }
  await expect(inspector).toBeVisible();
}

/** Edits the body in the inspector, which owns focus deterministically. */
async function editBody(page: Page, card: Locator): Promise<void> {
  await selectCard(page, card);
  await page.getByTestId("inspector-edit").click();
  const panelBody = page.locator(".card-inspector .card-panel-body");
  await panelBody.click();
  await expect(panelBody.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
}

async function typeBody(page: Page, card: Locator, text: string): Promise<void> {
  await editBody(page, card);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(card.getByTestId("card-body")).toContainText(text);
  await page.getByTestId("inspector-close").click();
}

/** Creates an editor link for the active scope and returns its URL. */
async function createEditorLink(page: Page, scope: "board" | "card"): Promise<string> {
  await page.getByTestId("workspace-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await page.getByTestId(`share-tab-${scope}`).click();
  await page.getByTestId("share-role-editor").click();
  await expect(page.getByTestId("share-hint")).toContainText("publish");
  await page.getByTestId("share-create").click();
  const url = await page.getByLabel("Share link").inputValue();
  expect(new URL(url).searchParams.get("share")).toBeTruthy();
  await page.getByTestId("share-close").click();
  return url;
}

async function openEditor(browser: Browser, url: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByTestId("sync-status")).toHaveText(/Editor/, { timeout: 15_000 });
  return page;
}

test("board editor moves and edits a card, then publishes", async ({ page, browser }) => {
  await page.goto(workspaceUrl("board-publish"));
  await expect(cards(page)).toHaveCount(2);
  await page.getByTestId("board-create").click();
  await createNote(page, "Shared card");
  const shared = cardByTitle(page, "Shared card");
  await typeBody(page, shared, "Owner baseline");
  const before = await shared.boundingBox();
  if (!before) throw new Error("card not visible");

  const link = await createEditorLink(page, "board");
  const editor = await openEditor(browser, link);
  await expect(editor.locator('[data-testid="node-card"]')).toHaveCount(1, { timeout: 15_000 });

  // The editor may change the card it was given, including its placement.
  const editorCard = editor.locator('[data-testid="node-card"]').first();
  await typeBody(editor, editorCard, " and editor text");
  const box = await editorCard.boundingBox();
  if (!box) throw new Error("editor card not visible");
  await editor.mouse.move(box.x + 60, box.y + 16);
  await editor.mouse.down();
  await editor.mouse.move(box.x + 160, box.y + 76, { steps: 12 });
  await editor.mouse.up();
  await expect
    .poll(async () => (await editorCard.boundingBox())?.x ?? box.x)
    .toBeGreaterThan(box.x + 40);

  await expect(editor.getByTestId("publish-status")).toHaveText("Draft", { timeout: 15_000 });
  await editor.getByTestId("share-publish").click();
  await expect(editor.getByTestId("publish-status")).toHaveText("Published");

  // The owner sees the published body and the new placement in its source room.
  await page.reload();
  await expect(cardByTitle(page, "Shared card").getByTestId("card-body")).toContainText(
    "editor text",
    { timeout: 15_000 },
  );
  await expect
    .poll(async () => (await cardByTitle(page, "Shared card").boundingBox())?.x ?? before.x)
    .toBeGreaterThan(before.x + 40);

  await editor.context().close();
});

test("a conflicting publish is resolved field by field", async ({ page, browser }) => {
  await page.goto(workspaceUrl("board-conflict"));
  await expect(cards(page)).toHaveCount(2);
  await page.getByTestId("board-create").click();
  await createNote(page, "Conflict card");
  await typeBody(page, cardByTitle(page, "Conflict card"), "Owner first");

  const link = await createEditorLink(page, "board");
  const editor = await openEditor(browser, link);
  await expect(editor.locator('[data-testid="node-card"]')).toHaveCount(1, { timeout: 15_000 });
  const editorCard = editor.locator('[data-testid="node-card"]').first();

  // The draft must be dirty before the workspace changes: a clean draft is
  // simply re-projected from the owner's save. So the editor writes first, and
  // the owner's later change is the one a publish must not overwrite.
  await typeBody(editor, editorCard, "Editor draft");
  // The worker marks the draft dirty from the streamed edit; the badge polls.
  await expect(editor.getByTestId("publish-status")).toHaveText("Draft", { timeout: 15_000 });
  await typeBody(page, cardByTitle(page, "Conflict card"), "Owner second");
  // The publish reads the owner's live room, so let that edit reach the server.
  await page.waitForTimeout(3000);

  const conflict = editor.getByTestId("publish-conflict");

  // Default: every checkbox is unchecked, so the workspace version wins.
  await editor.getByTestId("share-publish").click();
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await expect(conflict.getByTestId("publish-conflict-keys")).toContainText(
    "changed in the workspace",
  );
  const keep = conflict.getByTestId("publish-keep").first();
  await expect(keep).not.toBeChecked();

  await conflict.getByTestId("publish-selected").click();
  await expect(conflict).toHaveCount(0, { timeout: 15_000 });
  await expect(editor.getByTestId("publish-status")).toHaveText("Published", {
    timeout: 15_000,
  });

  // The owner's value survived, and the editor was rebuilt from it.
  await expect(editorCard.getByTestId("card-body")).toContainText("Owner second", {
    timeout: 15_000,
  });
  await expect(editorCard.getByTestId("card-body")).not.toContainText("Editor draft");
  await expect(cardByTitle(page, "Conflict card").getByTestId("card-body")).toContainText(
    "Owner second",
  );

  // Checked: the editor's version wins for that field.
  await typeBody(editor, editorCard, "Editor wins");
  await expect(editor.getByTestId("publish-status")).toHaveText("Draft", { timeout: 15_000 });
  await typeBody(page, cardByTitle(page, "Conflict card"), "Owner third");
  await page.waitForTimeout(3000);

  await editor.getByTestId("share-publish").click();
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await conflict.getByTestId("publish-keep").first().check();
  await conflict.getByTestId("publish-selected").click();
  await expect(conflict).toHaveCount(0, { timeout: 15_000 });
  await expect(editor.getByTestId("publish-status")).toHaveText("Published", {
    timeout: 15_000,
  });

  const ownerBody = cardByTitle(page, "Conflict card").getByTestId("card-body");
  await expect(ownerBody).toContainText("Editor wins", { timeout: 15_000 });
  await expect(ownerBody).not.toContainText("Owner third");

  await editor.context().close();
});

test("card editor publishes one card and leaves the other alone", async ({ page, browser }) => {
  await page.goto(workspaceUrl("card"));
  await expect(cards(page)).toHaveCount(2);
  await page.getByTestId("board-create").click();
  await createNote(page, "First card");
  await createNote(page, "Second card");
  await typeBody(page, cardByTitle(page, "First card"), "First body");
  await typeBody(page, cardByTitle(page, "Second card"), "Second body");

  await selectCard(page, cardByTitle(page, "First card"));
  const link = await createEditorLink(page, "card");

  const editor = await openEditor(browser, link);
  // The card link opens the inspector on its card and shows only that card.
  const inspector = editor.getByTestId("card-inspector");
  await expect(inspector).toBeVisible({ timeout: 15_000 });
  await expect(editor.locator('[data-testid="node-card"]')).toHaveCount(1);
  await expect(editor.getByText("Second card")).toHaveCount(0);

  const panelBody = inspector.locator(".card-panel-body");
  await inspector.getByTestId("inspector-edit").click();
  await panelBody.click();
  await expect(panelBody.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
  await editor.keyboard.type(" edited by card editor");
  await editor.keyboard.press("Escape");
  await expect(inspector).toContainText("First body edited by card editor");

  await editor.getByTestId("share-publish").click();
  await expect(editor.getByTestId("publish-status")).toHaveText("Published");

  await page.reload();
  await expect(cardByTitle(page, "First card").getByTestId("card-body")).toContainText(
    "edited by card editor",
    { timeout: 15_000 },
  );
  await expect(cardByTitle(page, "Second card").getByTestId("card-body")).toContainText(
    "Second body",
  );
  await expect(cardByTitle(page, "Second card").getByTestId("card-body")).not.toContainText(
    "edited by card editor",
  );

  await editor.context().close();
});

test("board editor has no create, manage or library chrome and Delete unplaces", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("capabilities"));
  await expect(cards(page)).toHaveCount(2);
  await page.getByTestId("board-create").click();
  await createNote(page, "Unplaced by editor");

  const link = await createEditorLink(page, "board");
  const editor = await openEditor(browser, link);
  const editorCard = editor.locator('[data-testid="node-card"]').first();
  await expect(editorCard).toBeVisible({ timeout: 15_000 });

  // Owner chrome stays hidden for an editor share.
  await expect(editor.getByTestId("workspace-actions")).toHaveCount(0);
  await expect(editor.getByTestId("dock-library")).toHaveCount(0);
  await expect(editor.getByTestId("library-drawer")).toHaveCount(0);
  await expect(editor.getByTestId("board-create")).toHaveCount(0);
  await expect(editor.getByTestId("share-publish")).toBeVisible();

  // A canvas right-click offers no creation menu.
  const point = await emptyCanvasPoint(editor);
  await editor.mouse.click(point.x, point.y, { button: "right" });
  await expect(editor.getByRole("menuitem", { name: "New note" })).toHaveCount(0);
  await expect(editor.getByRole("menuitem", { name: "New section" })).toHaveCount(0);
  await editor.keyboard.press("Escape");

  // Content is editable but schema and trash are not.
  await editorCard.getByTestId("card-menu").click();
  await expect(editor.getByRole("menuitem", { name: "Edit body" })).toBeVisible();
  await expect(editor.getByRole("menuitem", { name: "Delete card" })).toHaveCount(0);
  await expect(editor.getByRole("menuitem", { name: "Add connector" })).toHaveCount(0);
  await editor.keyboard.press("Escape");
  await expect(editor.getByTestId("context-menu")).toHaveCount(0);
  await selectCard(editor, editorCard);
  await expect(editor.getByTestId("manage-types")).toHaveCount(0);
  await editor.getByTestId("inspector-close").click();

  // Delete removes the card from the board without trashing it.
  await selectCard(editor, editorCard);
  await editor.keyboard.press("Delete");
  await expect(editor.locator('[data-testid="node-card"]')).toHaveCount(0);

  await editor.getByTestId("share-publish").click();
  await expect(editor.getByTestId("publish-status")).toHaveText("Published");

  // The card survives in the owner's inbox, so it was unplaced, not trashed.
  await page.reload();
  await expect(page.getByTestId("node-card")).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId("dock-library").click();
  const drawer = page.getByTestId("library-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByTestId("library-tab-inbox").click();
  await expect(drawer).toContainText("Unplaced by editor");

  await editor.context().close();
});

test("workspace editor token edits the workspace without owner chrome", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("workspace-token"));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("workspace-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  await page.getByTestId("share-role-editor").click();
  await page.getByTestId("share-create").click();
  const link = await page.getByLabel("Share link").inputValue();
  expect(new URL(link).searchParams.get("share")).toBeTruthy();
  expect(new URL(link).hash).toBe("");
  await page.getByTestId("share-close").click();

  const context = await browser.newContext();
  try {
    const editor = await context.newPage();
    await editor.goto(link);
    await expect(cards(editor)).toHaveCount(2, { timeout: 15_000 });
    await expect(editor.getByTestId("sync-status")).toHaveText(/Editor/, { timeout: 15_000 });
    await expect(editor.getByTestId("workspace-share")).toHaveCount(0);
    await expect(editor.getByTestId("workspace-file")).toHaveCount(0);

    await typeBody(editor, cards(editor).first(), "Workspace editor note");
    await expect(page.getByTestId("card-body").first()).toContainText("Workspace editor note", {
      timeout: 15_000,
    });
  } finally {
    await context.close();
  }
});
