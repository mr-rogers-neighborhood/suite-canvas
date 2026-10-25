/**
 * The face scenario: what a card says, and how much of it each band draws
 * (ADR-0043 §2–3).
 *
 * A card's paper is one text flow — `glyph · title · ⇄n · ✎n · #n`, a blank
 * line, the body — and the *band* (the card's own width on screen) decides how
 * much of it is written: nothing at `icon`, the title row at `compact`, all of
 * it at `full`. None of that is in the DOM, so the scenario reads what the
 * projection published on the dev snapshot (`state.slots[].face`): the flow it
 * built, and the band the card's width and the camera's zoom put it in.
 *
 * The counts are the document's own (`referenceCount` and `card.tags`), which is
 * why the assertions name real demo cards:
 *
 * - `demo-card-atlas-welcome` is linked to "How boards nest" and tagged `demo`,
 *   so its title row carries `⇄1 · #1`;
 * - `demo-card-atlas-capture` is tagged `workflow` and linked to nothing, so it
 *   carries `#1` and no `⇄`;
 * - `demo-card-atlas-whiteboard` has four strokes, so its row carries `✎4` and
 *   its body is the sketch of them (a whiteboard's content is its drawing —
 *   ADR-0043 §3, interim until the textured face exists).
 *
 * Run it with `pnpm ice:lab face`.
 */
const WELCOME = "demo-card-atlas-welcome";
const CAPTURE = "demo-card-atlas-capture";
const WHITEBOARD = "demo-card-atlas-whiteboard";

/** The block characters a whiteboard's sketch is made of (`suiteWhiteboardFace.ts`). */
const SKETCH = /^[▁▂▃▄▅▆▇█]+$/;

const stateOf = (page) => page.evaluate(() => window.__suiteIce ?? null);

const slotOf = (state, cardId) => state?.slots?.find((slot) => slot.cardId === cardId) ?? null;

const faceOf = (state, cardId) => slotOf(state, cardId)?.face ?? null;

const bandOf = (state, cardId) => faceOf(state, cardId)?.band ?? null;

/** The flow's first line is the title row, by construction (`suiteCardFace.ts`). */
const titleRow = (text) => String(text ?? "").split("\n")[0] ?? "";

/** The flow's body: everything after the blank line, as lines. */
const bodyLines = (text) =>
  String(text ?? "")
    .split("\n")
    .slice(2)
    .filter((line) => line.length > 0);

/**
 * Step the zoom until the card is in `wanted`'s band.
 *
 * The demo's fit zoom is the seed's business, not this scenario's: the click
 * count that reaches each band depends on it, so the scenario asks the snapshot
 * instead of assuming. A click is ×1.25 and the thresholds are a factor of
 * three apart, so a band cannot be stepped over.
 */
async function zoomUntil(page, cardId, wanted, direction = "in", budget = 20) {
  return zoomOne(page, cardId, wanted, direction, budget);
}

/** Both directions, so a frame entered at either side of a band still lands in it. */
async function zoomTo(page, cardId, wanted, budget = 16) {
  let result = await zoomOne(page, cardId, wanted, "in", budget);
  if (!result.ok) result = await zoomOne(page, cardId, wanted, "out", budget);
  return result;
}

