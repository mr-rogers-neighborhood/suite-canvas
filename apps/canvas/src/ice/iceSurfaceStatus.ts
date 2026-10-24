/**
 * The desk's state, as the HUD reports it.
 *
 * The preflight (`navigator.gpu` → adapter → device), the phase the surface is
 * in, and the diagnostics text the Copy button writes. Plain values only: a
 * lost device must not invalidate what the HUD already knows, and nothing here
 * imports React or the desk.
 */

import type { CanvasEngine } from "@vibecook/ice";
import type { DeskLayerFactory, DeskLayerStatus } from "@vibecook/ice/desk";
import type { Desk as IceDesk, EngineProvider as IceEngineProvider } from "@vibecook/ice/react";

import type { SeedReport, SeedSkip } from "./iceSurfaceSpawns";

/**
 * A discarded StrictMode mount tears its own device down and reports it lost.
 * A real loss is not undone by a fresh mount, so the report waits long enough
 * for the retained mount to say it is healthy first.
 */
export const FAILED_SETTLE_MS = 300;
/** Let the desk's boot framing settle before showing the whole seeded demo. */
export const FIT_SETTLE_MS = 400;

/** The slice of `GPUAdapterInfo` this surface reads. */
export interface GpuAdapterInfo {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
  readonly isFallback?: boolean;
}

/** The slice of `GPUAdapter` the preflight needs, without ambient WebGPU types. */
export interface GpuAdapter {
  readonly info?: GpuAdapterInfo;
  requestAdapterInfo?: () => Promise<GpuAdapterInfo>;
}

export interface WebGpuApi {
  requestAdapter(): Promise<GpuAdapter | null>;
}

/**
 * What the preflight learned about the adapter. Kept plain (strings and a
 * boolean) so a lost device cannot invalidate it later.
 */
export interface AdapterSummary {
  readonly kind: "hardware" | "software";
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly fallback: boolean;
}

export interface LoadedIce {
  readonly engine: CanvasEngine;
  readonly layer: DeskLayerFactory;
  readonly Desk: typeof IceDesk;
  readonly EngineProvider: typeof IceEngineProvider;
  readonly core: typeof import("@vibecook/ice");
  /** The desk's theme and palette builders, so a theme switch can re-make them. */
  readonly objects: typeof import("@vibecook/ice/desk/objects");
}

export type Phase =
  | { readonly kind: "checking" }
  | { readonly kind: "loading"; readonly adapter?: AdapterSummary }
  | {
      readonly kind: "unavailable";
      readonly reason: "api" | "adapter";
      readonly detail: string;
    }
  | {
      readonly kind: "failed";
      readonly reason: "engine" | "device-lost";
      readonly detail: string;
      readonly adapter?: AdapterSummary | undefined;
    }
  | ({ readonly kind: "ready"; readonly adapter: AdapterSummary } & LoadedIce);

export type EngineState = DeskLayerStatus["state"];

export const UNREPORTED = "unreported";

/** `navigator.gpu` without depending on `@webgpu/types` being ambient. */
export function webGpuApi(): WebGpuApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  const gpu = (navigator as Navigator & { readonly gpu?: WebGpuApi }).gpu;
  return gpu;
}

export function textOf(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : UNREPORTED;
}

/**
 * Normalizes `GPUAdapterInfo` into the HUD's row. A fallback adapter, or one
 * whose identifiers name a software rasterizer, is labelled `software`; every
 * other adapter is `hardware`.
 */
export function summarizeAdapter(info: GpuAdapterInfo | undefined): AdapterSummary {
  const vendor = textOf(info?.vendor);
  const architecture = textOf(info?.architecture);
  const device = textOf(info?.device);
  const description = textOf(info?.description);
  const fallback = info?.isFallback === true;
  const named = `${vendor} ${architecture} ${device} ${description}`.toLowerCase();
  const software = fallback || /swiftshader|llvmpipe|software|basic render/.test(named);
  return {
    kind: software ? "software" : "hardware",
    vendor,
    architecture,
    device,
    description,
    fallback,
  };
}

/** Chrome exposes `adapter.info`; older engines expose `requestAdapterInfo()`. */
export async function adapterInfoOf(adapter: GpuAdapter): Promise<GpuAdapterInfo | undefined> {
  try {
    if (adapter.info !== undefined) return adapter.info;
  } catch {
    // Some engines make `info` throw until the device exists; fall through.
  }
  if (typeof adapter.requestAdapterInfo !== "function") return undefined;
  try {
    return await adapter.requestAdapterInfo();
  } catch {
    return undefined;
  }
}

export function adapterOf(phase: Phase): AdapterSummary | undefined {
  if (phase.kind === "ready" || phase.kind === "loading") return phase.adapter;
  if (phase.kind === "failed") return phase.adapter;
  return undefined;
}

export function adapterLine(phase: Phase): string {
  const adapter = adapterOf(phase);
  if (adapter === undefined) return "adapter: not acquired";
  return `adapter: ${adapter.kind} · ${adapter.vendor} / ${adapter.architecture} / ${adapter.device}`;
}

export function engineLine(phase: Phase, engineState: EngineState | null): string {
  if (phase.kind === "ready") return `engine: ${engineState ?? "starting"}`;
  if (phase.kind === "unavailable") {
    return phase.reason === "api" ? "engine: no WebGPU" : "engine: no adapter";
  }
  if (phase.kind === "failed") {
    return phase.reason === "device-lost" ? "engine: device lost" : "engine: failed";
  }
  return `engine: ${phase.kind}`;
}

export function countKinds(kinds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${kind} ×${count}`).join(", ");
}

export function diagnosticsText(input: {
  readonly phase: Phase;
  readonly engineState: EngineState | null;
  readonly seed: SeedReport | null;
  readonly fps: number | null;
}): string {
  const { phase, engineState, seed, fps } = input;
  const adapter = adapterOf(phase);
  const lines = [
    "ICE demo diagnostics (experimental — not document truth)",
    `phase: ${phase.kind}`,
    engineLine(phase, engineState),
    adapterLine(phase),
    seed === null ? "demo: not seeded" : `demo: ${seed.label} (${seed.mode})`,
    seed === null
      ? "seeded: none"
      : `seeded: ${seed.seeded}/${seed.total} — ${countKinds(seed.kinds) || "no kinds"}`,
    seed === null ? "boards: —" : `boards: ${seed.boards}`,
    `fps: ${fps === null ? "not sampled" : fps}`,
  ];
  if (adapter !== undefined) {
    lines.push(
      `adapter detail: vendor=${adapter.vendor} architecture=${adapter.architecture} ` +
        `device=${adapter.device} description=${adapter.description} fallback=${adapter.fallback}`,
    );
  }
  if (phase.kind === "unavailable" || phase.kind === "failed") {
    lines.push(`detail: ${phase.detail}`);
  }
  if (seed !== null && seed.failures.length > 0) {
    lines.push("seed failures:", ...seed.failures.map((failure) => `- ${failure}`));
  }
  if (seed !== null && seed.skipped.length > 0) {
    lines.push("skipped:", ...seed.skipped.map((skip) => `- ${skip.reason}: ${skip.detail}`));
  }
  return lines.join("\n");
}

/** `2 cycle, 4 section` — the HUD's one-line tally of what was refused. */
export function skipTally(skipped: readonly SeedSkip[]): string {
  const counts = new Map<string, number>();
  for (const skip of skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");
}
