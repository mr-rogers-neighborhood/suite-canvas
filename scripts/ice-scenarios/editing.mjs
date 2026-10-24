/**
 * Editing on the desk (ADR-0042): the sheet is for reading, one DOM editor is
 * for writing.
 *
 * The gesture under test is the one the flow surface had and the ICE port lost:
 * double-click a note and type in it. What makes it a document write and not a
 * DOM trick is the reload at the end — what survives a reload is what reached
 * Loro, and the assertion after it re-opens the same card and reads the words
 * out of the editor that is bound to the document.
 *
 * Two facts this scenario has to respect, both of them the product's:
 *
 * - the editor is only offered on a card big enough to read
 *   (`SUITE_CARD_EDITOR_MIN_SCREEN_WIDTH`, 320 CSS px), and the example opens at
 *   fit, where a 288-unit card is ~150 px. The scenario therefore walks in with
 *   the canvas's own zoom control until the widest card passes the gate, exactly
 *   as a reader would;
 * - the runner has no "double-click a card, type" step, so the pointer and the
 *   keyboard are driven through the `page` handle its expectations receive. Each
 *   such step is guarded, so a retry cannot type the marker twice.
 */
const MIN_SCREEN_WIDTH = 320;
const MARK = "Edited on the desk";

/** Every card's screen width under the current camera. */
const widthOf = (slot, camera, entered) => (boxOf(slot, entered).width ?? 0) * camera.zoom;

/** The card's box in the units the camera currently speaks. */
function boxOf(slot, entered) {
  return entered.length > 0 ? (slot.local ?? slot.world) : (slot.world ?? slot.local);
}

/**
 * The card to write in, and the point to aim at: the widest card the desk
 * itself says is a card under that point.
 *
 * The `pick` in the snapshot is the engine's own hit test, so a candidate whose
 * centre belongs to a Board's mat is skipped rather than entered — the double
 * click has to land on the card, not on the frame it sits on.
 */
async function aimCard(state, surface, page, wanted) {
  const { camera } = state;
  if (camera === null || surface === null) return undefined;
  const candidates = [...state.slots].sort(
    (a, b) => widthOf(b, camera, state.entered) - widthOf(a, camera, state.entered),
  );
  for (const slot of candidates) {
    if (wanted !== undefined && slot.cardId !== wanted) continue;
    const box = boxOf(slot, state.entered);
    if (box === undefined) continue;
    if ((box.width ?? 0) * camera.zoom < MIN_SCREEN_WIDTH) continue;
    const screen = {
      x: (box.x + box.width / 2 - camera.x) * camera.zoom,
      y: (box.y + box.height / 2 - camera.y) * camera.zoom,
    };
    if (screen.x < 40 || screen.y < 40 || screen.x > 1400 || screen.y > 860) continue;
    // The probe is a function on the page, so the hit test runs there: the
    // snapshot cannot carry it across, and the engine's own answer is the point.
    const picked = await page.evaluate(
      (point) => window.__suiteIce?.probe?.pick(point.x, point.y) ?? null,
      screen,
    );
    if (picked === null || picked === undefined) continue;
    if (picked.cardId !== slot.cardId) continue;
    return {
      cardId: slot.cardId,
      client: { x: surface.x + screen.x, y: surface.y + screen.y },
      zoom: camera.zoom,
    };
  }
  return undefined;
}

async function editorOf(page) {
  const editor = page.getByTestId("ice-card-editor");
  return (await editor.count()) === 1 ? editor : null;
}

/**
 * The shell's inspector covers the right edge, and a single pick on the desk
 * opens it (that is the reading surface's contract). A card under it cannot be
 * double-clicked, so the scenario closes the panel the way a reader would before
 * aiming at a card behind it.
 */
async function closeInspector(page) {
  const closer = page.getByRole("button", { name: "Close card info" });
  if ((await closer.count()) > 0) {
    await closer.click();
    await page.waitForTimeout(350);
  }
}

