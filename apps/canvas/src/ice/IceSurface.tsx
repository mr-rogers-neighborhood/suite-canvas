/**
 * The ICE surface — `?canvas=ice`.
 *
 * EXPERIMENTAL, NOT DOCUMENT TRUTH. This surface mounts a private, in-memory
 * `@vibecook/ice` desk. It has three seed sources:
 *
 * - **Live workspace** (app only): the real Suite graph, projected into cards
 *   and mini mats. It waits for hydration, then keeps the projection in step
 *   with the document: a drag or resize commits once through the bridge, and
 *   undo/redo re-derives the entities from the canonical placements. The HUD
 *   says `Live workspace`.
 * - **Native demo** (standalone `/ice.html`): ten ICE-native objects — six notes
 *   (four loose, one inside each mini mat), two mini mats, a whiteboard and a
 *   notebook.
 * - **Suite demo** (`/ice.html?demo=suite`): the same read-only projection over
 *   the example workspace built in a throwaway in-memory document.
 *
 * The live workspace projection reads the graph and never writes it. The demo
 * projections build a throwaway document; no workspace write, provider or owner
 * key is involved. The React Flow scene and `?canvas=scene` remain the reference
 * surface until the P0 parity gate in ADR-0034.
 *
 * Route contract: `App` mounts this only when `currentCanvasSurface()` returns
 * `"ice"`, behind `lazy(() => import("./ice/IceSurface"))`, so the default
 * bundle never imports ICE even statically.
 *
 * Everything below the HUD is loaded on demand — a WebGPU browser is detected
 * first, and only then are `@vibecook/ice`, `/desk`, `/desk/objects` and
 * `/react` imported together. No ICE code, shader or WGSL text is reachable
 * from the app's static entry, so the default path pays nothing for the demo.
 *
 * The whiteboard (`desk.board`) ships in `DESK_OBJECTS`, but ICE 0.16.0 has no
 * public seeded-surface API: a board's ink is the `StrokePrefab` data its
 * mounted pen writes through a GuardedTx. The demo therefore spawns a blank
 * board (blue marker, bullet tip) and leaves drawing to the pointer, rather
 * than reaching into engine internals to fabricate strokes.
 *
 * The desk wears the shipped light theme and palette (paper/sketch skin), and
 * frames its seeded content on the first mount so the demo never opens on an
 * empty patch of mat.
 *
 * Handwriting is deliberately off: `deskLayer` gets no `text` raster because
 * that needs the Caveat/Kalam face files, which this app does not host, and the
 * demo must not fetch a third-party font. The seeded notes carry real text for
 * the note bodies and diagnostics; the GPU shows their paper, the mini mats and
 * their chip LOD.
 */
import type { WorkspaceDocument } from "@suite/graph";
import type { CanvasEngine, DocSession, EngineGpu, Entity, SpawnWidgetOpts } from "@vibecook/ice";

import type { DeskLayerFactory, DeskLayerHandle, DeskLayerStatus } from "@vibecook/ice/desk";
import type {
  DeskHandle,
  Desk as IceDesk,
  EngineProvider as IceEngineProvider,
} from "@vibecook/ice/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import { isWhiteboardCard } from "../cards/whiteboard";
import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { IceContextMenu } from "./IceContextMenu";
import { workspaceWriter } from "./iceBridge";
import { type CanonicalPlacement, CardProjection } from "./iceCardProjection";
import { contextMenuStateFor, type MenuPick, menuTargetFromPick } from "./iceContextMenu";
import { attachIcePointerEditing, createIceEditingController } from "./iceEditingController";
import { planCardLanding } from "./iceSelectionLanding";
import { iceShareCaps, withinShareScope } from "./iceShareCaps";
import { SuiteWhiteboardStage } from "./SuiteWhiteboardStage";
import { cardTypeForScale, scaleForExtent } from "./suiteCardScale";
import { SUITE_CARD_DOM_FACE, SUITE_PEN_FACES, suitePalette } from "./suitePen";
import { buildSuiteSeed, projectWorkspaceToIce, spawnIceSuite } from "./suiteProjection";
import "./iceSurface.css";

/**
 * The pin kind's type name. Duplicated by design: importing `suitePinKind`
 * here would pull the ICE runtime into this module's static graph, and the
 * kind itself is loaded in the dynamic block beside the card kind.
 */
const SUITE_PIN_KIND = "suite.pin";
const NOTE_TYPE = "desk.note";
const MINIMAT_TYPE = "desk.minimat";
const BOARD_TYPE = "desk.board";
const NOTEBOOK_TYPE = "desk.notebook";
const DEMO_SEED_COUNT = 10;
/** Which demo the desk seeds. Selected by `?demo=suite`; Native is the default. */
type DemoMode = "native" | "suite";
/** A workspace projection is not a demo; the mode names where the seed came from. */
type SeedMode = DemoMode | "workspace";
const DEMO_PARAM = "demo";

/**
 * Reads the demo choice from a query string. The ICE route keeps its other
 * parameters (`canvas`, workspace id), so the toggle never rewrites the URL.
 */
export function demoModeFromSearch(search: string): DemoMode {
  return new URLSearchParams(search).get(DEMO_PARAM) === "suite" ? "suite" : "native";
}

function demoLabel(mode: DemoMode): string {
  return mode === "suite" ? "Suite demo" : "Native demo";
}
/**
 * A discarded StrictMode mount tears its own device down and reports it lost.
 * A real loss is not undone by a fresh mount, so the report waits long enough
 * for the retained mount to say it is healthy first.
 */
const FAILED_SETTLE_MS = 300;
/** Let the desk's boot framing settle before showing the whole seeded demo. */
const FIT_SETTLE_MS = 400;

/** The slice of `GPUAdapterInfo` this surface reads. */
interface GpuAdapterInfo {
  readonly vendor?: string;
  readonly architecture?: string;
  readonly device?: string;
  readonly description?: string;
  readonly isFallback?: boolean;
}

/** The slice of `GPUAdapter` the preflight needs, without ambient WebGPU types. */
interface GpuAdapter {
  readonly info?: GpuAdapterInfo;
  requestAdapterInfo?: () => Promise<GpuAdapterInfo>;
}

interface WebGpuApi {
  requestAdapter(): Promise<GpuAdapter | null>;
}

/**
 * What the preflight learned about the adapter. Kept plain (strings and a
 * boolean) so a lost device cannot invalidate it later.
 */
interface AdapterSummary {
  readonly kind: "hardware" | "software";
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly fallback: boolean;
}

interface SeedReport {
  readonly mode: SeedMode;
  readonly label: string;
  readonly seeded: number;
  readonly total: number;
  readonly kinds: readonly string[];
  readonly failures: readonly string[];
  /** The entities that did spawn — what the camera frames on the first mount. */
  readonly entities: readonly Entity[];
  /**
   * Entity → canonical card id. Mutable on purpose: a re-spawned card replaces
   * its entity in place.
   */
  readonly entitySlots: Map<Entity, { cardId: string; boardId: string }>;
  /** Mini-mat entity → the portal that opened it, for camera entry. */
  readonly portalMats: Map<Entity, PortalMat>;
  /** Cycle/depth/missing portal stubs drawn as labelled markers. */
  readonly stubs: number;
  /** Pin id → its marker entity on the root board. */
  readonly pinEntities: Map<string, Entity>;
  /** Boards the seed walked: 0 for the native demo, the example's 3 for Suite. */
  readonly boards: number;
  /** Things the seed deliberately did not map (cycles, depth caps, sections). */
  readonly skipped: readonly SeedSkip[];
}

