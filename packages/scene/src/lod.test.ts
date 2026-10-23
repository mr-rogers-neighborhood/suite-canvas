import { describe, expect, it } from "vitest";
import {
  bandForScale,
  DEFAULT_LOD_CONFIG,
  isLodDowngrade,
  isLodUpgrade,
  isLodVisible,
  lodThresholds,
  resolveLod,
} from "./lod.js";
import type { LodConfig, LodState } from "./types.js";

const state = (band: LodState["band"], extra: Partial<LodState> = {}): LodState => ({
  band,
  pendingBand: null,
  pendingSinceMs: null,
  ...extra,
});

describe("bandForScale", () => {
  it("should map the plan bands", () => {
    expect(bandForScale(0.9, DEFAULT_LOD_CONFIG.thresholds)).toBe("full");
    expect(bandForScale(0.75, DEFAULT_LOD_CONFIG.thresholds)).toBe("full");
    expect(bandForScale(0.5, DEFAULT_LOD_CONFIG.thresholds)).toBe("compact");
    expect(bandForScale(0.35, DEFAULT_LOD_CONFIG.thresholds)).toBe("compact");
    expect(bandForScale(0.2, DEFAULT_LOD_CONFIG.thresholds)).toBe("icon");
    expect(bandForScale(0.119, DEFAULT_LOD_CONFIG.thresholds)).toBe("hidden");
    expect(bandForScale(0, DEFAULT_LOD_CONFIG.thresholds)).toBe("hidden");
    expect(bandForScale(Number.NaN, DEFAULT_LOD_CONFIG.thresholds)).toBe("hidden");
  });
});

describe("band ranking", () => {
  it("should order bands by detail", () => {
    expect(isLodUpgrade("compact", "full")).toBe(true);
    expect(isLodDowngrade("full", "compact")).toBe(true);
    expect(isLodUpgrade("full", "compact")).toBe(false);
    expect(isLodVisible("icon")).toBe(true);
    expect(isLodVisible("hidden")).toBe(false);
  });
});

describe("resolveLod", () => {
  it("should resolve a first frame without hysteresis", () => {
    expect(resolveLod(undefined, 0.8, 0, DEFAULT_LOD_CONFIG)).toEqual(state("full"));
  });

  it("should downgrade immediately", () => {
    expect(resolveLod(state("full"), 0.4, 1000, DEFAULT_LOD_CONFIG)).toEqual(state("compact"));
  });

  it("should hold a pending upgrade until the dwell elapses", () => {
    const pending = resolveLod(state("compact"), 0.9, 1000, DEFAULT_LOD_CONFIG);
    expect(pending).toEqual(state("compact", { pendingBand: "full", pendingSinceMs: 1000 }));
    expect(resolveLod(pending, 0.9, 1079, DEFAULT_LOD_CONFIG)).toEqual(pending);
    expect(resolveLod(pending, 0.9, 1080, DEFAULT_LOD_CONFIG)).toEqual(state("full"));
  });

  it("should restart the dwell when the upgrade target changes", () => {
    const pendingCompact = state("icon", { pendingBand: "compact", pendingSinceMs: 1000 });
    const retargeted = resolveLod(pendingCompact, 0.9, 1050, DEFAULT_LOD_CONFIG);
    expect(retargeted).toEqual(state("icon", { pendingBand: "full", pendingSinceMs: 1050 }));
  });

  it("should clear the pending upgrade when the band holds", () => {
    const pending = state("compact", { pendingBand: "full", pendingSinceMs: 1000 });
    expect(resolveLod(pending, 0.5, 1010, DEFAULT_LOD_CONFIG)).toEqual(state("compact"));
  });

  it("should upgrade at once when the dwell is zero", () => {
    const config: LodConfig = { thresholds: DEFAULT_LOD_CONFIG.thresholds, dwellMs: 0 };
    expect(resolveLod(state("compact"), 0.9, 5000, config)).toEqual(state("full"));
  });

  it("should apply per-type overrides", () => {
    const config: LodConfig = {
      thresholds: { full: 0.75, compact: 0.35, icon: 0.12 },
      dwellMs: 0,
      overrides: { portal: { full: 0.5, compact: 0.2, icon: 0.05 } },
    };
    expect(lodThresholds(config, "portal")).toEqual({ full: 0.5, compact: 0.2, icon: 0.05 });
    expect(lodThresholds(config, "card")).toEqual(config.thresholds);
    expect(bandForScale(0.6, lodThresholds(config, "portal"))).toBe("full");
    expect(bandForScale(0.6, lodThresholds(config, "card"))).toBe("compact");
  });

  it("should merge partial overrides over the shared thresholds", () => {
    const config: LodConfig = {
      thresholds: { full: 0.75, compact: 0.35, icon: 0.12 },
      dwellMs: 80,
      overrides: { edge: { full: 1.5 } },
    };
    expect(lodThresholds(config, "edge")).toEqual({ full: 1.5, compact: 0.35, icon: 0.12 });
  });
});
