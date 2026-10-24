/**
 * The link scenario: the connector affordance sits on a card, and the View's
 * link is drawn where its endpoints are.
 *
 * The numbers come from the surface's own state (`window.__suiteIce`), so the
 * assertions are about placement, not about a screenshot's pixels.
 */
const CARD = "demo-card-atlas-capture";
const TOLERANCE = 4;

const screenOf = (camera, point) => ({
  x: (point.x - camera.x) * camera.zoom,
  y: (point.y - camera.y) * camera.zoom,
});

const near = (a, b, tolerance = TOLERANCE) =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    {
      expect: (state) => state.camera !== null && state.slots.length > 0,
      why: "the desk publishes a camera and its cards",
    },
    { hoverCard: CARD, screenshot: "hover" },
    {
      expect: (state) => {
        const dots = state.overlays.connectorDots;
        if (dots.length !== 4) return false;
        const card = state.slots.find((slot) => slot.cardId === CARD);
        if (card === undefined) return false;
        // The four side midpoints of the card, in screen px.
        const mid = (x, y) =>
          screenOf(state.camera, {
            x: card.world.x + card.world.width * x,
            y: card.world.y + card.world.height * y,
          });
        const expected = [mid(0.5, 0), mid(1, 0.5), mid(0.5, 1), mid(0, 0.5)];
        return expected.every((point) => dots.some((dot) => near(dot, point)));
      },
      why: "the four connector dots sit on the hovered card's side midpoints",
    },
    {
      expect: (state) => {
        // Every drawn link lands on the plane between its two endpoints.
        const known = new Set(state.boards.map((board) => board.id));
        const inFrame = state.edges.every(
          (edge) => known.has(edge.frame) || state.entered.some((frame) => frame.id === edge.frame),
        );
        return state.edges.length >= 1 && inFrame;
      },
      why: "the example's link is drawn and knows the frame it belongs to",
    },
  ],
};
