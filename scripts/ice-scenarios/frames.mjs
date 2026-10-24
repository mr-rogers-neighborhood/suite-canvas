/**
 * The frame scenario: a link lives on the plane it is drawn on.
 *
 * "Start here" holds the two cards the example links, so the link belongs to
 * that Board's plane: it is drawn small inside the frame from the plane, and at
 * full size once the Board is entered. This is the depth the canvas asks for —
 * a link never floats over a frame it does not belong to.
 */
const BOARD = "Start here";

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    {
      expect: (state) => {
        const edge = state.edges[0];
        return (
          state.edges.length === 1 &&
          state.entered.length === 0 &&
          edge.frame === "demo-section-atlas-start"
        );
      },
      why: "on the plane, the example's link is drawn on the frame that holds its ends",
    },
    { dblclickBoard: BOARD, screenshot: "entered" },
    {
      expect: (state) => state.entered.some((frame) => frame.name === BOARD),
      why: "double-clicking the mat enters the Board",
    },
    {
      expect: (state) => {
        const edge = state.edges[0];
        return state.edges.length === 1 && edge.frame === "demo-section-atlas-start";
      },
      why: "the link is still the same object inside the Board it belongs to",
    },
  ],
};
