/**
 * Spatial and geometric propagators as pure state transformers: TissueState -> TissueState.
 */

import type { Propagator, TissueState } from "./engine.js";
import {
  createInterval,
  type Interval,
  intervalAtLeast,
  intervalAtMost,
  intervalEquals,
  intervalExact,
  intervalMerge,
  intervalMinus,
  intervalPlus,
  intervalUnconstrained,
} from "./interval.js";

/**
 * Monotonic spatial separation constraint.
 * For direction "+": pushes towards +infinity: pushed.lo >= reference.lo + dimension + gap.
 * For direction "-": pushes towards -infinity: pushed.hi <= reference.lo - dimension - gap.
 */
export function separationConstraint(
  referenceCell: string,
  pushedCell: string,
  directionOrDim?: "+" | "-" | number,
  dimensionOrGap = 0,
  maybeGap = 0,
): Propagator {
  let direction: "+" | "-" = "+";
  let dimension = 0;
  let gap = 0;

  if (typeof directionOrDim === "string") {
    direction = directionOrDim;
    dimension = dimensionOrGap;
    gap = maybeGap;
  } else {
    direction = "+";
    dimension = directionOrDim ?? 0;
    gap = dimensionOrGap;
  }

  return (state: TissueState): TissueState => {
    const refVal = state.get(referenceCell) ?? intervalUnconstrained();
    const pushedVal = state.get(pushedCell) ?? intervalUnconstrained();

    // The reference coordinate is the effective position of the reference cell.
    // If refVal.lo is finite, that is its position (pinned or pushed +).
    // If refVal.lo is -Infinity (pushed -), its upper bound refVal.hi is its position.
    const refPos = Number.isFinite(refVal.lo) ? refVal.lo : refVal.hi;
    if (!Number.isFinite(refPos)) return state;

    if (direction === "+") {
      const minPushed = refPos + dimension + gap;
      if (pushedVal.lo < minPushed) {
        const newPushed = intervalMerge(pushedVal, intervalAtLeast(minPushed));
        if (!intervalEquals(newPushed, pushedVal)) {
          const next = new Map(state);
          next.set(pushedCell, newPushed);
          return next;
        }
      }
    } else {
      const maxPushed = refPos - dimension - gap;
      if (pushedVal.hi > maxPushed) {
        const newPushed = intervalMerge(pushedVal, intervalAtMost(maxPushed));
        if (!intervalEquals(newPushed, pushedVal)) {
          const next = new Map(state);
          next.set(pushedCell, newPushed);
          return next;
        }
      }
    }
    return state;
  };
}

/**
 * Rigid spatial pin: forces cell to exact coordinate [coord, coord].
 * Guarantees zero-drift for stationary cards outside of a collision wave.
 */
export function pinConstraint(cell: string, coord: number): Propagator {
  const pinned = intervalExact(coord);
  return (state: TissueState): TissueState => {
    const current = state.get(cell) ?? intervalUnconstrained();
    const merged = intervalMerge(current, pinned);
    if (!intervalEquals(merged, current)) {
      const next = new Map(state);
      next.set(cell, merged);
      return next;
    }
    return state;
  };
}

/**
 * Clamps or narrows a cell within [lo, hi].
 */
export function boundsConstraint(
  cell: string,
  lo = Number.NEGATIVE_INFINITY,
  hi = Number.POSITIVE_INFINITY,
): Propagator {
  const bounds = createInterval(lo, hi);
  return (state: TissueState): TissueState => {
    const current = state.get(cell) ?? intervalUnconstrained();
    const merged = intervalMerge(current, bounds);
    if (!intervalEquals(merged, current)) {
      const next = new Map(state);
      next.set(cell, merged);
      return next;
    }
    return state;
  };
}

/**
 * Multi-directional sum relation: A + B = C.
 * Deduces:
 * - C = A + B
 * - A = C - B
 * - B = C - A
 */
export function sumConstraint(a: string, b: string, c: string): Propagator {
  return (state: TissueState): TissueState => {
    const valA = state.get(a) ?? intervalUnconstrained();
    const valB = state.get(b) ?? intervalUnconstrained();
    const valC = state.get(c) ?? intervalUnconstrained();

    const impliedC = intervalPlus(valA, valB);
    const newC = intervalMerge(valC, impliedC);

    const impliedA = intervalMinus(valC, valB);
    const newA = intervalMerge(valA, impliedA);

    const impliedB = intervalMinus(valC, valA);
    const newB = intervalMerge(valB, impliedB);

    if (!intervalEquals(newA, valA) || !intervalEquals(newB, valB) || !intervalEquals(newC, valC)) {
      const next = new Map(state);
      next.set(a, newA);
      next.set(b, newB);
      next.set(c, newC);
      return next;
    }
    return state;
  };
}

/**
 * Section container enclosure constraint:
 * Ensures the section bounds comfortably contain child cards with padding.
 * - sectionMax >= childMax + padding
 * - sectionMin <= childMin - padding
 */
export function enclosureConstraint(
  sectionMinCell: string,
  sectionMaxCell: string,
  childMinCell: string,
  childMaxCell: string,
  padding = 24,
): Propagator {
  return (state: TissueState): TissueState => {
    const sMin = state.get(sectionMinCell) ?? intervalUnconstrained();
    const sMax = state.get(sectionMaxCell) ?? intervalUnconstrained();
    const cMin = state.get(childMinCell) ?? intervalUnconstrained();
    const cMax = state.get(childMaxCell) ?? intervalUnconstrained();

    const minSMax = cMax.lo + padding;
    const maxSMin = cMin.hi - padding;

    let next: Map<string, Interval> | null = null;

    if (sMax.lo < minSMax) {
      const newMax = intervalMerge(sMax, intervalAtLeast(minSMax));
      if (!intervalEquals(newMax, sMax)) {
        next = next ?? new Map(state);
        next.set(sectionMaxCell, newMax);
      }
    }

    if (sMin.hi > maxSMin && Number.isFinite(maxSMin)) {
      const newMin = intervalMerge(sMin, intervalAtMost(maxSMin));
      if (!intervalEquals(newMin, sMin)) {
        next = next ?? new Map(state);
        next.set(sectionMinCell, newMin);
      }
    }

    return next ?? state;
  };
}
