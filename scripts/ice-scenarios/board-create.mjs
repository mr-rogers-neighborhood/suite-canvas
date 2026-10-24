/**
 * The Board tree scenario: a Board created in this session is drawn.
 *
 * A mat is not a card. It is a container ICE compiles an inside frame for, so
 * the desk cannot reconcile one the way it reconciles a placement — the seed
 * used to run once and leave the Board tree on screen as the one that loaded.
 * That is what this scenario is about: a Board planted from the Dock must get a
 * mat, be enterable as a doorway, and come back after a reload, because the
 * only thing that carries it across is the document.
 *
 * The assertions read the surface's own state (`window.__suiteIce`): `boards`
 * is the document's tree, `mat` is the rect the desk drew for it (null when the
 * desk has no mat — the failure this covers), and `entered` is the frame the
 * camera is inside.
 */
export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    {
      expect: (state, { memory }) => {
        memory.boards = state.boards.map((board) => board.id);
        return memory.boards.length > 0;
      },
      why: "the example's Boards are on the desk before anything is created",
    },
    // A Board is a frame that holds cards, so it is offered beside the card
    // types in the Dock's "+ New card" menu, not as a card itself.
    { clickTestId: ["dock-new-card", "dock-new-board"], screenshot: "created" },
    {
      expect: (state, { memory }) => {
        const created = state.boards.find((board) => !memory.boards.includes(board.id));
        if (created === undefined) return false;
        memory.created = created;
        return created.mat !== null && created.mat.width > 0 && created.mat.height > 0;
      },
      why: "a Board created in this session gets a mat, not just a row in the document",
      timeout: 8000,
    },
    {
      expect: async (state, { page, memory }) => {
        const created = memory.created;
        if (state.entered.some((frame) => frame.id === created.id)) return true;
        // Entering is a double click on the mat, in the units the camera speaks.
        // It is aimed here rather than with `dblclickBoard` because the Board's
        // id only exists once the document has it — the gesture is the same one
        // a reader makes on any other mat.
        if (memory.entering !== true) {
          memory.entering = true;
          const surface = await page.locator(".ice-surface").boundingBox();
          const camera = state.camera;
          const mat = created.mat;
          await page.mouse.dblclick(
            surface.x + (mat.x + mat.width / 2 - camera.x) * camera.zoom,
            surface.y + (mat.y + mat.height / 2 - camera.y) * camera.zoom,
          );
        }
        return false;
      },
      why: "double-clicking the new mat enters the Board",
      timeout: 8000,
    },
    {
      expect: (state, { memory }) =>
        state.slots.every((slot) => slot.boardId !== memory.created.id),
      why: "the new Board holds no cards, so none may be drawn inside it",
    },
    { screenshot: "entered" },
    // A rebuild while the reader is *inside* a Board is the hard case: the mat
    // that names the frame they are standing in is one of the entities being
    // replaced. The seat must survive it — the camera is written back into the
    // same frame, and the breadcrumb still says which Board that is.
    { clickTestId: ["dock-new-card", "dock-new-board"], screenshot: "created-inside" },
    {
      expect: (state, { memory }) => {
        const other = state.boards.find((board) => board.id !== memory.created.id && board.mat);
        return state.entered.some((frame) => frame.id === memory.created.id) && other !== undefined;
      },
      why: "a Board created from inside one rebuilds the tree and keeps the reader where they were",
      timeout: 8000,
    },
    { reload: true, screenshot: "reloaded" },
    {
      expect: (state, { memory }) => {
        const board = state.boards.find((entry) => entry.id === memory.created.id);
        return board !== undefined && board.mat !== null && board.mat.width > 0;
      },
      why: "the Board reached the document: a reload finds it, mat and all",
      timeout: 12_000,
    },
  ],
};
