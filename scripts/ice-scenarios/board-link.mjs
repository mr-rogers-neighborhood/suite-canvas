/**
 * The Board link scenario: a frame is a link end (ADR-0041).
 *
 * A link may leave a Board's wall and land on a card's connector, and a frame's
 * four walls are offered the way a card's connectors are. The assertion is on
 * the document's own edge — the end kinds — not on the pixels: a link that only
 * looked right would still be a broken write.
 */
const BOARD = "Start here";
const CARD = "demo-card-atlas-review";

/** The links the gestures should have written: a frame at one end. */
const boardLinks = (state) =>
  state.edges.filter((edge) => edge.sourceKind === "board" || edge.targetKind === "board");

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    { hoverBoard: BOARD, screenshot: "hover" },
    {
      expect: (state) => state.overlays.connectorDots.length === 4,
      why: "a Board offers its four wall midpoints",
    },
    { linkFromBoard: { board: BOARD, side: "east", toCard: CARD }, screenshot: "linked" },
    {
      expect: (state) => boardLinks(state).some((edge) => edge.sourceKind === "board"),
      why: "a link may leave a frame's wall and land on a card",
    },
    { linkFromCard: { card: "demo-card-atlas-canvas", board: BOARD }, screenshot: "linked-back" },
    {
      expect: (state) => boardLinks(state).some((edge) => edge.targetKind === "board"),
      why: "a link may leave a card's connector and land on a frame",
    },
  ],
};
