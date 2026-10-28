import { refreshEstimate, type StorageEstimate } from "./durability";

/**
 * How full this origin is, and how loudly to say so.
 *
 * The estimate was read at boot and when the storage panel opened, which answers "how
 * much is there" and never "is this about to be cleared". A workspace grows towards the
 * quota while somebody works, so this samples as it grows and turns the ratio into two
 * thresholds that the toast and the panel can both read.
 */

/** The two points worth interrupting at, as a share of the quota. */
export const FILL_THRESHOLDS = { low: 0.7, critical: 0.9 } as const;

export type FillStage = "fine" | "low" | "critical";

/** The order the stages escalate in, so a reader is told once per crossing. */
export const FILL_RANK: Record<FillStage, number> = { fine: 0, low: 1, critical: 2 };

/** Used share of the quota, or null when the browser will not say or the numbers are nonsense. */
export function fillRatio(estimate: Pick<StorageEstimate, "usage" | "quota">): number | null {
  const { usage, quota } = estimate;
  if (typeof usage !== "number" || typeof quota !== "number") return null;
  if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return null;
  return Math.min(1, Math.max(0, usage / quota));
}

export function fillStage(ratio: number | null): FillStage {
  if (ratio === null) return "fine";
  if (ratio >= FILL_THRESHOLDS.critical) return "critical";
  if (ratio >= FILL_THRESHOLDS.low) return "low";
  return "fine";
}

/**
 * The percentage the copy prints. Clamped below 100, because an estimate that rounds to
 * a full disk while the next write succeeds reads as a broken warning.
 */
export function fillPercent(ratio: number): number {
  return Math.min(99, Math.max(1, Math.round(ratio * 100)));
}

export interface EstimateSampler {
  /** Asks for a fresh estimate, at most once per interval. */
  note: () => void;
}

/**
 * A leading-edge throttle.
 *
 * A document fires a local update per keystroke, and `navigator.storage.estimate()` is a
 * real measurement rather than a cheap read, so the first note measures and the next
 * thirty seconds of notes do not. No timer runs between them: nothing needs asking until
 * something has changed.
 */
export function createEstimateSampler(
  args: { refresh?: () => Promise<unknown>; interval?: number; now?: () => number } = {},
): EstimateSampler {
  const refresh = args.refresh ?? refreshEstimate;
  const interval = args.interval ?? 30_000;
  const now = args.now ?? Date.now;
  let last = Number.NEGATIVE_INFINITY;
  return {
    note: () => {
      const at = now();
      if (at - last < interval) return;
      last = at;
      void refresh();
    },
  };
}
