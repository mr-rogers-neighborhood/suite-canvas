/**
 * The depth scenario: a link that leaves a Board is drawn inside it, through the
 * wall (the phase-2 brief's last item).
 *
 * Set up the way a reader would: link a loose card to a frame on the View's
 * plane, then drop that card into "Start here". The link now leaves the Board —
 * on the plane it runs from the card's anchor to the far frame's wall, all in
 * the plane's units, and its far end is well outside the Board. Standing inside
 * "Start here", the same link is drawn from the card to the wall *it* leaves by:
 * cut at the frame's edge and marked with a through tick. Escape puts it back
 * exactly where it was.
 *
 * The numbers come from the surface's own state (`window.__suiteIce`): an
 * entered frame's rect is its own box, `{0, 0, width, height}`, and a link's
 * endpoints are drawn in the frame the object lives in.
 */
const BOARD = "Start here";
const LOOSE = "demo-card-atlas-canvas";
const OUTSIDE_BOARD = "Sketches";
/** A wall end is on the rect, to within a pixel or two. */
const WALL_TOLERANCE = 2;

/** The link this scenario draws: from the card that moved inside out to a frame. */
const crossing = (state) => state.edges.find((edge) => edge.targetKind === "board");

const boardNamed = (state, name) => state.boards.find((board) => board.name === name);

/** The entered frame's own rect, in the units its children are drawn in. */
const insideRect = (board) => ({
  x: 0,
  y: 0,
  width: board.world.width,
  height: board.world.height,
});

const inRect = (point, rect, tolerance = WALL_TOLERANCE) =>
  point.x >= rect.x - tolerance &&
  point.x <= rect.x + rect.width + tolerance &&
  point.y >= rect.y - tolerance &&
  point.y <= rect.y + rect.height + tolerance;

/** How far the point is from the nearest side of the rect. */
const wallDistance = (point, rect) =>
  Math.min(
    Math.abs(point.x - rect.x),
    Math.abs(point.x - (rect.x + rect.width)),
    Math.abs(point.y - rect.y),
    Math.abs(point.y - (rect.y + rect.height)),
  );

const near = (a, b, tolerance = 1) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

/** The plane's drawing, stated in the Board's own coordinates. */
const planeLocal = (point, board) => ({
  x: point.x - board.world.x,
  y: point.y - board.world.y,
});

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    // A loose card linked to a frame on the View's plane: both ends are easy to
    // reach from the plane, which is where a reader would draw it.
    { linkFromCard: { card: LOOSE, board: OUTSIDE_BOARD }, screenshot: "linked" },
    { dragCardTo: { card: LOOSE, board: BOARD }, screenshot: "dropped" },
    {
      expect: (state) => {
        const slot = state.slots.find((entry) => entry.cardId === LOOSE);
        return slot?.boardId === "demo-section-atlas-start" && crossing(state) !== undefined;
      },
      why: "the card moved into the Board, and the link that leaves it is still drawn",
      timeout: 8000,
    },
    {
      expect: (state, { memory }) => {
        const edge = crossing(state);
        const board = boardNamed(state, BOARD);
        if (edge === undefined || board === undefined) return false;
        // Drawn on the View's plane, not in the Board: that is the plane reading.
        if (edge.frame === board.id) return false;
        // Its far end is well outside the Board, which is why nothing of it was
        // visible from inside before this slice.
        if (inRect(planeLocal(edge.to, board), insideRect(board))) return false;
        memory.plane = { from: edge.from, to: edge.to };
        return true;
      },
      why: "on the plane the link's far end lies outside the Board it leaves",
    },
    { dblclickBoard: BOARD, screenshot: "entered" },
    {
      expect: (state) => state.entered.some((frame) => frame.name === BOARD),
      why: "double-clicking the mat enters the Board",
    },
    // The drop left the card just outside the frame's bottom wall; inside the
    // Board it is a plain drag in the Board's own units, and the link follows it.
    { dragCard: { card: LOOSE, dx: -260, dy: -300 }, screenshot: "moved" },
    { wait: 600, label: "settled" },
    {
      expect: (state) => {
        const edge = crossing(state);
        const board = boardNamed(state, BOARD);
        if (edge === undefined || board === undefined) return false;
        // Still drawn — the link no longer disappears when the Board is entered.
        if (edge.frame !== board.id) return false;
        const rect = insideRect(board);
        // Both ends are in the entered frame's own coordinates...
        if (!inRect(edge.from, rect) || !inRect(edge.to, rect)) return false;
        // ...and one of them is the wall the link leaves by.
        return (
          wallDistance(edge.from, rect) <= WALL_TOLERANCE ||
          wallDistance(edge.to, rect) <= WALL_TOLERANCE
        );
      },
      why: "inside the Board the link is drawn from the card to the wall it leaves by",
      screenshot: "clipped",
    },
    {
      expect: (state, { memory }) => {
        const edge = crossing(state);
        const board = boardNamed(state, BOARD);
        const plane = memory.plane;
        if (edge === undefined || board === undefined || plane === undefined) return false;
        // The inside drawing is a *different* drawing, not the plane's one moved:
        // its far end is on the wall, where the plane's end was not.
        const rect = insideRect(board);
        const wall = wallDistance(edge.to, rect) <= WALL_TOLERANCE ? edge.to : edge.from;
        if (wallDistance(wall, rect) > WALL_TOLERANCE) return false;
        return !near(wall, planeLocal(plane.to, board));
      },
      why: "the cut end sits on the wall, where the plane's end was not",
    },
    { key: "Escape", screenshot: "left" },
    {
      expect: (state) => state.entered.length === 0,
      why: "Escape leaves the Board",
    },
    {
      expect: (state, { memory }) => {
        const edge = crossing(state);
        const board = boardNamed(state, BOARD);
        const slot = state.slots.find((entry) => entry.cardId === LOOSE);
        const plane = memory.plane;
        if (edge === undefined || board === undefined || slot === undefined) return false;
        if (plane === undefined) return false;
        // Back on its own plane: the far end is the frame's wall where it always
        // was, and the near one is the card's own world anchor — the link left
        // from the card's east connector, and the in-Board drag moved the card,
        // so the plane drawing follows the document.
        const anchor = {
          x: slot.world.x + slot.world.width,
          y: slot.world.y + slot.world.height / 2,
        };
        return edge.frame !== board.id && near(edge.to, plane.to) && near(edge.from, anchor);
      },
      why: "leaving the Board puts the link back on the plane, where it was",
    },
  ],
};
