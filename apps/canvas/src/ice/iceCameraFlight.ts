/**
 * Camera flights: navigation is movement, never teleporting (ADR-0037).
 *
 * The canvas has one way to get somewhere — the camera travels there. A fixed
 * transition time makes a workspace-wide jump feel like a cut and a one-card hop
 * feel sluggish, so a flight's duration is derived from how far it actually has
 * to go:
 *
 * - **pan** contributes screen-pixels travelled at the destination zoom, so a
 *   move across a board is measured against what the user will see, not against
 *   world units that mean different things at different zooms;
 * - **zoom** contributes the log2 ratio, because 1x → 2x and 2x → 4x are the
 *   same perceptual step (the same reason LOD bands are powers of two).
 *
 * Both are clamped, so a tiny adjustment still takes a visible moment and a
 * 40-screen journey does not take a minute. The camera is interpolated with an
 * ease-in-out so the start and end are gentle and the middle carries the speed.
 *
 * This module is pure: a plan and a sample at a time. The surface owns the
 * animation frame loop and the engine write.
 */

/** A camera as the rest of the surface passes it around (`screen = (world - cam) * zoom`). */
export interface FlightCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The viewport the flight is measured against, CSS px. */
export interface FlightViewport {
  readonly width: number;
  readonly height: number;
}

export interface FlightPlan {
  readonly from: FlightCamera;
  readonly to: FlightCamera;
  /** Total travel in screen px at the destination zoom (pan only). */
  readonly panPx: number;
  /** Absolute log2 of the zoom ratio (zoom only). */
  readonly zoomSteps: number;
  readonly durationMs: number;
  /** False when there is nothing to animate. */
  readonly moving: boolean;
}

const MIN_MS = 220;
const MAX_MS = 2400;
/** Milliseconds per screen pixel travelled. */
const MS_PER_PX = 0.55;
/** Milliseconds per doubling or halving of the zoom. */
const MS_PER_STEP = 420;

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function usable(camera: FlightCamera | null | undefined): camera is FlightCamera {
  return (
    camera !== null &&
    camera !== undefined &&
    finite(camera.x) &&
    finite(camera.y) &&
    finite(camera.zoom) &&
    camera.zoom > 0
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The world point at the viewport's top-left corner. With
 * `screen = (world - cam) * zoom`, screen 0 is `world = cam / zoom`.
 */
function topLeftWorld(camera: FlightCamera): { x: number; y: number } {
  return { x: camera.x / camera.zoom, y: camera.y / camera.zoom };
}

export interface FlightOptions {
  /** Extra milliseconds added to every flight (a deliberate, calm default). */
  readonly extraMs?: number | undefined;
  readonly minMs?: number | undefined;
  readonly maxMs?: number | undefined;
}

/**
 * Plan a flight. An unusable camera resolves to a still plan at the other end
 * rather than throwing: a camera can legitimately be missing for a frame while
 * the engine boots, and navigation must not crash on it.
 */
export function planFlight(
  from: FlightCamera | null | undefined,
  to: FlightCamera | null | undefined,
  viewport: FlightViewport | null | undefined,
  options: FlightOptions = {},
): FlightPlan {
  const minMs = options.minMs ?? MIN_MS;
  const maxMs = options.maxMs ?? MAX_MS;
  const extraMs = options.extraMs ?? 0;
  const still: FlightPlan = {
    from: usable(from) ? from : { x: 0, y: 0, zoom: 1 },
    to: usable(to) ? to : { x: 0, y: 0, zoom: 1 },
    panPx: 0,
    zoomSteps: 0,
    durationMs: 0,
    moving: false,
  };
  if (!usable(from) || !usable(to)) return still;

  const start = topLeftWorld(from);
  const end = topLeftWorld(to);
  // Measure the pan at the destination zoom: that is the scale the user lands
  // on, so equal screen distances feel equal regardless of where they started.
  const pan = Math.hypot(end.x - start.x, end.y - start.y) * to.zoom;
  const zoomSteps = Math.abs(Math.log2(to.zoom / from.zoom));
  // The viewport decides what counts as movement at all: a nudge under 1% of
  // the smaller side, with no zoom change, is not a flight.
  const threshold =
    viewport !== null &&
    viewport !== undefined &&
    finite(viewport.width) &&
    finite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
      ? Math.max(1, Math.min(viewport.width, viewport.height) * 0.01)
      : 0.5;
  const moving = pan > threshold || zoomSteps > 1e-3;
  if (!moving) return { ...still, from, to };

  const raw = extraMs + pan * MS_PER_PX + zoomSteps * MS_PER_STEP;
  return {
    from,
    to,
    panPx: pan,
    zoomSteps,
    durationMs: clamp(raw, minMs, Math.max(minMs, maxMs)),
    moving: true,
  };
}

/** Classic ease-in-out cubic: gentle departure, gentle arrival. */
export function easeInOut(t: number): number {
  if (!finite(t)) return 0;
  const clamped = clamp(t, 0, 1);
  return clamped < 0.5 ? 4 * clamped * clamped * clamped : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/**
 * The camera at `elapsedMs` into the flight. Zoom interpolates geometrically —
 * halfway through a 1x → 4x flight is 2x, not 2.5x — so the perceived speed is
 * constant, matching how the duration was measured.
 */
export function sampleFlight(plan: FlightPlan, elapsedMs: number): FlightCamera {
  if (!plan.moving || plan.durationMs <= 0) return plan.to;
  const progress = easeInOut(elapsedMs / plan.durationMs);
  if (progress <= 0) return plan.from;
  if (progress >= 1) return plan.to;
  const logFrom = Math.log2(plan.from.zoom);
  const logTo = Math.log2(plan.to.zoom);
  const zoom = 2 ** (logFrom + (logTo - logFrom) * progress);
  const start = topLeftWorld(plan.from);
  const end = topLeftWorld(plan.to);
  const worldX = start.x + (end.x - start.x) * progress;
  const worldY = start.y + (end.y - start.y) * progress;
  return { x: worldX * zoom, y: worldY * zoom, zoom };
}

/** Has the flight finished at this elapsed time? */
export function flightDone(plan: FlightPlan, elapsedMs: number): boolean {
  return !plan.moving || elapsedMs >= plan.durationMs;
}
