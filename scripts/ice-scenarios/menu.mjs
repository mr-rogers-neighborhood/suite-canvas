/**
 * The menu scenario: every row a reader can see has to keep its promise.
 *
 * The parity matrix had three rows whose "ICE today" said the menu offered
 * something nothing consumed — a rename with no reader, a "Select N cards" that
 * always read zero, and a Delete that trashed where the flow surface unplaced.
 * This scenario walks the ones a browser can prove:
 *
 * 1. **Rename a Board** from its menu. The name is asserted in the surface's own
 *    snapshot (which reads the document), then the page is reloaded — the desk
 *    is rebuilt from Loro, so a name that survives is a `renameBoard` write and
 *    not a paint.
 * 2. **Select N cards** on that Board. The row has to (a) name the real count
 *    and (b) leave that many cards selected in the shell (`state.selection` is
 *    the store's `selectedNodeIds`), which is the half that used to be zero.
 * 3. **Escape twice** clear the selection. The ladder is "cancel gesture → leave
 *    Board → clear selection", and on the plane there is nothing above the last
 *    rung.
 *
 * The menu is shell DOM, so its rows are found by role — the canvas itself is
 * GPU-drawn and has no DOM to query.
 */
const BOARD = "Start here";
/** A card on the View's own plane, so a reveal is a flight and not an entry. */
const LOOSE_CARD = "demo-card-atlas-canvas";
const RENAMED = "Renamed by the lab";
const TO_CLIENT = (box, camera, point) => ({
  x: box.x + (point.x - camera.x) * camera.zoom,
  y: box.y + (point.y - camera.y) * camera.zoom,
});

/** A press on the Board's own top strip: clear of cards and of corner handles. */
const stripOf = (board) => ({ x: board.world.x + board.world.width * 0.25, y: board.world.y + 4 });

async function openBoardMenu(page, state, board) {
  const box = await page.locator(".ice-surface").boundingBox();
  const point = TO_CLIENT(box, state.camera, stripOf(board));
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.getByTestId("context-menu").waitFor({ timeout: 5000 });
  return point;
}

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    {
      expect: (state) => state.boards.some((board) => board.name === BOARD),
      why: "the example draws the Board this scenario renames",
    },

    // 1. Rename from the menu, then prove it reached the document.
    {
      expect: async (state, { page, memory }) => {
        if (memory.menuOpened === true) return true;
        const board = state.boards.find((entry) => entry.name === BOARD);
        if (board === undefined) return false;
        memory.boardId = board.id;
        memory.at = await openBoardMenu(page, state, board);
        memory.menuOpened = true;
        return true;
      },
      why: "a right-click on a Board opens its menu",
      screenshot: "board-menu",
    },
    {
      expect: async (_state, { page, memory }) => {
        if (memory.fieldOpen === true) return true;
        // The row says "board", not "section": a mat is the document's Board.
        const row = page.getByRole("menuitem", { name: "Rename board" });
        if ((await row.count()) === 0) return false;
        await row.click();
        await page.getByTestId("board-rename-input").waitFor({ timeout: 2000 });
        memory.fieldOpen = true;
        return true;
      },
      why: "the rename row opens the Board's name field",
      // The field is where the name already is: over the mat's pill.
      screenshot: "renaming",
    },
    {
      expect: async (_state, { page, memory }) => {
        if (memory.renamed === true) return true;
        const field = page.getByTestId("board-rename-input");
        await field.fill(RENAMED);
        await page.keyboard.press("Enter");
        await field.waitFor({ state: "detached", timeout: 2000 });
        memory.renamed = true;
        return true;
      },
      why: "the field commits the new name",
    },
    {
      expect: (state, { memory }) => {
        const board = state.boards.find((entry) => entry.id === memory.boardId);
        return board?.name === RENAMED;
      },
      why: "the snapshot's Boards carry the new name",
      screenshot: "renamed",
      timeout: 5000,
    },
    { reload: true, screenshot: "renamed-reloaded" },
    {
      expect: (state, { memory }) => {
        const board = state.boards.find((entry) => entry.id === memory.boardId);
        return board?.name === RENAMED;
      },
      why: "the name survived a reload, so one renameBoard was written",
      timeout: 8000,
    },

    // 2. The Board's member selection: the count and the selection both real.
    {
      expect: async (state, { page, memory }) => {
        if (memory.selected === true) return true;
        const board = state.boards.find((entry) => entry.id === memory.boardId);
        if (board === undefined) return false;
        await openBoardMenu(page, state, board);
        const row = page.getByRole("menuitem", { name: /^Select \d+ cards?$/ });
        if ((await row.count()) === 0) return false;
        const label = (await row.textContent()) ?? "";
        const count = Number(/Select (\d+) card/.exec(label)?.[1] ?? "0");
        // A Board with no cards would make this scenario prove nothing.
        if (count === 0) return false;
        await row.click();
        memory.expectedMembers = count;
        memory.selected = true;
        return true;
      },
      why: "the Board's menu offers its real member count",
      screenshot: "select-members",
    },
    {
      expect: (state, { memory }) => state.selection.length === memory.expectedMembers,
      why: "the row selected exactly the cards it counted",
      timeout: 5000,
    },

    // 3. Escape with nothing else to exit lets go of the selection.
    { key: "Escape", label: "escape-once" },
    { key: "Escape", label: "escape-twice" },
    {
      expect: (state) => state.selection.length === 0,
      why: "Escape cleared the selection",
      screenshot: "selection-cleared",
      timeout: 3000,
    },

    // 4. "Show me this card" — the inspector's placement row calls `focusCard`,
    // which used to write a `focusTarget` nothing read. It is a camera flight
    // now, so the card's centre has to land in the middle of the viewport.
    {
      expect: async (state, { page, memory }) => {
        if (memory.inspected === true) return true;
        const slot = state.slots.find((entry) => entry.cardId === LOOSE_CARD);
        if (slot === undefined) return false;
        const box = await page.locator(".ice-surface").boundingBox();
        const point = TO_CLIENT(box, state.camera, {
          x: slot.world.x + slot.world.width / 2,
          y: slot.world.y + slot.world.height / 2,
        });
        await page.mouse.click(point.x, point.y);
        await page.getByTestId("inspector-boards").waitFor({ timeout: 5000 });
        memory.inspected = true;
        return true;
      },
      why: "a single pick opens the card's inspector, which offers a way to reveal it",
      screenshot: "inspector",
    },
    {
      expect: async (_state, { page, memory }) => {
        if (memory.focusRequested === true) return true;
        // The card's own Board breadcrumb is the inspector's reveal action
        // (`onFocusCard` → `focusCard`). The canvas is the only reader of it.
        await page.getByTestId("card-where-current").getByRole("button").first().click();
        memory.focusRequested = true;
        return true;
      },
      why: "the inspector asks the canvas to reveal the card",
    },
    {
      expect: async (state, { page }) => {
        const slot = state.slots.find((entry) => entry.cardId === LOOSE_CARD);
        if (slot === undefined || state.camera === null) return false;
        const box = await page.locator(".ice-surface").boundingBox();
        const centreX = state.camera.x + box.width / (2 * state.camera.zoom);
        const centreY = state.camera.y + box.height / (2 * state.camera.zoom);
        const wantX = slot.world.x + slot.world.width / 2;
        const wantY = slot.world.y + slot.world.height / 2;
        return Math.abs(centreX - wantX) <= 8 && Math.abs(centreY - wantY) <= 8;
      },
      why: "the camera flew to the card the inspector named",
      screenshot: "revealed",
      timeout: 8000,
    },
  ],
};