/** The words in the card's body editor — the live rich text the reader sees. */
async function bodyTextOf(page) {
  const body = page.locator('[data-testid="ice-card-editor"] .node-card-editor');
  return (await body.count()) === 1 ? (await body.innerText()).trim() : "";
}

/** Double-click the aimed point, the way a reader opens the card. */
async function doubleClickAt(page, point) {
  await page.mouse.dblclick(point.x, point.y);
  await page.waitForTimeout(400);
}

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },

    // The gate is real: at fit the cards are sheets, not places to type. Walk in
    // until the widest card is readable, with the same control a reader uses.
    {
      label: "zoom-in",
      expect: async (state, { page, memory }) => {
        const surface = await page.locator(".ice-surface").boundingBox();
        const aim = await aimCard(state, surface, page);
        if (aim !== undefined) {
          memory.aim = aim;
          return true;
        }
        memory.zooms = (memory.zooms ?? 0) + 1;
        if (memory.zooms > 10) throw new Error("no card became readable after ten zoom steps");
        await page.getByTestId("canvas-zoom-in").click();
        await page.waitForTimeout(400);
        return false;
      },
      why: "a card is big enough for the editor's 320 px gate",
      timeout: 20000,
    },

    {
      label: "open",
      expect: async (_state, { page, memory }) => {
        const editor = await editorOf(page);
        if (editor !== null && (await editor.getAttribute("data-card-id")) === memory.cardId) {
          return true;
        }
        if (memory.aim === undefined) return false;
        memory.cardId = memory.aim.cardId;
        await doubleClickAt(page, memory.aim.client);
        return true;
      },
      why: "the double click landed on a card",
    },
    {
      label: "editor-open",
      expect: async (_state, { page, memory }) => {
        const editor = await editorOf(page);
        if (editor === null) return false;
        const cardId = await editor.getAttribute("data-card-id");
        if (cardId !== memory.cardId) return false;
        const editables = await page
          .locator("[data-testid='ice-card-editor'] [contenteditable='true']")
          .count();
        return editables === 1;
      },
      why: "exactly one editor, on the card that was opened",
      screenshot: "editor",
      timeout: 10000,
    },
    {
      label: "type",
      expect: async (_state, { page, memory }) => {
        if (memory.typed === true) return true;
        await page.keyboard.type(MARK);
        await page.waitForTimeout(300);
        memory.typed = true;
        return true;
      },
      why: "the keyboard reached the card's editor",
    },
    {
      label: "typed",
      expect: async (_state, { page }) => (await bodyTextOf(page)).includes(MARK),
      why: "the words are in the card's live body",
      screenshot: "typed",
    },
    {
      label: "close",
      expect: async (_state, { page, memory }) => {
        if (memory.closed === true) return (await editorOf(page)) === null;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        const closed = (await editorOf(page)) === null;
        if (closed) memory.closed = true;
        return closed;
      },
      why: "Escape closed the editor",
      screenshot: "closed",
      timeout: 5000,
    },

    { reload: true, screenshot: "reloaded" },
    {
      label: "after-reload",
      expect: (state, { memory }) => state.slots.some((slot) => slot.cardId === memory.cardId),
      why: "the card is still on the View after the reload",
      timeout: 10000,
    },
    {
      label: "reopen",
      expect: async (state, { page, memory }) => {
        const editor = await editorOf(page);
        if (editor !== null) return true;
        const surface = await page.locator(".ice-surface").boundingBox();
        // The same card, not merely a readable one: the assertion is about the
        // words this run typed, so aiming elsewhere would prove nothing.
        await closeInspector(page);
        const aim = await aimCard(state, surface, page, memory.cardId);
        if (aim === undefined) return false;
        await doubleClickAt(page, aim.client);
        return true;
      },
      why: "the same card can be opened again after the reload",
    },
    {
      label: "persisted",
      expect: async (_state, { page }) => (await bodyTextOf(page)).includes(MARK),
      why: "the text came back from the document, not from the page",
      screenshot: "persisted",
      timeout: 10000,
    },
  ],
};
