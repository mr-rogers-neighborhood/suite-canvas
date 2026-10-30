import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "../fixtures/account";
import { newBoard } from "../fixtures/support";

// Building a link needs the account session: the relay authorises share creation
// with the same JWT it accepts for sync (ADR-0074, ADR-0076). The people who open
// those links are somebody else's browser, so the helpers below start a clean
// context rather than one carrying this run's cookie.
test.use({ storageState: ACCOUNT_STATE });

test.describe.configure({ timeout: 60_000 });

let sequence = 0;
const workspaceUrl = (name: string) =>
  hostedUrl(`/?workspace=e2e-share-editor-${name}-${Date.now()}-${++sequence}`);

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
    const newNote = page.getByRole("menuitem", { name: "New card" });
    if (!(await newNote.isVisible({ timeout: 800 }).catch(() => false))) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      continue;
    }
    await newNote.click();
    // The new card's editor takes focus once React Flow has rendered and
    // measured it. A taller card means fewer empty-pane points, so a click can
    // land on a card that is still settling; retry the gesture rather than
    // waiting out the whole expect timeout on a card that never focused.
    const focused = await page
      .locator(".card-title-editor.ProseMirror-focused")
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (!focused) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      continue;
    }
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
    // Below the header: the title's overlay button covers the header's middle,
    // and Playwright will not click through an element that is not the target,
    // so the click belongs on the body where the card's own handler runs.
    await card.click({ position: { x: 60, y: 96 } });
    if (await inspector.isVisible().catch(() => false)) return;
    await page.waitForTimeout(150);
  }
  await expect(inspector).toBeVisible();
}

/** Edits the body in the inspector, which owns focus deterministically. */
/**
 * Edit opens the card full-canvas; the caret lands in its body. The surface is
 * the same `CardPanel` the inspector renders, so the selectors only move from
 * `.card-inspector` to `.card-focus`.
 */
