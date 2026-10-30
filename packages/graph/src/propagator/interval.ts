/**
 * Pure functional interval join-semilattice for continuous spatial constraints.
 *
 * An interval [lo, hi] bounds a coordinate or dimension over the reals.
 * Information grows monotonically via the meet (intersection) operation:
 * intervals narrow until they reach a point [x, x] or a contradiction (lo > hi).
 */

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

export class IntervalContradictionError extends Error {
  readonly left: Interval;
  readonly right: Interval;
  readonly mergedLo: number;
  readonly mergedHi: number;

  constructor(left: Interval, right: Interval, mergedLo: number, mergedHi: number) {
    super(
      `Interval contradiction merging [${left.lo}, ${left.hi}] with [${right.lo}, ${right.hi}] -> [${mergedLo}, ${mergedHi}]`,
    );
    this.name = "IntervalContradictionError";
    this.left = left;
    this.right = right;
    this.mergedLo = mergedLo;
    this.mergedHi = mergedHi;
  }
}

export function createInterval(lo: number, hi: number): Interval {
  return { lo, hi };
}

export function intervalExact(val: number): Interval {
  return { lo: val, hi: val };
}

export function intervalAtLeast(val: number): Interval {
  return { lo: val, hi: Number.POSITIVE_INFINITY };
}

export function intervalAtMost(val: number): Interval {
  return { lo: Number.NEGATIVE_INFINITY, hi: val };
}

export function intervalUnconstrained(): Interval {
  return { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY };
}

export function isContradiction(interval: Interval): boolean {
  return interval.lo > interval.hi;
}

export function isExact(interval: Interval, eps = 1e-9): boolean {
  return (
    Number.isFinite(interval.lo) &&
    Number.isFinite(interval.hi) &&
    Math.abs(interval.hi - interval.lo) <= eps
  );
}

/**
 * Lattice meet (information join): narrowing intersection of two intervals.
 * Throws IntervalContradictionError if lo > hi.
 */
export function intervalMerge(a: Interval, b: Interval): Interval {
  const mergedLo = Math.max(a.lo, b.lo);
  const mergedHi = Math.min(a.hi, b.hi);
  if (mergedLo > mergedHi) {
    throw new IntervalContradictionError(a, b, mergedLo, mergedHi);
  }
  return { lo: mergedLo, hi: mergedHi };
}

/**
 * Interval addition: [a.lo + b.lo, a.hi + b.hi].
 */
export function intervalPlus(a: Interval, b: Interval): Interval {
  return {
    lo: a.lo + b.lo,
    hi: a.hi + b.hi,
  };
}

/**
 * Interval subtraction: a - b = [a.lo - b.hi, a.hi - b.lo].
 */
export function intervalMinus(a: Interval, b: Interval): Interval {
  return {
    lo: a.lo - b.hi,
    hi: a.hi - b.lo,
  };
}

/**
 * Returns true if next interval contains strictly more information (narrower) than current.
 */
export function intervalNarrows(next: Interval, current: Interval, eps = 1e-9): boolean {
  const loNarrows =
    next.lo > current.lo && (next.lo === Number.POSITIVE_INFINITY || next.lo - current.lo > eps);
  const hiNarrows =
    next.hi < current.hi && (next.hi === Number.NEGATIVE_INFINITY || current.hi - next.hi > eps);
  return loNarrows || hiNarrows;
}

export function intervalEquals(a: Interval, b: Interval, eps = 1e-9): boolean {
  const loEq = a.lo === b.lo || Math.abs(a.lo - b.lo) <= eps;
  const hiEq = a.hi === b.hi || Math.abs(a.hi - b.hi) <= eps;
  return loEq && hiEq;
}
