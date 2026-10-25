import type { CanvasMode } from "./linkGesture";

/**
 * Where the next card in a placement run goes, and what it links to
 * ([ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md)).
 *
 * Pure on purpose, like `arrangeCommand.ts`: geometry in, a plan out, no Loro and
 * no React. A run's shape can therefore be unit-tested without a renderer, and a
 * preview (a ghost on the canvas) reads the same function the commit does.
 */

export interface RunBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The numbers Card Settings owns (ADR-0056 amendment). */
export interface PlacementOptions {
  /** Space between placed cards, in flow units. */
  gap: number;
  /** How many cards a `place` run fills before wrapping to a new row. */
  columns: number;
  /** Distance from the origin to a `web` spoke's centre. */
  radius: number;
}

export const DEFAULT_PLACEMENT_OPTIONS: PlacementOptions = {
  gap: 48,
  columns: 3,
  // A ring the floor accepts for a default card (see `planSpokes`), so the number
  // in Card Settings is the number the planner obeys for default sizes.
  radius: 360,
};

/**
 * The golden angle. Spokes spaced by it look evenly distributed at any count —
 * three spokes read as a hub, twelve read as a ring — where a fixed angle either
 * collides at three or leaves a gap at twelve.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** How far a free-spot search will look before it accepts an overlap. */
const MAX_NUDGE_STEPS = 24;

export interface PlacementLinkPlan {
  /** Which box the line starts at: the run's origin, or the previous card. */
  from: "origin" | "anchor";
  /** The side of the new card the line should aim at, so a chain reads as one. */
  to: "left" | "top";
}

export interface PlacementStep {
  position: { x: number; y: number };
  link: PlacementLinkPlan | null;
}

export interface PlanPlacementInput {
  mode: CanvasMode;
  /** Which card of the run this is: 0 is the first, and is never linked. */
  index: number;
  /** The size of the card about to be placed. */
  size: { width: number; height: number };
  /** The run's first placement, once there is one. */
  origin: RunBox | null;
  /** The most recent placement of this run, once there is one. */
  anchor: RunBox | null;
  /** Where the first card of a run should sit when the caller has no point. */
  start: { x: number; y: number };
  /** Every box already on the board, so a placement never lands on a card. */
  occupied: readonly RunBox[];
  options?: PlacementOptions | undefined;
}