/** A portal's mini mat: what it opens and where it was placed. */
interface PortalMat {
  readonly portalCardId: string;
  readonly boardId: string;
  readonly parentBoardId: string;
  readonly title: string;
}

/** One omitted entity, kept as a reason plus a human-readable detail. */
interface SeedSkip {
  readonly reason: string;
  readonly detail: string;
}

interface LoadedIce {
  readonly engine: CanvasEngine;
  readonly layer: DeskLayerFactory;
  readonly Desk: typeof IceDesk;
  readonly EngineProvider: typeof IceEngineProvider;
  readonly core: typeof import("@vibecook/ice");
}

type Phase =
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

type EngineState = DeskLayerStatus["state"];

const UNREPORTED = "unreported";

/** `navigator.gpu` without depending on `@webgpu/types` being ambient. */
function webGpuApi(): WebGpuApi | undefined {
  if (typeof navigator === "undefined") return undefined;
  const gpu = (navigator as Navigator & { readonly gpu?: WebGpuApi }).gpu;
  return gpu;
}

/** The scene surface, keeping the workspace and any other parameter intact. */
function sceneSurfaceHref(): string {
  if (typeof window === "undefined") return "?canvas=scene";
  const url = new URL(window.location.href);
  url.searchParams.set("canvas", "scene");
  return `${url.pathname}${url.search}${url.hash}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}

function quietly(run: () => void): void {
  try {
    run();
  } catch {
    // Teardown is best-effort: a failing close must not mask the surface's state.
    return;
  }
}

function textOf(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : UNREPORTED;
}

/**
 * Normalizes `GPUAdapterInfo` into the HUD's row. A fallback adapter, or one
 * whose identifiers name a software rasterizer, is labelled `software`; every
 * other adapter is `hardware`.
 */
function summarizeAdapter(info: GpuAdapterInfo | undefined): AdapterSummary {
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
async function adapterInfoOf(adapter: GpuAdapter): Promise<GpuAdapterInfo | undefined> {
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

function adapterOf(phase: Phase): AdapterSummary | undefined {
  if (phase.kind === "ready" || phase.kind === "loading") return phase.adapter;
  if (phase.kind === "failed") return phase.adapter;
  return undefined;
}

function adapterLine(phase: Phase): string {
  const adapter = adapterOf(phase);
  if (adapter === undefined) return "adapter: not acquired";
  return `adapter: ${adapter.kind} · ${adapter.vendor} / ${adapter.architecture} / ${adapter.device}`;
}

function engineLine(phase: Phase, engineState: EngineState | null): string {
  if (phase.kind === "ready") return `engine: ${engineState ?? "starting"}`;
  if (phase.kind === "unavailable") {
    return phase.reason === "api" ? "engine: no WebGPU" : "engine: no adapter";
  }
  if (phase.kind === "failed") {
    return phase.reason === "device-lost" ? "engine: device lost" : "engine: failed";
  }
  return `engine: ${phase.kind}`;
}

function countKinds(kinds: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${kind} ×${count}`).join(", ");
}

