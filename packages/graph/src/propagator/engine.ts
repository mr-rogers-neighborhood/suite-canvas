/**
 * Pure functional fixed-point solver (quiescence engine) for propagator networks.
 *
 * Repeatedly applies propagators in sequence until the state reaches quiescence
 * (a mathematical fixed point where F(state) == state) or encounters a contradiction.
 */

import {
  type Interval,
  IntervalContradictionError,
  intervalEquals,
  intervalMerge,
  intervalUnconstrained,
} from "./interval.js";

export type TissueState = ReadonlyMap<string, Interval>;

export type Propagator = (state: TissueState) => TissueState;

export interface SolveSuccess {
  readonly type: "success";
  readonly tissue: TissueState;
  readonly steps: number;
}

export interface SolveInconsistent {
  readonly type: "inconsistent";
  readonly conflict: string;
}

export interface SolveStepLimit {
  readonly type: "stepLimit";
  readonly steps: number;
  readonly limit: number;
}

export type SolveResult = SolveSuccess | SolveInconsistent | SolveStepLimit;

/**
 * Pure function: return a new TissueState with interval merged into cell.
 */
export function inject(state: TissueState, cell: string, interval: Interval): TissueState {
  const current = state.get(cell) ?? intervalUnconstrained();
  const merged = intervalMerge(current, interval);
  const next = new Map(state);
  next.set(cell, merged);
  return next;
}

/**
 * Slices the global tissue down to ONLY the cells in the declared footprint.
 * Enforces the "Curtains Closed" privacy rule: deciders cannot snoop on foreign cells.
 */
export function projectTissue(tissue: TissueState, footprint: ReadonlySet<string>): TissueState {
  const projected = new Map<string, Interval>();
  for (const cell of footprint) {
    const val = tissue.get(cell);
    if (val !== undefined) {
      projected.set(cell, val);
    }
  }
  return projected;
}

/**
 * Compares two tissue states for equality within float tolerance.
 */
export function tissueEquals(a: TissueState, b: TissueState, eps = 1e-9): boolean {
  if (a.size !== b.size) return false;
  for (const [key, valA] of a) {
    const valB = b.get(key);
    if (!valB || !intervalEquals(valA, valB, eps)) return false;
  }
  return true;
}

/**
 * Pure fixed-point solver for propagator networks with structured error reporting.
 */
export function settle(
  state: TissueState,
  propagators: readonly Propagator[],
  maxSteps?: number,
): SolveResult {
  let current = state;
  const limit = maxSteps ?? Math.max(50, 2 * state.size * Math.max(1, propagators.length));

  for (let step = 1; step <= limit; step += 1) {
    const prev = current;
    try {
      for (const prop of propagators) {
        current = prop(current);
      }
    } catch (err) {
      if (err instanceof IntervalContradictionError) {
        return { type: "inconsistent", conflict: err.message };
      }
      throw err;
    }

    if (tissueEquals(current, prev)) {
      return { type: "success", tissue: current, steps: step };
    }
  }

  return { type: "stepLimit", steps: limit, limit };
}