async function zoomOne(page, cardId, wanted, direction = "in", budget = 20) {
  const testId = direction === "in" ? "canvas-zoom-in" : "canvas-zoom-out";
  let current = await stateOf(page);
  for (let step = 0; step < budget; step += 1) {
    if (bandOf(current, cardId) === wanted) break;
    await page.getByTestId(testId).click();
    await page.waitForTimeout(200);
    current = await stateOf(page);
  }
  return { state: current, ok: bandOf(current, cardId) === wanted };
}

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    // A previous run may have failed inside a Board; the plane is where this
    // scenario reads bands.
    { key: "Escape" },
    { wait: 600, label: "plane" },
    { fit: true },

    // 1. Every card publishes a flow, whatever the camera is doing: the band is
    //    what withholds it, the flow is what the document said.
    {
      expect: (state) =>
        state.slots.length > 0 && state.slots.every((slot) => (slot.face?.text.length ?? 0) > 0),
      why: "every card on the desk publishes the flow its paper writes",
      timeout: 15_000,
    },

    // 2. Zooming out takes a 288-unit card under 56 px of screen width: the
    //    icon band, which draws none of the flow.
    {
      expect: async (_state, { page }) => (await zoomUntil(page, WELCOME, "icon", "out")).ok,
      why: "zooming out lands the card in the icon band",
      timeout: 30_000,
    },
    {
      expect: (state) => {
        const face = faceOf(state, WELCOME);
        return (
          face !== null &&
          face.band === "icon" &&
          // The flow still exists — the band is what withholds it.
          titleRow(face.text).includes("Welcome to Atlas")
        );
      },
      why: "the icon band draws no text, though the card still has a title row",
      screenshot: "icon",
      timeout: 15_000,
    },

    // 3. Zooming in crosses 56 px of the card's own width: the compact band,
    //    where the title row is drawn and the body is not.
    {
      expect: async (_state, { page }) => (await zoomUntil(page, WELCOME, "compact")).ok,
      why: "zooming in lands the card in the compact band",
      timeout: 30_000,
    },
    {
      expect: (state) => {
        const face = faceOf(state, WELCOME);
        if (face === null || face.band !== "compact") return false;
        const row = titleRow(face.text);
        // Counts are the document's: one link (the edge to "How boards nest")
        // and one tag (`demo`), and the body is still in the flow, unread.
        return row.includes("⇄1") && row.includes("#1") && bodyLines(face.text).length > 0;
      },
      why: "the compact title row says glyph, title and both counts, and nothing else",
      screenshot: "compact",
      timeout: 15_000,
    },

    // 4. A card with no links spends no characters on a zero count.
    {
      expect: (state) => {
        const row = titleRow(faceOf(state, CAPTURE)?.text);
        return (
          row.includes("Capture first, sort later") && row.includes("#1") && !row.includes("⇄")
        );
      },
      why: "a reference count of zero is omitted, a tag count of one is not",
      timeout: 15_000,
    },

    // 5. Zooming on crosses 180 px: the full band, where the body is written.
    {
      expect: async (_state, { page }) => (await zoomUntil(page, WELCOME, "full")).ok,
      why: "zooming in lands the card in the full band",
      timeout: 30_000,
    },
    // The band is asked of the frame's raster queue, so the sheet catches up a
    // beat after the camera stops; the picture is taken once it has.
    { wait: 2000, label: "full-settle" },
    {
      expect: (state) => {
        const face = faceOf(state, WELCOME);
        if (face === null || face.band !== "full") return false;
        return bodyLines(face.text).some((line) => line.includes("Atlas is the home board"));
      },
      why: "the full band draws the title row and the body",
      screenshot: "full",
      timeout: 15_000,
    },

    // 6. A whiteboard says how much it has drawn, and sketches it: its content
    //    is the picture, so a count alone would be a blank card with a number.
    //    The demo's whiteboard sits inside the "Sketches" Board, so the frame is
    //    entered to read it at the size a reader opens it at.
    { dblclickBoard: "Sketches" },
    { wait: 1400, label: "inside" },
    {
      expect: async (_state, { page }) => (await zoomTo(page, WHITEBOARD, "full")).ok,
      why: "the whiteboard is in the full band inside its Board",
      timeout: 30_000,
    },
    { wait: 2000, label: "whiteboard-settle" },
    {
      expect: (state) => {
        const face = faceOf(state, WHITEBOARD);
        if (face === null) return false;
        const row = titleRow(face.text);
        const lines = bodyLines(face.text);
        return (
          row.includes("Sketch: three boards") &&
          row.includes("✎4") &&
          lines.length > 0 &&
          lines.every((line) => SKETCH.test(line)) &&
          // What the sheet drew agrees with the band its width asks for.
          face.drawn?.band === face.band
        );
      },
      why: "a whiteboard's title row counts its four strokes and its body sketches them",
      screenshot: "whiteboard",
      timeout: 15_000,
    },
    { key: "Escape" },
    { wait: 800, label: "plane-again" },

    // 7. A readable close-up, for the record: the title row, the blank line and
    //    the body, at a size a reader actually reads a card at.
    {
      expect: async (_state, { page }) => {
        for (let step = 0; step < 5; step += 1) {
          await page.getByTestId("canvas-zoom-in").click();
          await page.waitForTimeout(200);
        }
        await page.waitForTimeout(2000);
        const current = await stateOf(page);
        return bandOf(current, CAPTURE) === "full";
      },
      why: "the card is still in the full band when the camera is close",
      screenshot: "close",
      timeout: 30_000,
    },

    // 8. Every band the desk reports is one of the three the ADR names.
    {
      expect: (state) => {
        const bands = new Set(["icon", "compact", "full"]);
        return state.slots.every(
          (slot) => slot.face?.band === null || bands.has(String(slot.face?.band)),
        );
      },
      why: "a card's band is always one of icon, compact or full",
      timeout: 15_000,
    },
  ],
};
