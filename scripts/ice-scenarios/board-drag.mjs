/**
 * The Board gesture scenario: a frame is part of the document.
 *
 * A mat is dragged by its empty top strip, then the page is reloaded: what
 * survives a reload is what reached Loro, so the assertion after it is the proof
 * that the gesture was a document write and not ICE's own idea of where the
 * frame is.
 *
 * The delta is not asserted exactly: the desk snaps a move to its alignment
 * guides (that is what `snap: "both"` buys), so the gesture is checked by the
 * direction it travelled. The corner handle is the desk's chrome — a few screen
 * px outside the frame and too fine to aim at blind — so resizing is covered by
 * the controller's own tests instead.
 */
const BOARD = "Start here";
const MOVE = { dx: 60, dy: 40 };

const rectOf = (state) => state.boards.find((board) => board.name === BOARD)?.world;

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    {
      expect: (state, { memory }) => {
        memory.start = rectOf(state);
        return memory.start !== undefined;
      },
      why: "the example draws the frame the gesture will move",
    },
    { dragBoard: { board: BOARD, ...MOVE }, screenshot: "moved" },
    {
      expect: (state, { memory }) => {
        const rect = rectOf(state);
        memory.moved = rect;
        return (
          rect !== undefined &&
          rect.x > memory.start.x + 10 &&
          rect.y > memory.start.y + 5 &&
          rect.width === memory.start.width &&
          rect.height === memory.start.height
        );
      },
      why: "the frame took the drag without changing shape",
    },
    { reload: true, screenshot: "reloaded" },
    {
      expect: (state, { memory }) => {
        const rect = rectOf(state);
        return (
          rect !== undefined &&
          Math.abs(rect.x - memory.moved.x) <= 2 &&
          Math.abs(rect.y - memory.moved.y) <= 2
        );
      },
      why: "the moved frame came back from the document, not from ICE",
      timeout: 8000,
    },
  ],
};
