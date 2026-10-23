/**
 * The membrane: how the ceiling behaves (ADR-0037).
 *
 * Zooming out normally moves the camera. At the top of the extent — the zoom at
 * which the whole View fits — there is nowhere further to go, so the surface has
 * a choice: stop dead (a wall), switch representation by itself (a revolving
 * door), or let the user *push* and commit past a threshold (a membrane). This
 * module is the third.
 *
 * The grammar is pull-to-refresh's, made spatial:
 *
 * 1. **Resistance.** Extra wheel input past the ceiling accumulates `pull`
 *    instead of moving the camera. The camera still creeps a little (damped) so
 *    the boundary is felt, not inferred.
 * 2. **Cue.** `pull` is 0..1 and the surface draws it; the ceiling is never
 *    crossed silently.
 * 3. **Commit.** At `COMMIT` the surface enters the graph band. The threshold is
 *    well above zero so a stray notch cannot do it.
 * 4. **Return.** Releasing the pull (either direction) below `RETURN` leaves the
 *    graph; the same gesture that entered it also exits. No input decays the
 *    pull on its own, so letting go of the wheel settles instead of hanging.
 *
 * Commit and return use different thresholds, so wheel wobble at the boundary
 * cannot flap. Nothing here reads a clock or a DOM: `now` is passed in, so the
 * whole thing is a pure transition function with tests.
 */

export interface MembraneState {
  /** How far past the ceiling the user has pushed, 0..1. */
  readonly pull: number;
  /** True while the surface is in the graph band because of this membrane. */
  readonly committed: boolean;
  /** When input was last applied, ms. Used for the release decay. */
  readonly lastInputAt: number;
}

export type MembraneAction = "none" | "commit" | "release";

export interface MembraneResult {
  readonly state: MembraneState;
  readonly action: MembraneAction;
  /**
   * How much of the requested zoom-out the camera should actually apply,
   * 0..1: 1 away from the ceiling, damped as the pull builds.
   */
  readonly cameraShare: number;
}

export interface MembraneInput {
  readonly state: MembraneState;
  /** Wheel deltaY, positive = zoom out (the direction that meets the ceiling). */
  readonly deltaY: number;
  readonly now: number;
  /** The camera's zoom after the engine applied its own step, if it did. */
  readonly zoom: number;
  /** The zoom at which the whole View fits; the ceiling. */
  readonly ceilingZoom: number;
}

/** Pull gained per 100 wheel pixels. A trackpad notch is far smaller than this. */
export const PULL_PER_PX = 1 / 600;
/** Commit to the graph band at this pull. */
export const COMMIT = 0.65;
/** Leave the graph band at this pull — deliberately below `COMMIT`. */
export const RETURN = 0.35;
/** Milliseconds of no input before the pull starts decaying. */
export const RELEASE_AFTER_MS = 260;
/** Pull halves every this many ms once released. */
export const DECAY_MS = 180;
/** The camera keeps this share of its movement at full pull. */
export const MIN_CAMERA_SHARE = 0.15;

export const RESTING_MEMBRANE: MembraneState = Object.freeze({
  pull: 0,
  committed: false,
  lastInputAt: Number.NEGATIVE_INFINITY,
});

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Is the camera close enough to the ceiling to be pushing on it? */
export function atCeiling(zoom: number, ceilingZoom: number): boolean {
  if (!Number.isFinite(zoom) || !Number.isFinite(ceilingZoom) || ceilingZoom <= 0) return false;
  return zoom <= ceilingZoom * 1.001;
}

/** How much of the movement survives the resistance at a given pull. */
export function cameraShare(pull: number): number {
  const p = clamp01(pull);
  return 1 - (1 - MIN_CAMERA_SHARE) * p;
}

/**
 * One input step. `deltaY` is the wheel delta in pixels; a negative delta (zoom
 * in) always unwinds the pull, because the user is moving away from the ceiling.
 */
export function stepMembrane(input: MembraneInput): MembraneResult {
  const { state, now, zoom, ceilingZoom } = input;
  const deltaY = Number.isFinite(input.deltaY) ? input.deltaY : 0;
  const pushing = deltaY > 0 && atCeiling(zoom, ceilingZoom);

  if (!pushing && !state.committed) {
    // Away from the ceiling the membrane is not involved at all.
    if (deltaY < 0 && state.pull > 0) {
      return { state: { ...state, pull: 0, lastInputAt: now }, action: "none", cameraShare: 1 };
    }
    return { state, action: "none", cameraShare: 1 };
  }

  if (state.committed && deltaY < 0) {
    // Zooming in from the graph is the same gesture reversed: it unwinds the
    // pull, and only crossing below RETURN leaves. A single notch must not
    // throw the user back, or a wobbling wheel would flap between the two.
    const pull = clamp01(state.pull + deltaY * PULL_PER_PX);
    if (pull <= RETURN) {
      return {
        state: { pull: 0, committed: false, lastInputAt: now },
        action: "release",
        cameraShare: 1,
      };
    }
    return {
      state: { ...state, pull, lastInputAt: now },
      action: "none",
      cameraShare: cameraShare(pull),
    };
  }

  if (deltaY < 0 && !state.committed) {
    const pull = clamp01(state.pull + deltaY * PULL_PER_PX);
    return {
      state: { ...state, pull, lastInputAt: now },
      action: pull <= RETURN ? "release" : "none",
      cameraShare: 1,
    };
  }

  const pull = clamp01(state.pull + deltaY * PULL_PER_PX);
  if (!state.committed && pull >= COMMIT) {
    return {
      state: { pull: 1, committed: true, lastInputAt: now },
      action: "commit",
      cameraShare: Math.min(cameraShare(pull), MIN_CAMERA_SHARE),
    };
  }
  return {
    state: { ...state, pull, lastInputAt: now },
    action: "none",
    cameraShare: cameraShare(pull),
  };
}

/**
 * The pull while no input arrives: it decays, and a committed graph falls back
 * once it is back under `RETURN`. Call once per frame with the clock; with a
 * negative `now - lastInputAt` (a paused tab) nothing happens.
 */
export function settleMembrane(state: MembraneState, now: number): MembraneResult {
  if (!state.committed && state.pull === 0) return { state, action: "none", cameraShare: 1 };
  const idle = now - state.lastInputAt;
  if (!Number.isFinite(idle) || idle < RELEASE_AFTER_MS) {
    return { state, action: "none", cameraShare: cameraShare(state.pull) };
  }
  const decayed = state.pull * 0.5 ** ((idle - RELEASE_AFTER_MS) / DECAY_MS);
  if (state.committed) {
    if (decayed > RETURN) {
      return {
        state: { ...state, pull: decayed },
        action: "none",
        cameraShare: cameraShare(decayed),
      };
    }
    return {
      state: { pull: 0, committed: false, lastInputAt: state.lastInputAt },
      action: "release",
      cameraShare: 1,
    };
  }
  const pull = decayed < 0.01 ? 0 : decayed;
  return { state: { ...state, pull }, action: "none", cameraShare: cameraShare(pull) };
}
