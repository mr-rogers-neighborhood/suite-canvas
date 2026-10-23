import type { LodBand, LodConfig, LodKind, LodState, LodThresholds } from "./types.js";

export const LOD_BANDS: readonly LodBand[] = ["hidden", "icon", "compact", "full"];

/** Plan defaults: ≥0.75 full, ≥0.35 compact, ≥0.12 icon, below hidden. */
export const DEFAULT_LOD_THRESHOLDS: LodThresholds = { full: 0.75, compact: 0.35, icon: 0.12 };

export const DEFAULT_LOD_CONFIG: LodConfig = {
  thresholds: DEFAULT_LOD_THRESHOLDS,
  dwellMs: 80,
};

const BAND_RANK: Readonly<Record<LodBand, number>> = {
  hidden: 0,
  icon: 1,
  compact: 2,
  full: 3,
};

export function lodRank(band: LodBand): number {
  return BAND_RANK[band];
}

/** Hidden instances are kept in the scene; surfaces decide whether to render. */
export function isLodVisible(band: LodBand): boolean {
  return band !== "hidden";
}

export function isLodUpgrade(from: LodBand, to: LodBand): boolean {
  return BAND_RANK[to] > BAND_RANK[from];
}

export function isLodDowngrade(from: LodBand, to: LodBand): boolean {
  return BAND_RANK[to] < BAND_RANK[from];
}

/** Merge a per-type override over the shared thresholds. */
export function lodThresholds(config: LodConfig, kind: LodKind = "card"): LodThresholds {
  const override = config.overrides?.[kind];
  if (!override) return config.thresholds;
  return {
    full: override.full ?? config.thresholds.full,
    compact: override.compact ?? config.thresholds.compact,
    icon: override.icon ?? config.thresholds.icon,
  };
}

/** The continuous band for a scale; no hysteresis, no memory. */
export function bandForScale(scale: number, thresholds: LodThresholds): LodBand {
  if (!Number.isFinite(scale) || scale <= 0) return "hidden";
  if (scale >= thresholds.full) return "full";
  if (scale >= thresholds.compact) return "compact";
  if (scale >= thresholds.icon) return "icon";
  return "hidden";
}

/**
 * Downgrades apply immediately; upgrades wait for the higher threshold and a
 * dwell time so a camera wobbling on a boundary cannot flicker faces.
 */
export function resolveLod(
  previousState: LodState | undefined,
  effectiveScale: number,
  nowMs: number,
  config: LodConfig,
  kind: LodKind = "card",
): LodState {
  const target = bandForScale(effectiveScale, lodThresholds(config, kind));
  if (!previousState) return { band: target, pendingBand: null, pendingSinceMs: null };
  if (target === previousState.band) {
    return { band: target, pendingBand: null, pendingSinceMs: null };
  }
  if (isLodDowngrade(previousState.band, target)) {
    return { band: target, pendingBand: null, pendingSinceMs: null };
  }
  const dwellMs = Math.max(0, config.dwellMs);
  const pendingSince = previousState.pendingBand === target ? previousState.pendingSinceMs : null;
  if (dwellMs === 0) return { band: target, pendingBand: null, pendingSinceMs: null };
  if (pendingSince === null) {
    return {
      band: previousState.band,
      pendingBand: target,
      pendingSinceMs: nowMs,
    };
  }
  if (nowMs - pendingSince >= dwellMs) {
    return { band: target, pendingBand: null, pendingSinceMs: null };
  }
  return {
    band: previousState.band,
    pendingBand: target,
    pendingSinceMs: pendingSince,
  };
}

/** Convenience for surfaces that only need the band of one frame. */
export function lodBand(
  effectiveScale: number,
  config: LodConfig = DEFAULT_LOD_CONFIG,
  kind: LodKind = "card",
): LodBand {
  return bandForScale(effectiveScale, lodThresholds(config, kind));
}
