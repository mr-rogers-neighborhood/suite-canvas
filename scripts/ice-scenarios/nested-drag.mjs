/**
 * The nested-drag scenario: a drag inside an entered Board is a document write.
 *
 * This is the case a mocked `rectOf` cannot prove. Inside a Board the entities
 * are the ones ICE built for that frame, so a gesture there has to resolve what
 * it is holding from the entity itself — the surface's spawn table describes
 * the plane. The scenario therefore works the way a reader does: double-click
 * the mat, drag the card the Board holds, and then reload, because only what
 * reached Loro survives a reload.
 *
 * Inside a Board the camera speaks that frame's units, so the runner reads the
 * card's `local` box (`cardRect` in `scripts/ice-lab.mjs`); after the reload the
 * Board is not entered and the same `local` is the placement's own coordinates,
 * which is exactly what the commit wrote.
 */
const BOARD = "Start here";
const CARD = "demo-card-atlas-welcome";
const MOVE = { dx: 44, dy: 76 };

const slotOf = (state, cardId) => state.slots.find((slot) => slot.cardId === cardId);

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    { dblclickBoard: BOARD, screenshot: "entered" },
    {
      expect: (state) => state.entered.some((frame) => frame.name === BOARD),
      why: "double-clicking the mat enters the Board",
    },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, CARD);
        memory.before = slot?.local;
        return slot?.boardId === "demo-section-atlas-start" && memory.before !== undefined;
      },
      why: "the Board's own card is on the desk inside it",
    },
    { dragCard: { card: CARD, ...MOVE }, screenshot: "dragged" },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, CARD);
        memory.after = slot?.local;
        return (
          slot !== undefined &&
          Math.abs(slot.local.x - memory.before.x) > MOVE.dx / 3 &&
          Math.abs(slot.local.y - memory.before.y) > MOVE.dy / 3
        );
      },
      why: "the card inside the Board took the drag",
    },
    { reload: true, screenshot: "reloaded" },
    // The Board is not remembered across a reload, so the proof has to walk back
    // in: the card inside it is the placement the write survived.
    { dblclickBoard: BOARD, screenshot: "re-entered" },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, CARD);
        return (
          slot !== undefined &&
          slot.boardId === "demo-section-atlas-start" &&
          state.entered.some((frame) => frame.name === BOARD) &&
          Math.abs(slot.local.x - memory.after.x) <= 2 &&
          Math.abs(slot.local.y - memory.after.y) <= 2
        );
      },
      why: "the drag inside the Board reached the document",
      timeout: 8000,
    },
  ],
};
