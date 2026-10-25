/**
 * The polish scenario: the ordinary things a canvas is expected to do.
 *
 * Copy/paste and nudge are not gestures the GPU can confirm — a card is an
 * entity component, not a DOM node — so every claim here is checked twice: the
 * desk's own published state says the placement moved, and a `reload` says the
 * *document* agrees. A paste that only ICE saw would vanish on the second step.
 *
 * The clipboard is the document's, not the OS's: `Control+C` records ids, and
 * `Control+V` asks the document to copy its own trees onto the Board under the
 * pointer. That is why the pasted card exists after a reload at all.
 *
 * The last part is the keyboard search: `Control+K` opens the library scoped to
 * this canvas and focuses its box, and choosing a result reveals the card —
 * here the camera moves, because a reveal is a fit, not a no-op.
 */
const SOURCE = "demo-card-atlas-canvas";
const SEARCH_QUERY = "infinite";
const STILL = 0.6;

const slotOf = (state, cardId) => state.slots.find((slot) => slot.cardId === cardId);
const drawer = '[data-testid="library-drawer"]';

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },

    // 0. What the shell says about the canvas. The cards are GPU rasters, so the
    // meaning has to be carried by the region's description and its live
    // summary; both are in the DOM even though nothing on the desk is.
    {
      expect: (_state, { page }) =>
        page.evaluate(() => {
          const summary =
            document.querySelector('[data-testid="ice-surface-summary"]')?.textContent ?? "";
          const help =
            document.querySelector('[data-testid="ice-surface-help"]')?.textContent ?? "";
          return (
            summary.startsWith("Atlas: ") &&
            /^Atlas: \d+ cards placed on \d+ boards, 0 selected\.$/.test(summary) &&
            /0 selected/.test(summary) &&
            help.includes("WebGPU") &&
            help.includes("not in the accessibility tree") &&
            help.includes("Ctrl+K")
          );
        }),
      why: "the surface carries a live summary and an honest description",
    },

    // 1. One card selected: the subject of every key below.
    { clickCard: SOURCE, screenshot: "selected" },
    {
      expect: (state) => state.selection.length === 1 && state.selection[0] === SOURCE,
      why: "the press selected the card the keyboard will act on",
    },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, SOURCE);
        if (slot === undefined) return false;
        memory.before = { slots: state.slots.length, local: { ...slot.local } };
        return true;
      },
      why: "the desk says how many placements exist before the paste",
    },

    // 2. Copy, then paste at the pointer — which is still over the card, so it
    // lands on the View's plane beside it. One more placement, one new card.
    { key: "Control+c", label: "copy" },
    { key: "Control+v", screenshot: "pasted" },
    {
      expect: (state, { memory }) => {
        const source = slotOf(state, SOURCE);
        const added = state.slots.filter((slot) => slot.cardId !== SOURCE);
        memory.pasted = state.slots.length;
        return (
          state.slots.length === memory.before.slots + 1 &&
          added.length > 0 &&
          source !== undefined &&
          source.cardId === SOURCE
        );
      },
      why: "paste added exactly one placement",
      timeout: 8000,
    },
    {
      expect: (state, { memory }) => {
        // A paste is a copy, not a move: the source stayed exactly where it was.
        const source = slotOf(state, SOURCE);
        return (
          source !== undefined &&
          Math.abs(source.local.x - memory.before.local.x) < STILL &&
          Math.abs(source.local.y - memory.before.local.y) < STILL
        );
      },
      why: "the card that was copied did not move, so the extra placement is a copy",
      timeout: 8000,
    },

    // 3. A nudge is one document unit, and Shift is ten. Both are the same
    // `planMoveCommit` a drag uses, so the arithmetic is the bridge's.
    { key: "ArrowRight", label: "nudge-right" },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, SOURCE);
        return slot !== undefined && Math.abs(slot.local.x - (memory.before.local.x + 1)) < STILL;
      },
      why: "the arrow key moved the selection one unit right",
      timeout: 8000,
    },
    { key: "Shift+ArrowDown", label: "nudge-down-far" },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, SOURCE);
        if (slot === undefined) return false;
        memory.nudged = { ...slot.local };
        return Math.abs(slot.local.y - (memory.before.local.y + 10)) < STILL;
      },
      why: "Shift and an arrow moved the selection ten units down",
      timeout: 8000,
    },

    // 4. The document, not the desk: a reload rebuilds every entity from Loro.
    { reload: true, screenshot: "reloaded" },
    {
      expect: (state, { memory }) => state.slots.length === memory.before.slots + 1,
      why: "both placements came back, so the paste reached the document",
      timeout: 15_000,
    },
    {
      expect: (state, { memory }) => {
        const slot = slotOf(state, SOURCE);
        return (
          slot !== undefined &&
          Math.abs(slot.local.x - memory.nudged.x) <= 2 &&
          Math.abs(slot.local.y - memory.nudged.y) <= 2
        );
      },
      why: "the nudge survived the reload at the position it was left",
      timeout: 15_000,
    },

    // 5. Command/Ctrl+K: the library opens scoped to this canvas, its box takes
    // the keys, and the result chosen is revealed — a camera flight, not a list.
    { key: "Control+k", screenshot: "search-open" },
    {
      expect: (_state, { page }) =>
        page.evaluate((selector) => document.querySelector(selector) !== null, drawer),
      why: "the keyboard opened the library",
    },
    {
      expect: (_state, { page }) =>
        page.evaluate(() => {
          const scoped = document.querySelector('[data-testid="library-scope-board"]');
          const input = document.querySelector(".library-search input");
          return (
            scoped?.getAttribute("aria-pressed") === "true" &&
            input !== null &&
            document.activeElement === input
          );
        }),
      why: "the search is scoped to the canvas and its box has focus",
    },
    ...SEARCH_QUERY.split("").map((letter) => ({ key: letter, label: `type-${letter}` })),
    {
      expect: (_state, { page }) =>
        page.evaluate(
          (text) => document.querySelector(".library-search input")?.value === text,
          SEARCH_QUERY,
        ),
      why: "the query reached the box, so the drawer owned the keys",
    },
    {
      expect: (state, { page, memory }) => {
        memory.camera = state.camera;
        return page.evaluate((selector) => document.querySelector(selector) !== null, drawer);
      },
      why: "the result list is showing before Enter is pressed",
    },
    { key: "Enter", label: "choose-result", screenshot: "revealed" },
    {
      expect: (state, { memory }) => {
        const camera = state.camera;
        if (camera === null || memory.camera === null) return false;
        // A reveal is a fit: the camera has to travel to the card.
        return (
          Math.abs(camera.x - memory.camera.x) > 1 ||
          Math.abs(camera.y - memory.camera.y) > 1 ||
          Math.abs(camera.zoom - memory.camera.zoom) > 0.01
        );
      },
      why: "choosing a result flew the camera to the card",
      timeout: 8000,
    },
    {
      expect: (_state, { page }) =>
        page.evaluate((selector) => document.querySelector(selector) === null, drawer),
      why: "the drawer stepped aside so the reveal is visible",
    },
  ],
};