/** True when two boxes overlap, with a `slack` margin made optional by the caller. */
export function boxesOverlap(left: RunBox, right: RunBox): boolean {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

function centreOf(box: RunBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Pushes a candidate down-right until it is clear of every occupied box.
 *
 * A run must never look like it dropped cards on top of existing ones, so the
 * search exists for *existing* cards only: the boxes this run placed are free by
 * construction, and the caller passes only what was on the board before it.
 * Bounded, because "no free spot" has to end somewhere — and because a run of
 * forty cards in a corner should still place the fortieth.
 */
function freeSpot(
  candidate: RunBox,
  occupied: readonly RunBox[],
  step: number,
): { x: number; y: number } {
  let box = candidate;
  for (let attempt = 0; attempt < MAX_NUDGE_STEPS; attempt += 1) {
    if (!occupied.some((other) => boxesOverlap(box, other))) {
      return { x: box.x, y: box.y };
    }
    box = { ...box, x: box.x + step, y: box.y + step };
  }
  return { x: box.x, y: box.y };
}

/** Anchors a box so its centre sits at `point`, which is what "place here" means. */
function centredAt(point: { x: number; y: number }, size: { width: number; height: number }) {
  return { x: point.x - size.width / 2, y: point.y - size.height / 2 };
}

/**
 * `place`: a grid that fills `columns` before wrapping. The grid is laid out from
 * the run's **origin**, not from the previous card: a dump is a rectangle, and a
 * grid measured from the last card would walk diagonally off the board.
 */
function planGrid(input: PlanPlacementInput, options: PlacementOptions): { x: number; y: number } {
  const { index, size, origin, start } = input;
  const base = origin ?? { ...start, width: size.width, height: size.height };
  const columnStep = size.width + options.gap;
  const rowStep = size.height + options.gap;
  const column = index % options.columns;
  const row = Math.floor(index / options.columns);
  return {
    x: base.x + column * columnStep,
    y: base.y + row * rowStep,
  };
}

/**
 * `thread`: right of the previous card, vertically centred on it. A chain is the
 * simplest thing a run can draw and the one users reach for first — a sequence
 * of interview notes, a set of steps, a reading order.
 */
function planChain(input: PlanPlacementInput, options: PlacementOptions): { x: number; y: number } {
  const { anchor, start, size } = input;
  if (!anchor) return start;
  return {
    x: anchor.x + anchor.width + options.gap,
    y: anchor.y + (anchor.height - size.height) / 2,
  };
}

/**
 * `web`: spokes on a ring around the origin. The first card is the hub and the
 * rest are placed at the golden angle around it, so the shape reads as "these
 * relate to that one" at any count.
 */
function planSpokes(
  input: PlanPlacementInput,
  options: PlacementOptions,
): { x: number; y: number } {
  const { index, origin, start, size } = input;
  if (!origin) return start;
  // Two boxes overlap while their centres are closer than the sum of their half
  // sizes on both axes, so the floor that guarantees a clear ring is the diagonal
  // of the two cards plus the gap. A configured radius smaller than that is raised
  // rather than obeyed: a spoke lying on the hub is not a smaller web, it is a bug.
  const ring = Math.max(
    options.radius,
    Math.hypot(origin.width + size.width, origin.height + size.height) / 2 + options.gap,
  );
  // Index 1 is the first spoke: keep the first one to the right so the shape has
  // a readable "start", then let the golden angle do the rest.
  const angle = (index - 1) * GOLDEN_ANGLE;
  const centre = centreOf(origin);
  return centredAt(
    { x: centre.x + Math.cos(angle) * ring, y: centre.y + Math.sin(angle) * ring },
    size,
  );
}

/**
 * `pattern`: a mindmap. Each card is a child of the one before it, alternating to
 * the right and the left and one row down, so a run draws a zig-zag of branches
 * rather than a straight chain — which is the reading a set of nested ideas has,
 * and the shape a reader recognises as "these hang off that".
 */
function planBranches(
  input: PlanPlacementInput,
  options: PlacementOptions,
): { x: number; y: number } {
  const { index, anchor, start, size } = input;
  if (!anchor) return start;
  const right = index % 2 === 1;
  return {
    x: right ? anchor.x + anchor.width + options.gap : anchor.x - size.width - options.gap,
    y: anchor.y + anchor.height + options.gap / 2,
  };
}

/**
 * One step of a run: where the card goes, and whether it draws a line back.
 *
 * The first card never links: there is nothing to link to, and a run that opened
 * with a line to a card outside the run would be inventing a relationship.
 */
export function planPlacementStep(input: PlanPlacementInput): PlacementStep {
  const options = input.options ?? DEFAULT_PLACEMENT_OPTIONS;
  const raw = (() => {
    switch (input.mode) {
      case "place":
        return planGrid(input, options);
      case "thread":
        return planChain(input, options);
      case "web":
        return planSpokes(input, options);
      case "pattern":
        return planBranches(input, options);
    }
  })();

  const box: RunBox = { ...raw, width: input.size.width, height: input.size.height };
  const position = freeSpot(box, input.occupied, Math.max(16, options.gap / 2));

  // A dump draws nothing: `place` is the reading whose shape is not a relationship.
  const link: PlacementLinkPlan | null =
    input.mode === "place" || input.index === 0
      ? null
      : input.mode === "pattern"
        ? { from: "anchor", to: "top" }
        : { from: input.mode === "web" ? "origin" : "anchor", to: "left" };

  return { position, link };
}

/** The section a finished run wraps, padded by `padding` around what it placed. */
export function planRunFrame(placed: readonly RunBox[], padding: number): RunBox | null {
  if (placed.length === 0) return null;
  const left = Math.min(...placed.map((box) => box.x));
  const top = Math.min(...placed.map((box) => box.y));
  const right = Math.max(...placed.map((box) => box.x + box.width));
  const bottom = Math.max(...placed.map((box) => box.y + box.height));
  return {
    x: left - padding,
    y: top - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
}