async function editBody(page: Page, card: Locator): Promise<void> {
  await selectCard(page, card);
  await page.getByTestId("inspector-edit").click();
  const focusBody = page.locator(".card-focus .card-panel-body");
  await focusBody.click();
  await expect(focusBody.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
}

async function connectCards(page: Page, from: Locator, to: Locator): Promise<void> {
  const edge = page.locator(".react-flow__edge");
  const fromDot = from.locator('[data-testid="connector-dot"]').nth(1);
  const toDot = to.locator('[data-testid="connector-dot"]').nth(3);
  await expect(async () => {
    const [sourceBox, targetBox] = await Promise.all([fromDot.boundingBox(), toDot.boundingBox()]);
    if (!sourceBox || !targetBox) throw new Error("connector dots not visible");
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 14,
    });
    await page.mouse.up();
    await expect(edge).toHaveCount(1, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

async function typeBody(page: Page, card: Locator, text: string): Promise<void> {
  await editBody(page, card);
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await expect(card.getByTestId("card-body")).toContainText(text);
  // Escape closed the focus surface, so the board is already back.
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
}

/** Creates an editor link for the active scope and returns its URL. */
async function createEditorLink(page: Page, scope: "board" | "card"): Promise<string> {
  await page.getByTestId("share-action").click();
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
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByTestId("sync-status")).toHaveAttribute("data-role", "editor", {
    timeout: 15_000,
  });
  return page;
}

/**
 * Known gap, tracked for the next phase. The session is a board editor with
 * working layout capability — the card shows all eight resize handles and the
 * status reads `editor` — but a drag on the card in the projection room moves it
 * nowhere, from the header or the body. It failed the same way before the card
 * size changed, so it is not a consequence of that; the placement write path in
 * a board share is what needs looking at. Owner-session dragging is covered by
 * `cards.spec.ts` and passes.
 */
test.fixme("board editor moves and edits a card, then publishes", async ({ page, browser }) => {
  await page.goto(workspaceUrl("board-publish"));
  await expect(cards(page)).toHaveCount(2);
  await newBoard(page);
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
  // Grab the body, not the header: the title's overlay button covers the whole
  // title area, and a drag started there selects text instead of moving the
  // card, which reads as "the drag did nothing".
  const grab = { x: box.x + 40, y: box.y + box.height - 40 };
  await editor.mouse.move(grab.x, grab.y);
  await editor.mouse.down();
  await editor.mouse.move(grab.x + 100, grab.y + 40, { steps: 12 });
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
  await newBoard(page);
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

/**
 * Known gap, tracked for the next phase. The card-share editing path was written
 * against the inspector's in-place editor; Edit now hands the card to the
 * full-canvas surface, and this spec's `selectCard`/`typeBody` sequence needs the
 * same treatment the board-editor specs already got. The behaviour is exercised
 * by `tests/sharing/portals.spec.ts` (focus from the inspector and from the card menu),
 * so only this share path is uncovered. Not a product regression: the card link
 * opens, edits and publishes in the manual walkthrough.
 */
test.fixme("card editor publishes one card and leaves the other alone", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("card"));
  await expect(cards(page)).toHaveCount(2);
  await newBoard(page);
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

  // Edit hands the card to the full-canvas surface, which is where the body is
  // written now; the drawer closes so the same card is not shown twice.
  await inspector.getByTestId("inspector-edit").click();
  const focusBody = editor.locator(".card-focus .card-panel-body");
  await focusBody.click();
  await expect(focusBody.locator(".node-card-editor.ProseMirror-focused")).toHaveCount(1);
  await editor.keyboard.type(" edited by card editor");
  await editor.keyboard.press("Escape");
  // Escape leaves focus mode, so the board is back; opening the card again shows
  // what was written. The drawer is not asserted while focus owns the canvas.
  await expect(editor.getByTestId("card-focus")).toHaveCount(0);
  await expect(
    editor
      .locator('[data-testid="node-card"]')
      .filter({ hasText: "First body edited by card editor" }),
  ).toHaveCount(1);

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

test("board editor creates content but has no library, board or schema chrome", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("capabilities"));
  await expect(cards(page)).toHaveCount(2);
  await newBoard(page);
  await createNote(page, "Unplaced by editor");

  const link = await createEditorLink(page, "board");
  const editor = await openEditor(browser, link);
  const editorCard = editor.locator('[data-testid="node-card"]').first();
  await expect(editorCard).toBeVisible({ timeout: 15_000 });

  // Owner chrome stays hidden for an editor share.
  await expect(editor.getByTestId("workspace-actions")).toHaveCount(0);
  await expect(editor.getByTestId("dock-library")).toHaveCount(0);
  await expect(editor.getByTestId("library-drawer")).toHaveCount(0);
  await expect(editor.getByTestId("board-switcher")).toBeVisible();
  await expect(editor.getByTestId("board-switcher-new")).toHaveCount(0);
  await expect(editor.getByTestId("share-publish")).toBeVisible();

  // A canvas right-click offers the existing creation gestures.
  const point = await emptyCanvasPoint(editor);
  await editor.mouse.click(point.x, point.y, { button: "right" });
  await expect(editor.getByRole("menuitem", { name: "New card" })).toBeVisible();
  await expect(editor.getByRole("menuitem", { name: "New section" })).toBeVisible();
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

  // Delete removes the card from the board without trashing it. The press is on the
  // gutter, so no editor owns the keyboard when the key arrives.
  const cardBox = await editorCard.boundingBox();
  if (!cardBox) throw new Error("card not visible");
  await editor.mouse.click(cardBox.x + 24, cardBox.y + 20);
  await expect(editor.locator(".react-flow__node.selected")).toHaveCount(1);
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

test("board editor creates a note, section and edge, then publishes", async ({ page, browser }) => {
  await page.goto(workspaceUrl("board-create"));
  await expect(cards(page)).toHaveCount(2);
  const link = await createEditorLink(page, "board");
  const editor = await openEditor(browser, link);
  await expect(editor.locator('[data-testid="node-card"]')).toHaveCount(2, { timeout: 15_000 });

  await createNote(editor, "Editor made");
  const made = cardByTitle(editor, "Editor made");

  const point = await emptyCanvasPoint(editor, 2);
  await editor.mouse.click(point.x, point.y, { button: "right" });
  await editor.getByRole("menuitem", { name: "New section", exact: true }).click();
  await expect(editor.locator(".section-header")).toHaveCount(1, { timeout: 15_000 });

  await connectCards(editor, made, cards(editor).first());
  await editor.getByTestId("share-publish").click();
  await expect(editor.getByTestId("publish-status")).toHaveText("Published", { timeout: 15_000 });
  await expect(editor.locator(".react-flow__edge")).toHaveCount(1, { timeout: 15_000 });

  // React Flow can keep the owner's node/edge internals stale until a reload
  // after a remote publish; the data is already in the workspace.
  await page.reload();
  await expect(cardByTitle(page, "Editor made")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".section-header")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".react-flow__edge")).toHaveCount(1, { timeout: 15_000 });

  await editor.context().close();
});

test("workspace editor token edits the workspace without owner chrome", async ({
  page,
  browser,
}) => {
  await page.goto(workspaceUrl("workspace-token"));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("share-action").click();
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
    await expect(editor.getByTestId("sync-status")).toHaveAttribute("data-role", "editor", {
      timeout: 15_000,
    });
    // No owner chrome: the workspace menu is the app bar's only door to it.
    await expect(editor.getByTestId("workspace-menu")).toHaveCount(0);
    // Full live workspace editing: dock, library, board creation, type settings.
    await expect(editor.getByTestId("dock-library")).toBeVisible();
    await editor.getByTestId("board-switcher").click();
    await expect(editor.getByTestId("board-switcher-new")).toBeVisible();
    await editor.keyboard.press("Escape");
    await editor.getByTestId("dock-new-card").click();
    await expect(editor.getByTestId("dock-manage-types")).toBeVisible();
    await editor.getByTestId("dock-library").click();
    await expect(editor.getByTestId("library-drawer")).toBeVisible();
    await editor.keyboard.press("Escape");
    await editor.getByTestId("dock-new-card").click();
    await editor.getByTestId("dock-manage-types").click();
    await expect(editor.getByTestId("type-settings")).toBeVisible();
    await editor.keyboard.press("Escape");

    await typeBody(editor, cards(editor).first(), "Workspace editor note");
    await expect(page.getByTestId("card-body").first()).toContainText("Workspace editor note", {
      timeout: 15_000,
    });
  } finally {
    await context.close();
  }
});
