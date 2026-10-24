/**
 * The gesture scenario: every drag a reader makes is a document write.
 *
 * Two of these were P0s in the parity matrix — a multi-card drag committed one
 * card, and a drop into a Board re-parented nothing. Both are proven the same
 * way: make the gesture, then reload, because a reload rebuilds the desk from
 * Loro and anything ICE alone knew is gone. The third (a drag inside an entered
 * Board) has its own scenario, `nested-drag.mjs`.
 */
const FIRST = "demo-card-atlas-capture";
const SECOND = "demo-card-atlas-review";
const BOARD = "Start here";
const LOOSE = "demo-card-atlas-canvas";

const slotOf = (state, cardId) => state.slots.find((slot) => slot.cardId === cardId);

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    {
      expect: (state, { memory }) => {
        memory.before = state.slots.map((slot) => ({ id: slot.cardId, local: slot.local }));
        return state.slots.length > 1;
      },
      why: "the example draws the cards the gestures act on",
    },

    // 1. Two cards selected, then one dragged: both commit, as one write.
    // The marquee is ICE's own gesture; shift-click on ICE does not extend, so
    // a rectangle over both cards is how a several is asked for.
    {
      dragWorld: [
        [980, 40],
        [1380, 720],
      ],
      shift: true,
      screenshot: "selected",
    },
    {
      expect: (state) => state.selection.length === 2,
      why: "the marquee selected both cards",
    },
    { dragCard: { card: FIRST, dx: 40, dy: 120 }, screenshot: "dragged-pair" },
    {
      expect: (state, { memory }) => {
        const first = slotOf(state, FIRST);
        const second = slotOf(state, SECOND);
        const was = (id) => memory.before.find((entry) => entry.id === id).local;
        memory.pair = { first: first?.local, second: second?.local };
        return (
          first !== undefined &&
          second !== undefined &&
          Math.abs(second.local.y - was(SECOND).y) > 60
        );
      },
      why: "the card that was not pressed moved with the drag",
    },
    { reload: true, screenshot: "pair-reloaded" },
    {
      expect: (state, { memory }) => {
        const second = slotOf(state, SECOND);
        return second !== undefined && Math.abs(second.local.y - memory.pair.second.y) <= 2;
      },
      why: "both cards came back where they were left, so one drag wrote both",
      timeout: 8000,
    },

    // 2. Inside a Board, a drag commits in that Board's own coordinates.
    //
    // That step lives in `nested-drag.mjs` now: entering a Board and dragging
    // the card it holds is the one case a single step cannot assert alone (the
    // card is not on the plane after the reload, so the proof has to walk back
    // into the Board). Run it with `pnpm ice:lab nested-drag`.

    // 3. A card dropped on a Board's face is re-parented by that Board.
    {
      expect: (state) => slotOf(state, LOOSE)?.boardId === "board-1",
      why: "the card starts on the View root",
    },
    { dragCardTo: { card: LOOSE, board: BOARD }, screenshot: "dropped" },
    {
      expect: (state) => slotOf(state, LOOSE)?.boardId === "demo-section-atlas-start",
      why: "the drop re-parented the card onto the Board it landed in",
      timeout: 8000,
    },
    { reload: true, screenshot: "drop-reloaded" },
    {
      expect: (state) => slotOf(state, LOOSE)?.boardId === "demo-section-atlas-start",
      why: "the new parent survived a reload",
      timeout: 8000,
    },
  ],
};
