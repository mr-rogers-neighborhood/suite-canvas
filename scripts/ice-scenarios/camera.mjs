/**
 * The camera scenario: a reload puts you back where you were.
 *
 * A View's camera is document truth, not a surface setting: the desk writes it
 * when it settles (one commit, never one per frame) and the boot restores it
 * before the first painted frame. The only instrument that can prove it is a
 * reload — the desk is rebuilt from Loro, so anything ICE alone knew is gone.
 *
 * The entered Board rides with the camera: a reload inside a Board reopens
 * inside it, and Escape still walks out level by level.
 *
 * Run it with `pnpm ice:lab camera`.
 *
 * The scenario asks for `?fresh=1` and nothing else: the lab gives every run its
 * own workspace id, so the relay claims it for this run's browser, and the
 * reload inside the run is the same profile, the same key and the same
 * document. (A fixed workspace id would be refused on the second run, because a
 * lab browser is a fresh profile and the relay remembers who claimed it.)
 */
const POSITION_TOLERANCE = 2;
const ZOOM_TOLERANCE = 0.01;
const BOARD = "Start here";

/** A restored camera is the stored one: within a couple of units, zoom to 1%. */
const near = (a, b) =>
  a !== null &&
  b !== null &&
  Math.abs(a.x - b.x) <= POSITION_TOLERANCE &&
  Math.abs(a.y - b.y) <= POSITION_TOLERANCE &&
  Math.abs(a.zoom - b.zoom) <= ZOOM_TOLERANCE * Math.max(1, Math.abs(b.zoom));

export default {
  url: "?fresh=1",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    // A previous run may have failed inside a Board; the plane is where this
    // scenario starts. Escape on the plane only cancels gestures.
    { key: "Escape" },
    { wait: 800, label: "plane" },
    {
      expect: (state, { memory }) => {
        memory.initial = state.camera;
        return state.camera !== null && state.entered.length === 0;
      },
      why: "the View opens on its plane with a camera",
    },

    // 1. Pan the plane. Empty mat, select tool: the drag moves the camera.
    {
      drag: [
        [1260, 700],
        [1120, 780],
      ],
      screenshot: "panned",
    },
    { wait: 1200, label: "pan-settle" },
    {
      expect: (state, { memory }) => {
        memory.plane = state.camera;
        const moved =
          state.camera !== null &&
          (Math.abs(state.camera.x - memory.initial.x) > 4 ||
            Math.abs(state.camera.y - memory.initial.y) > 4);
        return moved && state.entered.length === 0;
      },
      why: "the pan moved the plane's camera, and the desk is still on the plane",
    },
    { reload: true, screenshot: "plane-reloaded" },
    {
      expect: (state, { memory }) => near(state.camera, memory.plane),
      why: "the View's camera came back after the reload",
      timeout: 8000,
    },

    // 2. Enter a Board: the camera changes frame, and the path is written with it.
    { dblclickBoard: BOARD, screenshot: "entered" },
    { wait: 1200, label: "enter-settle" },
    {
      expect: (state, { memory }) => {
        memory.inside = state.camera;
        return state.entered.some((frame) => frame.name === BOARD);
      },
      why: "double-clicking the mat entered the Board",
    },
    { reload: true, screenshot: "entered-reloaded" },
    {
      expect: (state, { memory }) => {
        const entered = state.entered.some((frame) => frame.name === BOARD);
        return entered && near(state.camera, memory.inside);
      },
      why: "the reload reopened the entered Board, framed where it was left",
      timeout: 8000,
    },

    // 3. Escape walks back out — one level, and the plane's frame is written again.
    { key: "Escape", screenshot: "escaped" },
    {
      expect: (state, { memory }) => state.entered.length === 0 && near(state.camera, memory.plane),
      why: "Escape walks back out to the plane pose the Board was entered from",
      timeout: 8000,
    },
    { wait: 1200, label: "escape-settle" },
    {
      expect: (state, { memory }) => {
        memory.escaped = state.camera;
        return state.camera !== null;
      },
      why: "the plane has a camera after the exit",
    },
    { reload: true, screenshot: "escaped-reloaded" },
    {
      expect: (state, { memory }) =>
        state.entered.length === 0 && near(state.camera, memory.escaped),
      why: "leaving a Board is written too: the plane's camera survives the reload",
      timeout: 8000,
    },
  ],
};
