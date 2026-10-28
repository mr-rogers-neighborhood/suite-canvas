import type { Connector } from "@suite/graph";
import type { CanvasMode } from "./links/linkGesture";

/**
 * Where the next card in a placement run goes, and what it links to
 * (ADR-0063).
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
  /** Distance from the origin to a `fan` spoke's centre. */
  radius: number;
  /** Padding a run's wrapping section keeps around what it placed. */
  sectionPadding: number;
}

export const DEFAULT_PLACEMENT_OPTIONS: PlacementOptions = {
  gap: 48,
  columns: 3,
  // A ring the floor accepts for a default card (see `planSpokes`), so the number
  // in Card Settings is the number the planner obeys for default sizes.
  radius: 360,
  sectionPadding: 32,
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
  /** Which box the line starts at: the run's hub, or the card placed before this one. */
  from: "origin" | "anchor";
}

export interface PlacementStep {
  position: { x: number; y: number };
  link: PlacementLinkPlan | null;
}

export interface PlanPlacementInput {
  /** The run's shape, fixed when it started. */
  shape: CanvasMode;
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
 * `fan`: spokes on a ring around the origin. The first card is the hub and the
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
  // rather than obeyed: a spoke lying on the hub is not a smaller fan, it is a bug.
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
 * One step of a run: where the card goes, and whether it draws a line back.
 *
 * The first card never links: there is nothing to link to, and a run that opened
 * with a line to a card outside the run would be inventing a relationship.
 */
export function planPlacementStep(input: PlanPlacementInput): PlacementStep {
  const options = input.options ?? DEFAULT_PLACEMENT_OPTIONS;
  const raw = (() => {
    switch (input.shape) {
      case "place":
        return planGrid(input, options);
      case "thread":
        return planChain(input, options);
      case "fan":
        return planSpokes(input, options);
    }
  })();

  const box: RunBox = { ...raw, width: input.size.width, height: input.size.height };
  const position = freeSpot(box, input.occupied, Math.max(16, options.gap / 2));

  // One rule for every shape, and it is the whole difference between them: `place`
  // draws nothing, `thread` continues from the card placed before this one, and
  // `fan` returns to the hub. Absent means the box to link from does not exist yet,
  // which is the first card of a run rather than a special case.
  const link: PlacementLinkPlan | null =
    input.shape === "place"
      ? null
      : input.shape === "fan"
        ? input.origin === null
          ? null
          : { from: "origin" }
        : input.anchor === null
          ? null
          : { from: "anchor" };

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

/** Where a link should leave or arrive, in perimeter fractions. */
const FACING = {
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
} as const;

/** A card's box in flow units, which is all the geometry below needs. */
export interface FacingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The connector on `box` that faces `toward`, chosen by direction rather than by
 * compass side.
 *
 * The old helper asked for a literal `"right"` or `"left"`, which is why a fan that
 * spreads upward still linked out of the right edge: the side was decided when the
 * link was planned, before the card was placed. Choosing by *direction* fixes that
 * for every mode at once — a card threaded above its anchor leaves the top, a spoke
 * placed below-right arrives on its own top-left, and no mode needs its own rule.
 *
 * Two details make it behave like a person would:
 *
 * - **The dominant direction wins**, so a spoke at 70° still reads as "above" rather
 *   than as "slightly right"; the comparison is on the axis with the larger offset.
 * - **Ties go vertical.** A card placed exactly diagonally (equal offset on both
 *   axes) is more often "above" or "below" in practice, and vertical dots are the
 *   ones a reader can tell apart at a glance.
 *
 * Returns `undefined` only when the card has no connectors at all, which the caller
 * already treats as "link without naming a dot".
 */
export function connectorToward(
  connectors: readonly Connector[],
  box: FacingBox,
  toward: { x: number; y: number },
): Connector | undefined {
  if (connectors.length === 0) return undefined;

  // Offset from the box's centre to the thing we are facing.
  const dx = toward.x - (box.x + box.width / 2);
  const dy = toward.y - (box.y + box.height / 2);
  const side: keyof typeof FACING =
    Math.abs(dy) >= Math.abs(dx) ? (dy >= 0 ? "bottom" : "top") : dx >= 0 ? "right" : "left";

  return connectorFacing(connectors, side);
}

/**
 * A dot's point in flow space: the fraction it sits at, times the box it belongs to.
 *
 * The arrival end has to be aimed at a *point*, not at an id: the dot it should face
 * is the one the line leaves, which is somewhere on the source's perimeter.
 */
export function dotPoint(box: FacingBox, dot: Connector): { x: number; y: number } {
  return { x: box.x + dot.x * box.width, y: box.y + dot.y * box.height };
}

/** The two dots a step would link through, or nulls when the card has none. */
export interface InferredConnectors {
  source: Connector | null;
  target: Connector | null;
}

/**
 * The dots a placement *would* use, without placing anything.
 *
 * This exists so the preview and the commit cannot disagree (ADR-0061 third
 * amendment): the engine calls it to write the edge, and the held-stack cursor calls
 * it to highlight the dot under the pointer before the reader commits. Two copies of
 * "which dot" would eventually pick differently, and the failure would look like the
 * app changing its mind at the last moment.
 *
 * `overrides` is how the reader disposes: a dot they picked by hand wins over the
 * geometric proposal for that step, and only that step.
 */
export function inferConnectors(input: {
  sourceDots: readonly Connector[];
  targetDots: readonly Connector[];
  sourceBox: FacingBox;
  targetBox: FacingBox;
  overrides?: { source?: string | null; target?: string | null };
  /**
   * Where the line leaves the source, when the caller already knows.
   *
   * Omitted is the normal case: the chosen source dot is computed first, and its
   * own point becomes the reference. Pass it to override that, which is what a
   * preview following the pointer does.
   */
  sourceAnchor?: { x: number; y: number } | null;
}): InferredConnectors {
  const pick = (dots: readonly Connector[], chosen: string | null | undefined): Connector | null =>
    chosen === null || chosen === undefined
      ? null
      : (dots.find((dot) => dot.id === chosen) ?? null);

  const sourceCentre = {
    x: input.sourceBox.x + input.sourceBox.width / 2,
    y: input.sourceBox.y + input.sourceBox.height / 2,
  };
  const targetCentre = {
    x: input.targetBox.x + input.targetBox.width / 2,
    y: input.targetBox.y + input.targetBox.height / 2,
  };

  const source =
    pick(input.sourceDots, input.overrides?.source) ??
    connectorToward(input.sourceDots, input.sourceBox, targetCentre) ??
    null;
  // The arrival dot faces where the line actually leaves, which is the chosen dot's
  // own point rather than the card's centre. That is what makes a starburst read as
  // one: every spoke leaves the side facing it and lands on the dot opposite.
  const departure =
    input.sourceAnchor ?? (source === null ? sourceCentre : dotPoint(input.sourceBox, source));

  return {
    source,
    target:
      pick(input.targetDots, input.overrides?.target) ??
      connectorToward(input.targetDots, input.targetBox, departure) ??
      null,
  };
}

/**
 * The connector nearest one side of a card, so a run's links leave and arrive on
 * the sides that face each other.
 *
 * A gap has to be a gap: linking from the right dot to another right dot draws a
 * line that loops around the card, which reads as a mistake rather than a chain.
 * Cards keep four side connectors by default, but a user may move or delete them,
 * so this is "nearest" rather than "the one at exactly (1, 0.5)".
 */
export function connectorFacing(
  connectors: readonly Connector[],
  side: keyof typeof FACING,
): Connector | undefined {
  const target = FACING[side];
  let best: Connector | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const connector of connectors) {
    const distance = (connector.x - target.x) ** 2 + (connector.y - target.y) ** 2;
    if (distance < bestDistance) {
      best = connector;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The offsets one step's set fills, relative to the step's own position.
 *
 * A step is placed as a unit: its first card takes the step's position and the
 * rest fill a small grid beside it, so a set reads as one thing the run moved
 * rather than as N unrelated placements. A set with real geometry (a section and
 * the cards inside it) is handled by the caller, which knows the section — this is
 * the fallback for cards that have none.
 */
export function planSetOffsets(
  count: number,
  size: { width: number; height: number },
  options: PlacementOptions = DEFAULT_PLACEMENT_OPTIONS,
): Array<{ x: number; y: number }> {
  const columns = Math.max(1, Math.min(count, options.columns));
  return Array.from({ length: count }, (_, index) => ({
    x: (index % columns) * (size.width + options.gap),
    y: Math.floor(index / columns) * (size.height + options.gap),
  }));
}