function diagnosticsText(input: {
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
function skipTally(skipped: readonly SeedSkip[]): string {
  const counts = new Map<string, number>();
  for (const skip of skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");
}

/**
 * Seeds the demo desk. Each spawn is independent so one refusing kind still
 * leaves the rest usable, and every failure is reported to the HUD. Child
 * coordinates are frame-local: a note placed with `parent` sits inside that
 * mini mat and moves with it.
 */
function seedDemoDocument(engine: CanvasEngine): SeedReport {
  let seeded = 0;
  const kinds: string[] = [];
  const failures: string[] = [];
  const entities: Entity[] = [];

  // The projection registers a new document's root frame and, after a spawn,
  // the container frame a child needs. Seeding runs before the desk's host
  // exists, so it drives the steps the host would otherwise drive.
  const project = (): void => {
    try {
      engine.step(performance.now());
    } catch (error) {
      failures.push(`projection: ${describeError(error)}`);
    }
  };

  const spawn = (label: string, type: string, opts: SpawnWidgetOpts): Entity | undefined => {
    try {
      const entity = engine.ops.spawnWidget(type, { ...opts, undoable: false });
      seeded += 1;
      kinds.push(type);
      entities.push(entity);
      return entity;
    } catch (error) {
      failures.push(`${label} (${type}): ${describeError(error)}`);
      return undefined;
    }
  };

  project();

  const research = spawn("Research mini mat", MINIMAT_TYPE, {
    x: -470,
    y: -140,
    props: { name: "Research", vinyl: "charcoal" },
  });
  const reference = spawn("Reference mini mat", MINIMAT_TYPE, {
    x: 240,
    y: -140,
    props: { name: "Reference", vinyl: "slate" },
  });

  spawn("Intro note", NOTE_TYPE, {
    x: -470,
    y: -400,
    props: {
      text: "ICE demo — a throwaway document. Nothing here touches your workspace.",
      pen: "felt",
      seed: 11,
    },
  });
  spawn("Pan and zoom note", NOTE_TYPE, {
    x: -180,
    y: -430,
    props: {
      text: "Drag a note to move it. Drag the bare mat to pan. The wheel zooms about the pointer.",
      pen: "ball",
      seed: 12,
    },
  });
  spawn("Selection note", NOTE_TYPE, {
    x: 110,
    y: -390,
    props: {
      text: "Marquee-select across the mat. Shift-click adds to the selection.",
      pen: "fountain",
      seed: 13,
    },
  });
  spawn("Mini-mat note", NOTE_TYPE, {
    x: 400,
    y: -420,
    props: {
      text: "Zoom into a mini mat to fly inside. Zoom out for its chip LOD.",
      pen: "red",
      seed: 14,
    },
  });
  spawn("Whiteboard", BOARD_TYPE, { x: -470, y: 420, props: { cap: "blue", tip: "bullet" } });
  spawn("Notebook", NOTEBOOK_TYPE, {
    x: 200,
    y: 460,
    props: { title: "ICE demo notes", cover: "linen", ruling: "rules", seed: 15 },
  });

  // The projection above compiles both mini mats' inside frames before a child
  // is placed in them.
  project();

  const putInside = (
    label: string,
    mat: Entity | undefined,
    x: number,
    y: number,
    text: string,
  ): void => {
    if (mat === undefined) {
      failures.push(`${label} (${NOTE_TYPE}): skipped — its mini mat did not spawn.`);
      return;
    }
    spawn(label, NOTE_TYPE, { x, y, parent: mat, props: { text, pen: "ball", seed: 16 } });
  };

  putInside(
    "Research note",
    research,
    80,
    90,
    "Inside the Research mat — depth two. Everything in here moves with the mat.",
  );
  putInside(
    "Reference note",
    reference,
    120,
    70,
    "Reset demo rebuilds this desk. Copy diagnostics reports the adapter and seed failures.",
  );

  project();

  return {
    mode: "native",
    label: demoLabel("native"),
    seeded,
    total: DEMO_SEED_COUNT,
    kinds,
    failures,
    entities,
    entitySlots: new Map(),
    portalMats: new Map(),
    stubs: 0,
    pinEntities: new Map(),
    boards: 0,
    skipped: [],
  };
}

/**
 * Projects the example Suite graph into native ICE notes and mini mats and
 * spawns it. The projection is pure and read-only; this adapter is the only
 * place the two engines meet.
 */
function seedSuiteDocument(engine: CanvasEngine): SeedReport {
  let seed: ReturnType<typeof buildSuiteSeed>;
  try {
    seed = buildSuiteSeed();
  } catch (error) {
    return {
      mode: "suite",
      label: demoLabel("suite"),
      seeded: 0,
      total: 0,
      kinds: [],
      failures: [`suite projection: ${describeError(error)}`],
      entities: [],
      entitySlots: new Map(),
      portalMats: new Map(),
      stubs: 0,
      pinEntities: new Map(),
      boards: 0,
      skipped: [],
    };
  }

  const report = spawnIceSuite<Entity>(seed, {
    spawn: (type, opts) => engine.ops.spawnWidget(type, { ...opts, undoable: false }),
    project: () => engine.step(performance.now()),
  });
  const byObjectId = new Map(seed.objects.map((object) => [object.id, object]));
  const entitySlots = new Map<Entity, { cardId: string; boardId: string }>();
  const portalMats = new Map<Entity, PortalMat>();
  for (const [objectId, entity] of report.objects) {
    const object = byObjectId.get(objectId);
    if (object?.kind === "card" || object?.kind === "note") {
      entitySlots.set(entity, { cardId: object.cardId, boardId: object.boardId });
    }
    if (object?.kind === "minimat") {
      portalMats.set(entity, {
        portalCardId: object.portalCardId,
        boardId: object.boardId,
        parentBoardId: object.parentBoardId,
        title: object.title,
      });
    }
  }

  return {
    mode: "suite",
    label: demoLabel("suite"),
    seeded: report.seeded,
    total: seed.objects.length,
    kinds: report.kinds,
    failures: report.failures,
    entities: [...report.objects.values()],
    entitySlots,
    portalMats,
    stubs: 0,
    pinEntities: new Map(),
    // Boards are counted by identity: the same board can open in several mats.
    boards: new Set(seed.boards.map((board) => board.id)).size,
    skipped: seed.skipped.map((skip) => ({ reason: skip.reason, detail: skip.detail })),
  };
}

/**
 * Projects the live workspace read-only. The graph is never mutated: the
 * projection only lists and reads, and the ICE document is still throwaway.
 */
function seedWorkspaceDocument(
  engine: CanvasEngine,
  workspace: WorkspaceDocument,
  rootBoardId: string,
): SeedReport {
  let seed: ReturnType<typeof projectWorkspaceToIce>;
  try {
    seed = projectWorkspaceToIce(workspace, rootBoardId, { cardKind: "card" });
  } catch (error) {
    return {
      mode: "workspace",
      label: "Workspace",
      seeded: 0,
      total: 0,
      kinds: [],
      failures: [`workspace projection: ${describeError(error)}`],
      entities: [],
      entitySlots: new Map(),
      portalMats: new Map(),
      stubs: 0,
      pinEntities: new Map(),
      boards: 0,
      skipped: [],
    };
  }

  const report = spawnIceSuite<Entity>(seed, {
    spawn: (type, opts) => engine.ops.spawnWidget(type, { ...opts, undoable: false }),
    project: () => engine.step(performance.now()),
  });
  const byObjectId = new Map(seed.objects.map((object) => [object.id, object]));
  const entitySlots = new Map<Entity, { cardId: string; boardId: string }>();
  const portalMats = new Map<Entity, PortalMat>();
  for (const [objectId, entity] of report.objects) {
    const object = byObjectId.get(objectId);
    if (object?.kind === "card" || object?.kind === "note") {
      entitySlots.set(entity, { cardId: object.cardId, boardId: object.boardId });
    }
    if (object?.kind === "minimat") {
      portalMats.set(entity, {
        portalCardId: object.portalCardId,
        boardId: object.boardId,
        parentBoardId: object.parentBoardId,
        title: object.title,
      });
    }
  }

  // A portal the projection refused to open is still a place on the canvas: a
  // labelled stub keeps it visible and focusable instead of silently missing.
  let stubs = 0;
  const stubEntities: Entity[] = [];
  const stubFailures: string[] = [];
  for (const skip of seed.skipped) {
    if (skip.kind !== "portal") continue;
    const placement = workspace
      .listBoardPlacements(skip.boardId)
      .find((entry) => entry.cardId === skip.id);
    if (placement === undefined) continue;
    const title = workspace.displayTitle(skip.id);
    try {
      const entity = engine.ops.spawnWidget(NOTE_TYPE, {
        x: placement.x,
        y: placement.y,
        undoable: false,
        props: {
          text: `${skip.reason === "cycle" ? "Cycle" : skip.reason === "depth" ? "Nested too deep" : "Missing view"} — ${title}`,
          pen: "red",
          seed: 4000 + stubs,
        },
      });
      stubEntities.push(entity);
      stubs += 1;
    } catch (error) {
      stubFailures.push(`stub ${skip.id}: ${describeError(error)}`);
    }
  }

  return {
    mode: "workspace",
    label: "Workspace",
    seeded: report.seeded,
    total: seed.objects.length,
    kinds: [...report.kinds, ...(stubs > 0 ? [NOTE_TYPE] : [])],
    failures: [...report.failures, ...stubFailures],
    entities: [...report.objects.values(), ...stubEntities],
    entitySlots,
    portalMats,
    stubs,
    pinEntities: spawnPins(engine, workspace, rootBoardId, stubFailures),
    boards: new Set(seed.boards.map((board) => board.id)).size,
    skipped: seed.skipped.map((skip) => ({ reason: skip.reason, detail: skip.detail })),
  };
}

/**
 * Spawns one marker per pin on the root board. A pin is navigation metadata,
 * not content: the marker is presentational and the document keeps the record.
 */
function spawnPins(
  engine: CanvasEngine,
  workspace: WorkspaceDocument,
  rootBoardId: string,
  failures: string[],
): Map<string, Entity> {
  const entities = new Map<string, Entity>();
  for (const pin of workspace.listPins(rootBoardId)) {
    try {
      const entity = engine.ops.spawnWidget(SUITE_PIN_KIND, {
        x: pin.x,
        y: pin.y,
        undoable: false,
        props: {
          pinId: pin.id,
          boardId: pin.boardId,
          label: pin.label,
          color: pin.color,
        },
      });
      entities.set(pin.id, entity);
    } catch (error) {
      failures.push(`pin ${pin.id}: ${describeError(error)}`);
    }
  }
  return entities;
}

export interface IceSurfaceFallbackProps {
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly sceneHref: string;
}

/** The calm no-desk card. Exported so Storybook can show it without WebGPU. */
export function IceSurfaceFallback({ title, message, detail, sceneHref }: IceSurfaceFallbackProps) {
  return (
    <div className="ice-surface__state" data-testid="ice-fallback">
      <div className="ice-surface__card">
        <p className="ice-surface__card-title" data-testid="ice-fallback-title">
          {title}
        </p>
        <p className="ice-surface__card-copy" data-testid="ice-fallback-copy">
          {message}
        </p>
        {detail === undefined ? null : (
          <p className="ice-surface__card-detail" data-testid="ice-fallback-detail">
            {detail}
          </p>
        )}
        <a className="ice-surface__card-link" data-testid="ice-fallback-link" href={sceneHref}>
          Back to the scene surface
        </a>
      </div>
    </div>
  );
}

/** The ICE mount. In the app it projects the live workspace read-only. */
export interface IceSurfaceProps {
  /** Where the fallback/HUD returns; the standalone demo overrides it to `/`. */
  readonly sceneHref?: string;
  /**
   * The live workspace to project. Omit for the standalone demo; `null` means
   * the app has the workspace but it is not hydrated yet, so the surface waits
   * instead of falling back to a demo.
   */
  readonly workspace?: WorkspaceDocument | null;
  /** Root board/View to frame. The surface waits while this is null. */
  readonly rootBoardId?: string | null;
}

export function IceSurface({
  sceneHref: sceneHrefProp,
  workspace,
  rootBoardId = null,
}: IceSurfaceProps = {}) {
  const workspaceMode = workspace !== undefined;
  const liveWorkspace = workspace ?? null;
  const [mode, setMode] = useState<DemoMode>(() =>
    demoModeFromSearch(typeof window === "undefined" ? "" : window.location.search),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "checking" });
  const [engineState, setEngineState] = useState<EngineState | null>(null);
  const [seed, setSeed] = useState<SeedReport | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const canManageTrash = useUiStore((state) => state.canManageTrash);
  const readOnly = useUiStore((state) => state.readOnly);
  // One capability row for everything the surface does. The session matrix in
  // the store says what this seat may do; `iceShareCaps` narrows it to the
  // share's scope, so a board share cannot write a card on another board and a
  // card share can edit that card's text but never its placement.
  const caps = useMemo(
    () =>
      iceShareCaps({
        share: getSession().share,
        ui: { readOnly, canEditLayout, canEditContent, canManageSchema, canManageTrash },
      }),
    [readOnly, canEditLayout, canEditContent, canManageSchema, canManageTrash],
  );
  const pendingPinFocus = useUiStore((state) => state.pendingPinFocus);
  const dropPinRequest = useUiStore((state) => state.dropPinRequest);
  const actorId = useRef(`local-${Math.random().toString(36).slice(2, 10)}`);
  const [runId, setRunId] = useState(0);
  const sceneHref = useMemo(() => sceneHrefProp ?? sceneSurfaceHref(), [sceneHrefProp]);
  const owned = useRef<{
    engine?: CanvasEngine;
    doc?: DocSession;
    gpu?: EngineGpu;
    clearCardRenderer?: (() => void) | undefined;
  }>({});
  const pendingFailure = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingFit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seededEntities = useRef<readonly Entity[]>([]);
  const clearPendingFailure = useCallback(() => {
    if (pendingFailure.current === undefined) return;
    clearTimeout(pendingFailure.current);
    pendingFailure.current = undefined;
  }, []);
  const clearPendingFit = useCallback(() => {
    if (pendingFit.current === undefined) return;
    clearTimeout(pendingFit.current);
    pendingFit.current = undefined;
  }, []);
  // One teardown for every exit: unmount, a reset, or a desk that reported
  // `failed` and was replaced by the fallback. Emptying the ref makes it
  // idempotent.
  const teardown = useCallback(() => {
    clearPendingFailure();
    clearPendingFit();
    const { engine, doc, gpu, clearCardRenderer } = owned.current;
    owned.current = {};
    clearCardRenderer?.();
    if (doc !== undefined) quietly(() => doc.close());
    if (engine !== undefined) quietly(() => engine.dispose());
    if (gpu !== undefined) quietly(() => gpu.destroy());
  }, [clearPendingFailure, clearPendingFit]);

  useEffect(() => {
    let cancelled = false;

    const start = async (): Promise<void> => {
      const gpu = webGpuApi();
      if (gpu === undefined) {
        setPhase({
          kind: "unavailable",
          reason: "api",
          detail: "navigator.gpu is not exposed by this browser.",
        });
        return;
      }

      // In the app, a workspace that has not hydrated yet is not a reason to
      // show a demo. Wait for the real graph; the boot skeleton stays up.
      if (workspaceMode && (liveWorkspace === null || rootBoardId === null)) {
        setPhase({ kind: "checking" });
        return;
      }

      setPhase({ kind: "loading" });

      let raw: GpuAdapter | null;
      try {
        raw = await gpu.requestAdapter();
      } catch (error) {
        if (!cancelled) {
          setPhase({
            kind: "unavailable",
            reason: "adapter",
            detail: `requestAdapter() failed: ${describeError(error)}`,
          });
        }
        return;
      }
      if (cancelled) return;
      if (raw === null) {
        setPhase({
          kind: "unavailable",
          reason: "adapter",
          detail: "requestAdapter() returned no adapter.",
        });
        return;
      }

      const adapter = summarizeAdapter(await adapterInfoOf(raw));
      if (cancelled) return;
      setPhase({ kind: "loading", adapter });

      let deviceAdapter: AdapterSummary | undefined;
      try {
        const [core, desk, objects, react] = await Promise.all([
          import("@vibecook/ice"),
          import("@vibecook/ice/desk"),
          import("@vibecook/ice/desk/objects"),
          import("@vibecook/ice/react"),
        ]);
        if (cancelled) return;

        const live = liveWorkspace !== null && rootBoardId !== null;
        const suiteCardModules = live
          ? await Promise.all([
              import("./suiteCardKind"),
              import("./suiteCardWorkspace"),
              import("./suitePinKind"),
            ])
          : null;
        if (cancelled) return;
        // Every rung of the card's type ladder is its own kind (ICE fixes a
        // note's type size per kind), so all of them are registered.
        const widgets = suiteCardModules
          ? [
              ...objects.DESK_OBJECTS,
              ...suiteCardModules[0].SUITE_CARD_RUNGS.map((rung) => rung.object),
              suiteCardModules[2].SuitePin,
            ]
          : [...objects.DESK_OBJECTS];

        // ONE device per engine (D7): the desk adopts this one instead of
        // acquiring its own, so a discarded StrictMode mount cannot destroy
        // the device the retained mount is drawing with. The app owns its end
        // of life — `teardown` releases it after the engine is disposed.
        let gpu: EngineGpu;
        try {
          gpu = await core.acquireCompositorDevice();
        } catch (error) {
          if (!cancelled) {
            setPhase({
              kind: "unavailable",
              reason: "adapter",
              detail: `Could not create a WebGPU device: ${describeError(error)}`,
            });
          }
          return;
        }
        if (cancelled) {
          quietly(() => gpu.destroy());
          return;
        }
        owned.current = { gpu };

        deviceAdapter = summarizeAdapter(await adapterInfoOf(gpu.adapter));
        if (cancelled) return;
        setPhase({ kind: "loading", adapter: deviceAdapter });

        const engine = core.createCanvasEngine({
          ...objects.DESK_ENGINE,
          widgets,
          compositorDevice: gpu,
        });
        const doc = engine.docs.create();
        let clearCardRenderer: (() => void) | undefined;
        if (suiteCardModules !== null && SUITE_CARD_DOM_FACE) {
          suiteCardModules[0].setSuiteCardSlotRenderer(
            suiteCardModules[1].createWorkspaceCardSlotRenderer(),
          );
          clearCardRenderer = () => suiteCardModules[0].setSuiteCardSlotRenderer(undefined);
        }
        owned.current = { engine, doc, gpu, clearCardRenderer };

        const report =
          liveWorkspace !== null && rootBoardId !== null
            ? seedWorkspaceDocument(engine, liveWorkspace, rootBoardId)
            : mode === "suite"
              ? seedSuiteDocument(engine)
              : seedDemoDocument(engine);
        seededEntities.current = report.entities;
        const layer = desk.deskLayer({
          theme: objects.deskTheme("light"),
          palette: suitePalette(objects.deskPalette("light")),
          objects: widgets,
          docs: engine.docs,
          text: desk.inkRaster({ faces: SUITE_PEN_FACES }),
          name: `ice-demo-${runId + 1}`,
        });

        setSeed(report);
        setPhase({
          kind: "ready",
          adapter: deviceAdapter ?? adapter,
          engine,
          layer,
          Desk: react.Desk,
          EngineProvider: react.EngineProvider,
          core,
        });
      } catch (error) {
        if (!cancelled) {
          setPhase({
            kind: "failed",
            reason: "engine",
            detail: describeError(error),
            adapter: deviceAdapter ?? adapter,
          });
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [liveWorkspace, mode, rootBoardId, runId, teardown, workspaceMode]);

  // A desk that reported `failed` is replaced by the fallback, so its engine
  // is released here rather than held until the route changes.
  useEffect(() => {
    if (phase.kind === "failed") teardown();
  }, [phase.kind, teardown]);

  // ICE is the canvas, but Suite owns the selection. Read the engine's
  // `Selected` set once per frame and mirror it into the shell. The first
  // non-empty selection wins; a shell-driven selection is not cleared just
  // because ICE has not selected anything yet.
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || seed.entitySlots.size === 0) return;
    let handle = 0;
    let previous = "";
    const tick = (): void => {
      const selected = phase.core
        .selectedEntities(phase.engine.world)
        .map((entity) => seed.entitySlots.get(entity)?.cardId)
        .filter((cardId): cardId is string => cardId !== undefined);
      const key = selected.join("\u001f");
      if (key !== previous && (selected.length > 0 || previous.length > 0)) {
        previous = key;
        const store = useUiStore.getState();
        store.setSelectedNodeIds(selected);
        // Selecting one card is a request to read it: the inspector is the
        // shell's reading surface, so a single pick opens it directly rather
        // than needing a second gesture. Nothing closes it here — the panel
        // keeps its subject until the user closes it or the card goes away,
        // which is how the shell already behaved.
        const only = selected.length === 1 ? selected[0] : undefined;
        if (only !== undefined && store.inspectorNodeId !== only) {
          // The shared landing plan decides whether a pick may open a reading
          // surface at all, and the share decides whether this seat may see this
          // card. A viewer keeps the selection; the panel just does not open.
          const landing = planCardLanding({
            cardId: only,
            created: false,
            canEditContent: caps.canEditContent,
            readOnly:
              !caps.canOpenInspector || !withinShareScope({ cardId: only }, getSession().share),
            hasPlacement: true,
          });
          if (landing.openInspector) store.openInspector(only);
        }
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [phase, seed, caps.canEditContent, caps.canOpenInspector]);

  // FPS is sampled in a rAF counter and published once per second, never per
  // frame: the HUD must not make React the desk's frame loop.
  useEffect(() => {
    if (phase.kind !== "ready" || typeof requestAnimationFrame !== "function") return;
    let handle = 0;
    let frames = 0;
    let since = performance.now();
    const tick = (now: number): void => {
      frames += 1;
      const elapsed = now - since;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        since = now;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [phase.kind]);

  /**
   * The desk reports its own boot and device loss. A `failed` desk is replaced
   * by the fallback (the engine is disposed with it); `degraded` keeps drawing
   * and says so in the HUD.
   */
  const handleReady = useCallback(
    (handle: DeskHandle) => {
      const layer = handle.layer as Partial<DeskLayerHandle>;
      deskLayerRef.current = layer as DeskLayerHandle;
      setLayerReady((count) => count + 1);
      let active = true;
      let framing = false;
      const frameDemo = (): void => {
        if (framing) return;
        framing = true;
        pendingFit.current = setTimeout(() => {
          pendingFit.current = undefined;
          if (!active || seededEntities.current.length === 0) return;
          quietly(() => handle.engine.ops.zoomToFit(seededEntities.current));
        }, FIT_SETTLE_MS);
      };
      const apply = (status: DeskLayerStatus): void => {
        if (!active) return;
        setEngineState(status.state);
        clearPendingFailure();
        if (status.state === "ready") frameDemo();
        if (status.state !== "failed") return;
        pendingFailure.current = setTimeout(() => {
          pendingFailure.current = undefined;
          if (!active) return;
          setPhase((current) => ({
            kind: "failed",
            reason: "device-lost",
            detail: status.message ?? "The desk lost its graphics device.",
            adapter: current.kind === "ready" ? current.adapter : undefined,
          }));
        }, FAILED_SETTLE_MS);
      };

      if (typeof layer.status === "function") apply(layer.status());
      const stop = typeof layer.onStatus === "function" ? layer.onStatus(apply) : undefined;
      return () => {
        active = false;
        deskLayerRef.current = null;
        clearPendingFailure();
        clearPendingFit();
        stop?.();
      };
    },
    [clearPendingFailure, clearPendingFit],
  );

  const resetDemo = useCallback(() => {
    setPhase({ kind: "checking" });
    setEngineState(null);
    setSeed(null);
    setFps(null);
    setCopyState(null);
    seededEntities.current = [];
    clearPendingFit();
    setRunId((id) => id + 1);
  }, [clearPendingFit]);

  /** Switching demos is a Reset: the desk, document and device are rebuilt. */
  const chooseDemo = useCallback(
    (next: DemoMode) => {
      if (next === mode) return;
      setMode(next);
      resetDemo();
    },
    [mode, resetDemo],
  );

  const copyDiagnostics = useCallback(async (): Promise<void> => {
    const text = diagnosticsText({ phase, engineState, seed, fps });
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (clipboard === undefined) throw new Error("clipboard is unavailable in this browser");
      await clipboard.writeText(text);
      setCopyState("Diagnostics copied");
    } catch (error) {
      setCopyState(`Copy failed: ${describeError(error)}`);
    }
  }, [phase, engineState, seed, fps]);

  const surfaceRef = useRef<HTMLElement | null>(null);
  const deskLayerRef = useRef<DeskLayerHandle | null>(null);
  const commandsRef = useRef<{
    undo(): void;
    redo(): void;
    deleteSelection(): void;
    reconcile(): void;
    escape(): void;
  } | null>(null);
  const [portalPath, setPortalPath] = useState<readonly string[]>([]);
  const portalDepth = useRef(0);
  const [whiteboard, setWhiteboard] = useState<{
    cardId: string;
    box: { left: number; top: number; width: number; height: number; scale: number };
  } | null>(null);
  const [cameraMoving, setCameraMoving] = useState(false);
  const [layerReady, setLayerReady] = useState(0);

  // The editable root board: drag and resize commit once per gesture, delete is
  // one trash write, and undo/redo are Loro's. ICE's own history is never read.
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null || rootBoardId === null) return;
    const root = surfaceRef.current;
    const desk = deskLayerRef.current;
    if (root === null || desk === null) return;

    const { engine, core } = phase;
    const slots = seed.entitySlots;

    const cameraOf = () => {
      const view = engine.world.getResource(core.Camera);
      if (view === undefined) return null;
      const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
      return { x: -view.x * zoom, y: -view.y * zoom, zoom };
    };

    // The committed rect is the widget's own `Position`/`Size`, never the
    // paper's drawn extents: `half` is "as drawn", so it carries the hold's
    // lift and would commit a shifted card.
    const rectOf = (entity: Entity) => {
      const position = phase.engine.world.read(entity, phase.core.Position);
      const size = phase.engine.world.read(entity, phase.core.Size);
      if (position === undefined || size === undefined) return null;
      const values = [position.x, position.y, size.w, size.h];
      if (!values.every((value) => Number.isFinite(value))) return null;
      return { x: position.x, y: position.y, width: size.w, height: size.h };
    };

    const pickEntity = (screen: { x: number; y: number }) => {
      try {
        return desk.pick(screen)?.entity ?? null;
      } catch {
        return null;
      }
    };

    const removeEntities = (entities: readonly Entity[]) => {
      if (entities.length === 0) return;
      try {
        engine.ops.setSelection(entities);
        engine.ops.deleteSelection();
      } catch {
        // A refused removal is repaired by the next reconcile.
      }
    };

    // What a card says, as the one text flow its paper writes. Title, a blank
    // line, then the body: the same two facts the DOM face used to lay out.
    const faceText = (cardId: string): string => {
      const title = liveWorkspace.displayTitle(cardId);
      const body = liveWorkspace.cardText(cardId).trim();
      return body.length === 0 ? title : `${title}\n\n${body}`;
    };

    const projection = new CardProjection<Entity>({
      spawn: (placement: CanonicalPlacement) => {
        // The rung follows the card's own extent, so resizing is the control.
        const entity = engine.ops.spawnWidget(cardTypeForScale(scaleForExtent(placement)), {
          x: placement.x,
          y: placement.y,
          ...(placement.width !== undefined && placement.height !== undefined
            ? { w: placement.width, h: placement.height }
            : {}),
          undoable: false,
          props: {
            cardId: placement.cardId,
            boardId: placement.boardId,
            // The paper writes this: title, blank line, body — the same two
            // facts the card showed as a DOM face, now drawn by the GPU.
            text: placement.text ?? "",
            seeds: "",
            title: "",
            body: "",
            paper: "card",
            pen: "card",
            seed: 0,
          },
        });
        slots.set(entity, { cardId: placement.cardId, boardId: placement.boardId });
        return entity;
      },
      remove: (entity) => {
        removeEntities([entity]);
        slots.delete(entity);
      },
      boxOf: (entity) => rectOf(entity),
      // Text and the type rung both need a replace rather than a move: a
      // resize that crosses a rung changes the *kind*, and a card cannot change
      // kind in place.
      keyOf: (placement) => `${placement.text ?? ""}\u001f${scaleForExtent(placement)}`,
    });
    for (const [entity, slot] of seed.entitySlots) {
      projection.register(entity, slot.cardId, slot.boardId, faceText(slot.cardId));
    }

    const reconcile = () => {
      const placements = liveWorkspace
        .listBoardPlacements(rootBoardId)
        .filter((placement) => liveWorkspace.getCard(placement.cardId)?.deletedAt === undefined)
        .map((placement) => ({
          boardId: placement.boardId,
          cardId: placement.cardId,
          x: placement.x,
          y: placement.y,
          text: faceText(placement.cardId),
          ...(placement.width !== undefined ? { width: placement.width } : {}),
          ...(placement.height !== undefined ? { height: placement.height } : {}),
        }));
      const report = projection.reconcile(placements, {
        width: DEFAULT_CARD_WIDTH,
        height: DEFAULT_CARD_HEIGHT,
      });
      if (
        report.failures.length > 0 &&
        typeof console !== "undefined" &&
        typeof console.warn === "function"
      ) {
        console.warn("[ice] projection reconcile", report.failures);
      }
      // A replace makes a new entity, so a selection held across one would be
      // dropped. Re-derive it from the card ids: the projection is the only
      // place that knows which entity now stands for which card.
      if (report.spawned.length > 0 || report.moved.length > 0 || report.removed.length > 0) {
        const selected = useUiStore
          .getState()
          .selectedNodeIds.map((cardId) => projection.entityOf(cardId))
          .filter((entity): entity is Entity => entity !== undefined);
        try {
          if (selected.length > 0) engine.ops.setSelection(selected);
        } catch {
          // A refused selection is cosmetic; the next click repairs it.
        }
      }
    };

    const controller = createIceEditingController({
      camera: cameraOf,
      pick: pickEntity,
      rectOf,
      writer: workspaceWriter(liveWorkspace),
      role: caps.controllerRole,
      removeCards: (cardIds) => {
        const entities = [...slots]
          .filter(([, slot]) => cardIds.includes(slot.cardId))
          .map(([entity]) => entity);
        removeEntities(entities);
        for (const [entity, slot] of [...slots]) {
          if (cardIds.includes(slot.cardId)) slots.delete(entity);
        }
      },
      slots,
      rootBoardId,
      selection: () => useUiStore.getState().selectedNodeIds,
      // A gesture commits into Loro, then reconcile brings the projection to
      // the new truth: a moved card is already where it was left (a no-op), and
      // a resize that crossed a type rung respawns on the new kind.
      afterCommit: reconcile,
      pinSlots: new Map([...seed.pinEntities].map(([pinId, entity]) => [entity, pinId])),
      movePin: (pinId, point) => {
        liveWorkspace.movePin(pinId, point);
      },
    });

    commandsRef.current = {
      undo: () => {
        liveWorkspace.undo();
        reconcile();
      },
      redo: () => {
        liveWorkspace.redo();
        reconcile();
      },
      deleteSelection: () => {
        controller.deleteSelection(useUiStore.getState().selectedNodeIds);
      },
      reconcile,
      escape: () => {
        if (portalDepth.current > 0) {
          try {
            engine.ops.exitContainer();
            portalDepth.current -= 1;
            setPortalPath((path) => path.slice(0, -1));
          } catch {
            // A refused exit leaves the camera where it is.
          }
          return;
        }
        engine.ops.cancelActiveGestures();
      },
    };

    const detach = attachIcePointerEditing(root, controller);

    // A mini mat is a doorway: a double click moves the camera inside it rather
    // than swapping boards. ICE owns the flight and the frame; this only routes
    // the press and remembers the path for Escape and the breadcrumb.
    const onDouble = (event: MouseEvent): void => {
      const bounds = root.getBoundingClientRect();
      const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      let picked: Entity | null = null;
      try {
        picked = desk.pick(screen)?.entity ?? null;
      } catch {
        picked = null;
      }
      if (picked === null) return;
      const entity = picked;
      const mat = seed.portalMats.get(entity);
      if (mat === undefined) return;
      try {
        engine.ops.enterContainer(entity);
        portalDepth.current += 1;
        setPortalPath((path) => [...path, mat.title]);
      } catch {
        // A refused entry leaves the camera where it is.
      }
    };
    root.addEventListener("dblclick", onDouble);

    // A right-click is the shell's menu, opened on whatever the pick found. The
    // mapping lives in `iceContextMenu`; this only supplies the pick, the
    // camera and the entity maps the surface already keeps.
    const pinSlots = new Map([...seed.pinEntities].map(([pinId, entity]) => [entity, pinId]));
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const bounds = root.getBoundingClientRect();
      let pick: MenuPick | null = null;
      try {
        pick = desk.pick({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      } catch {
        pick = null;
      }
      const target = menuTargetFromPick({
        pick:
          pick === null
            ? null
            : {
                entity: pick.entity,
                type: pick.type,
                ...(pick.part === undefined ? {} : { part: pick.part }),
              },
        slots,
        pins: pinSlots,
        portals: seed.portalMats,
        sections: new Map(),
        edges: new Map(),
      });
      const store = useUiStore.getState();
      // The menu acts on the selection, so a right-click selects what it hit.
      if (target?.kind === "node" || target?.kind === "portal") {
        const cardId = target.cardId;
        if (cardId !== undefined && !store.selectedNodeIds.includes(cardId)) {
          store.selectSection(null);
          store.setSelectedNodeIds([cardId]);
        }
      } else if (target?.kind === "section") {
        store.selectSection(target.sectionId ?? null);
      } else if (target?.kind === "edge") {
        store.selectSection(null);
        store.setSelectedNodeIds([]);
        store.setSelectedEdgeIds(target.edgeId === undefined ? [] : [target.edgeId]);
      } else {
        store.selectSection(null);
        store.setSelectedNodeIds([]);
        store.setSelectedEdgeIds([]);
      }
      const view = engine.world.getResource(core.Camera);
      store.openContextMenu(
        contextMenuStateFor({
          client: { x: event.clientX, y: event.clientY },
          container: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          camera:
            view === undefined
              ? { x: 0, y: 0, zoom: 1 }
              : {
                  x: -view.x * (view.zoom || 1),
                  y: -view.y * (view.zoom || 1),
                  zoom: view.zoom || 1,
                },
          target,
        }),
      );
    };
    root.addEventListener("contextmenu", onContextMenu);

    return () => {
      root.removeEventListener("dblclick", onDouble);
      root.removeEventListener("contextmenu", onContextMenu);
      detach();
      controller.cancel();
      commandsRef.current = null;
      portalDepth.current = 0;
      setPortalPath([]);
    };
  }, [phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId, caps.controllerRole]);

  /**
   * The inline whiteboard is intent-gated: the pointer must rest over a
   * whiteboard for a moment, at a readable zoom, before the editor mounts. One
   * editor exists at a time; every other whiteboard keeps its SVG preview.
   */
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null) return;
    const root = surfaceRef.current;
    const desk = deskLayerRef.current;
    if (root === null || desk === null) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const onMove = (event: PointerEvent): void => {
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        const bounds = root.getBoundingClientRect();
        const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        let entity: Entity | null = null;
        try {
          entity = desk.pick(screen)?.entity ?? null;
        } catch {
          entity = null;
        }
        const slot = entity === null ? undefined : seed.entitySlots.get(entity);
        if (slot === undefined || !liveWorkspace.getCard(slot.cardId)) {
          setWhiteboard(null);
          return;
        }
        if (!isWhiteboardCard(liveWorkspace.getCard(slot.cardId))) {
          setWhiteboard(null);
          return;
        }
        const rect = entity === null ? null : desk.geometryOf(entity);
        const view = phase.engine.world.getResource(phase.core.Camera);
        if (rect === null || view === undefined) {
          setWhiteboard(null);
          return;
        }
        const geometry = rect as {
          centre?: readonly [number, number];
          half?: readonly [number, number];
        };
        if (geometry.centre === undefined || geometry.half === undefined) {
          setWhiteboard(null);
          return;
        }
        const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
        const worldWidth = Math.abs(geometry.half[0]) * 2;
        const worldHeight = Math.abs(geometry.half[1]) * 2;
        // Below the readable width the preview is the better face.
        if (worldWidth * zoom < 180) {
          setWhiteboard(null);
          return;
        }
        setWhiteboard({
          cardId: slot.cardId,
          box: {
            left: (geometry.centre[0] - view.x) * zoom - (worldWidth * zoom) / 2,
            top: (geometry.centre[1] - view.y) * zoom - (worldHeight * zoom) / 2,
            width: worldWidth * zoom,
            height: worldHeight * zoom,
            scale: zoom,
          },
        });
      }, 200);
    };

    const onLeave = (): void => {
      clearTimer();
      setWhiteboard(null);
    };

    const onDown = (): void => setCameraMoving(true);
    const onUp = (): void => setCameraMoving(false);

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("pointerdown", onDown, true);
    root.addEventListener("pointerup", onUp, true);
    return () => {
      clearTimer();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointerdown", onDown, true);
      root.removeEventListener("pointerup", onUp, true);
      setWhiteboard(null);
    };
  }, [phase, seed, layerReady, workspaceMode, liveWorkspace]);

  // A pin click is navigation: centre the camera on the marked point.
  useEffect(() => {
    if (phase.kind !== "ready" || pendingPinFocus === null) return;
    const viewport = phase.engine.world.getResource(phase.core.Viewport);
    const camera = phase.engine.world.getResource(phase.core.Camera);
    if (viewport === undefined || camera === undefined) return;
    const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    phase.core.writeRuntimeResource(phase.engine.world, phase.core.Camera, {
      x: pendingPinFocus.x - viewport.w / (2 * zoom),
      y: pendingPinFocus.y - viewport.h / (2 * zoom),
      zoom,
      gesturing: false,
    });
    useUiStore.getState().focusPinAt(null);
  }, [phase, pendingPinFocus]);

  // "Drop pin" from the shell: the canvas owns the point (the camera centre) and
  // the marker; the document owns the record.
  useEffect(() => {
    if (dropPinRequest === 0) return;
    if (phase.kind !== "ready" || !workspaceMode) return;
    if (liveWorkspace === null || rootBoardId === null) return;
    // A viewer, or a share that does not cover this board, cannot leave a marker
    // on someone else's canvas.
    if (!caps.canDropPin || !withinShareScope({ boardId: rootBoardId }, getSession().share)) return;
    const viewport = phase.engine.world.getResource(phase.core.Viewport);
    const camera = phase.engine.world.getResource(phase.core.Camera);
    if (viewport === undefined || camera === undefined) return;
    const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    const point = {
      x: camera.x + viewport.w / (2 * zoom),
      y: camera.y + viewport.h / (2 * zoom),
    };
    const count = liveWorkspace.listPins(rootBoardId).length + 1;
    try {
      const pin = liveWorkspace.createPin({
        boardId: rootBoardId,
        x: point.x,
        y: point.y,
        label: `Pin ${count}`,
        createdBy: actorId.current,
      });
      const entity = phase.engine.ops.spawnWidget(SUITE_PIN_KIND, {
        x: pin.x,
        y: pin.y,
        undoable: false,
        props: {
          pinId: pin.id,
          boardId: pin.boardId,
          label: pin.label,
          color: pin.color,
        },
      });
      if (seed !== null) seed.pinEntities.set(pin.id, entity);
    } catch (error) {
      console.warn("[ice] could not drop a pin", error);
    }
  }, [dropPinRequest, phase, workspaceMode, liveWorkspace, rootBoardId, seed, caps.canDropPin]);

  const keymapOverrides = useMemo(() => {
    if (!workspaceMode) return undefined;
    return [
      {
        key: "z",
        mod: true,
        run: () => {
          commandsRef.current?.undo();
        },
      },
      {
        key: "z",
        mod: true,
        shift: true,
        run: () => {
          commandsRef.current?.redo();
        },
      },
      {
        key: "Escape",
        run: () => {
          commandsRef.current?.escape();
        },
      },
      {
        key: "Backspace",
        run: () => {
          commandsRef.current?.deleteSelection();
        },
      },
      {
        key: "Delete",
        run: () => {
          commandsRef.current?.deleteSelection();
        },
      },
    ];
  }, [workspaceMode]);

  const ready = phase.kind === "ready" ? phase : null;

  return (
    <section
      ref={surfaceRef}
      className="ice-surface"
      data-testid="ice-surface"
      data-ice-phase={phase.kind}
      aria-label="ICE experimental canvas"
    >
      {ready === null ? (
        <div className="ice-surface__desk" data-testid="ice-desk-host" />
      ) : (
        <ready.EngineProvider engine={ready.engine}>
          <ready.Desk
            engine={ready.engine}
            layer={ready.layer}
            onReady={handleReady}
            {...(keymapOverrides ? { keymapOverrides } : {})}
            className="ice-surface__desk"
            style={{ position: "absolute", inset: 0 }}
          />
        </ready.EngineProvider>
      )}

      {liveWorkspace !== null && rootBoardId !== null ? (
        <IceContextMenu
          workspace={liveWorkspace}
          rootBoardId={rootBoardId}
          canCreateContent={caps.canCreateCards}
          canCreateBoards={canManageSchema}
          canEditContent={caps.canEditContent}
          canEditLayout={caps.canWriteLayout}
          canManageStructure={canEditLayout}
          canManageTrash={canManageTrash && caps.canWriteLayout}
          canManageLinks={canManageSchema}
          reconcile={() => commandsRef.current?.reconcile()}
          enterPortal={(cardId) => {
            const entity = [...(seed?.portalMats.keys() ?? [])].find(
              (candidate) => seed?.entitySlots.get(candidate)?.cardId === cardId,
            );
            if (entity === undefined || phase.kind !== "ready") return;
            try {
              phase.engine.ops.enterContainer(entity);
              portalDepth.current += 1;
              setPortalPath((path) => [...path, seed?.portalMats.get(entity)?.title ?? "Board"]);
            } catch {
              // A refused entry leaves the camera where it is.
            }
          }}
        />
      ) : null}

      {whiteboard !== null ? (
        <SuiteWhiteboardStage
          activeCardId={whiteboard.cardId}
          box={whiteboard.box}
          readOnly={!caps.canWriteLayout}
          suspended={cameraMoving}
          onCommit={(cardId, commit) => {
            if (liveWorkspace === null) return;
            try {
              liveWorkspace.applyDrawing(cardId, commit.elements, commit.order);
            } catch (error) {
              console.warn("[ice] could not save whiteboard", error);
            }
          }}
          onExit={() => setWhiteboard(null)}
        />
      ) : null}

      {phase.kind === "checking" ? (
        <IceSurfaceFallback
          title="Checking for WebGPU"
          message="ICE needs WebGPU before it can start. Nothing has been loaded yet."
          sceneHref={sceneHref}
        />
      ) : null}

      {phase.kind === "loading" ? (
        <IceSurfaceFallback
          title="Starting the ICE desk"
          message="Importing the engine and acquiring the GPU. This is a one-time cost; the default canvas never pays it."
          sceneHref={sceneHref}
        />
      ) : null}

      {phase.kind === "unavailable" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "api" ? "This browser has no WebGPU" : "WebGPU has no graphics adapter"
          }
          message="ICE is an experimental WebGPU engine, so the desk cannot start here. Run `pnpm dev:ice` and open the printed URL in a headed Chrome started with `--enable-unsafe-webgpu` (`node scripts/ice-chrome.mjs` does both for you). The integrated browser and headless Chrome will not work. The default canvas and the scene projection are unaffected."
          detail={
            phase.reason === "api"
              ? `${phase.detail} Try Chrome 113+, Edge 113+, or Safari 26+ with hardware acceleration on.`
              : `${phase.detail} Check that hardware acceleration is on and a supported GPU is present.`
          }
          sceneHref={sceneHref}
        />
      ) : null}

      {phase.kind === "failed" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "device-lost" ? "The graphics device was lost" : "ICE could not start"
          }
          message={
            phase.reason === "device-lost"
              ? "ICE stopped drawing because the graphics device went away. Nothing was written to your workspace. Reset demo rebuilds the desk."
              : "The desk failed before it could draw. Nothing was written to your workspace. Reset demo retries; if it keeps failing, run `pnpm dev:ice` in a headed Chrome with `--enable-unsafe-webgpu` (`node scripts/ice-chrome.mjs`)."
          }
          detail={phase.detail}
          sceneHref={sceneHref}
        />
      ) : null}

      <div className="ice-surface__badge" data-testid="ice-hud">
        <span className="ice-surface__badge-title">
          {workspaceMode ? "ICE workspace" : "ICE demo"}
        </span>
        <span className="ice-surface__badge-note">
          {workspaceMode
            ? "Live workspace · writes go through Loro"
            : "Experimental — not document truth"}
        </span>
        <span className="ice-surface__badge-status" data-testid="ice-status" aria-live="polite">
          {engineLine(phase, engineState)}
        </span>
        <span className="ice-surface__badge-meta" data-testid="ice-phase">
          phase: {phase.kind}
        </span>
        {workspaceMode ? null : (
          <fieldset className="ice-surface__modes" data-testid="ice-demo-modes">
            <legend>Demo seed</legend>
            <button
              type="button"
              className="ice-surface__button"
              data-testid="ice-demo-native"
              aria-pressed={mode === "native"}
              onClick={() => chooseDemo("native")}
            >
              Native demo
            </button>
            <button
              type="button"
              className="ice-surface__button"
              data-testid="ice-demo-suite"
              aria-pressed={mode === "suite"}
              onClick={() => chooseDemo("suite")}
            >
              Suite demo
            </button>
          </fieldset>
        )}
        <span className="ice-surface__badge-seed" data-testid="ice-demo-summary" aria-live="polite">
          {seed === null
            ? workspaceMode
              ? "Workspace: not seeded"
              : `${demoLabel(mode)}: not seeded`
            : seed.mode === "workspace"
              ? `Workspace: ${seed.seeded} objects / ${seed.boards} boards`
              : seed.mode === "suite"
                ? `Suite demo: ${seed.seeded} objects / ${seed.boards} boards`
                : `Native demo: ${seed.seeded} objects`}
        </span>
        <span className="ice-surface__badge-seed" data-testid="ice-seed">
          {seed === null ? "seeded: —" : `${seed.seeded}/${seed.total} objects seeded`}
        </span>
        {seed !== null && seed.skipped.length > 0 ? (
          <span
            className="ice-surface__badge-meta"
            data-testid="ice-demo-skipped"
            title={seed.skipped.map((skip) => `${skip.reason}: ${skip.detail}`).join("\n")}
          >
            skipped: {skipTally(seed.skipped)}
          </span>
        ) : null}
        <span
          className="ice-surface__badge-meta"
          data-testid="ice-adapter"
          title={adapterLine(phase)}
        >
          {adapterLine(phase)}
        </span>
        <span className="ice-surface__badge-meta" data-testid="ice-fps">
          fps: {fps === null ? "—" : fps}
        </span>
        {seed !== null && seed.failures.length > 0 ? (
          <span
            className="ice-surface__badge-failure"
            data-testid="ice-seed-failures"
            title={seed.failures.join("\n")}
          >
            {seed.failures.join("; ")}
          </span>
        ) : null}
        <div className="ice-surface__actions">
          <button
            type="button"
            className="ice-surface__button"
            data-testid="ice-reset"
            onClick={resetDemo}
          >
            {workspaceMode ? "Reload workspace" : "Reset demo"}
          </button>
          <button
            type="button"
            className="ice-surface__button"
            data-testid="ice-copy-diagnostics"
            onClick={() => {
              void copyDiagnostics();
            }}
          >
            Copy diagnostics
          </button>
        </div>
        {copyState === null ? null : (
          <span
            className="ice-surface__copy-status"
            data-testid="ice-copy-status"
            aria-live="polite"
          >
            {copyState}
          </span>
        )}
        {portalPath.length > 0 ? (
          <span className="ice-surface__badge-meta" data-testid="ice-portal-path">
            Inside {portalPath.join(" › ")} · Escape to return
          </span>
        ) : null}
        <span className="ice-surface__badge-hint">
          {workspaceMode
            ? "Select and drag a card · drag a handle to resize · double-click a mat to enter · Escape returns"
            : "Pan the mat · wheel to zoom · drag a note to move it"}
        </span>
        <a className="ice-surface__link" data-testid="ice-scene-link" href={sceneHref}>
          Back to the scene surface
        </a>
      </div>
    </section>
  );
}

export default IceSurface;
