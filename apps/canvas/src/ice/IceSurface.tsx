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
import {
  type Board,
  boardDepth,
  boardSideAnchor,
  boardWorldRect,
  edgeFrameOf,
  type GraphEdge,
  ownerBoardAt,
  type WorkspaceDocument,
} from "@suite/graph";
import type {
  CanvasEngine,
  DocSession,
  EngineGpu,
  Entity,
  SpawnWidgetOpts,
  World,
} from "@vibecook/ice";

import type { DeskLayerFactory, DeskLayerHandle, DeskLayerStatus } from "@vibecook/ice/desk";
import type {
  DeskHandle,
  Desk as IceDesk,
  EngineProvider as IceEngineProvider,
} from "@vibecook/ice/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import { isWhiteboardCard } from "../cards/whiteboard";
import { usePresenceStore } from "../collab/usePresenceStore";
import { CanvasZoomControls } from "../components/CanvasZoomControls";
import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { useThemeStore } from "../theme/useThemeStore";
import { IceContextMenu } from "./IceContextMenu";
import { applyCanonicalWrite, planEdgeCreate, workspaceWriter } from "./iceBridge";
import {
  type FlightCamera,
  type FlightPlan,
  type FlightViewport,
  flightDone,
  planFlight,
  sampleFlight,
} from "./iceCameraFlight";
import { type CanonicalPlacement, CardProjection } from "./iceCardProjection";
import { contextMenuStateFor, type MenuPick, menuTargetFromPick } from "./iceContextMenu";
import {
  buildIceDebugSnapshot,
  type IceDebugEdge,
  type IceDebugSlot,
  publishIceDebug,
  readIceOverlays,
} from "./iceDebug";
import { anchorWorld } from "./iceEdgeGeometry";
import {
  attachIcePointerEditing,
  createIceEditingController,
  type IceEditableSlot,
} from "./iceEditingController";
import {
  beginLinkDrag,
  boardAnchors,
  type ConnectorAnchor,
  connectorAnchors,
  connectorAt,
  connectSample,
  endLinkDrag,
  type LinkDragState,
  type LinkDragTarget,
  linkHotspotRadius,
  linkMinTravel,
  moveLinkDrag,
  nearestConnector,
} from "./iceLinkDrag";
import { beginMiddlePan, endMiddlePan, type MiddlePanState, updateMiddlePan } from "./iceMiddlePan";
import type { IcePresenceInstance } from "./icePresence";
import { marqueeSample, pointerSample, presenceRoleCaps, selectionSample } from "./icePresence";
import { createIcePresenceLayer } from "./icePresenceLayer";
import { beginPresencePress, presenceDragFor } from "./icePresencePress";
import { publishScreenCamera, screenToWorld } from "./iceScreenToWorld";
import { planCardLanding } from "./iceSelectionLanding";
import { iceShareCaps, withinShareScope } from "./iceShareCaps";
import { SuiteWhiteboardStage } from "./SuiteWhiteboardStage";
import { cardFit } from "./suiteCardFit";
import { cardTypeForScale, scaleForExtent } from "./suiteCardScale";
import { createSuiteConnectorLayer } from "./suiteConnectorLayer";
import { applySuiteDeskLight, type SuiteLightDesk } from "./suiteDeskLight";
import { applySuiteDeskTheme, type SuiteDeskSurface } from "./suiteDeskTheme";
import { type SuiteEdgeEnd, type SuiteEdgeLink, suiteEdgeSpawn } from "./suiteEdgeKind";
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
  readonly entitySlots: Map<Entity, IceEditableSlot>;
  /** Mat entity → the Board it stands for, for camera entry. */
  readonly boardMats: Map<Entity, BoardMat>;
  /** Markers the projection could not resolve; always 0 for the live document. */
  readonly stubs: number;
  /** Pin id → its marker entity on the root board. */
  readonly pinEntities: Map<string, Entity>;
  /** Boards the seed walked: 0 for the native demo, the example's 3 for Suite. */
  readonly boards: number;
  /** Things the seed deliberately did not map, with a reason each. */
  readonly skipped: readonly SeedSkip[];
}

/** A Board's mat on the desk: the frame a double click enters (ADR-0039). */
interface BoardMat {
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
  /** The desk's theme and palette builders, so a theme switch can re-make them. */
  readonly objects: typeof import("@vibecook/ice/desk/objects");
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
 * The engine's world, when it has one. The surface mounts a stub engine in the
 * jsdom tests and a device that has not booted has no world either, so every
 * camera path degrades to "no camera" instead of throwing.
 */
function worldOf(engine: CanvasEngine): World | undefined {
  return (engine as { readonly world?: World }).world;
}

/** A world rect: what Fit View frames. */
interface FitRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Screen margin kept around a fitted View, as a fraction of the viewport. */
const FIT_PADDING = 0.06;
/** A fit is never tighter than this, so an enormous empty View still frames. */
const FIT_MIN_ZOOM = 0.02;
/** …and never closer than this, so a single small card does not fill the screen. */
const FIT_MAX_ZOOM = 4;

/** A usable zoom: the fit limits, with a non-positive request ignored. */
function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return FIT_MIN_ZOOM;
  return Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, zoom));
}

/** A stored extent when it is a real one, else the natural size. */
function extentOf(value: number | undefined, natural: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : natural;
}

/** The camera that centres `bounds` at the zoom that fits it in `viewport`. */
function fitCamera(bounds: FitRect, viewport: FlightViewport): FlightCamera {
  const width = viewport.width * (1 - FIT_PADDING * 2);
  const height = viewport.height * (1 - FIT_PADDING * 2);
  const fit =
    width > 0 && height > 0
      ? Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height))
      : FIT_MIN_ZOOM;
  const zoom = clampZoom(fit);
  // ICE's camera is the world point at the viewport's top-left:
  // `screen = (world - camera) * zoom`.
  return {
    x: bounds.x + bounds.width / 2 - viewport.width / (2 * zoom),
    y: bounds.y + bounds.height / 2 - viewport.height / (2 * zoom),
    zoom,
  };
}

/**
 * `camera` with its zoom replaced, holding the world point under `anchor`
 * (screen px) still — what a zoom-in/zoom-out control asks for.
 */
function zoomedCamera(
  camera: FlightCamera,
  zoom: number,
  anchor: { readonly x: number; readonly y: number },
): FlightCamera {
  const next = clampZoom(zoom);
  if (!(camera.zoom > 0) || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
    return { ...camera, zoom: next };
  }
  const worldX = anchor.x / camera.zoom + camera.x;
  const worldY = anchor.y / camera.zoom + camera.y;
  return { x: worldX - anchor.x / next, y: worldY - anchor.y / next, zoom: next };
}

/**
 * A camera flight is a courtesy, not a rule: a reader who asked the system to
 * reduce motion gets the destination without the travel, and the commit rule
 * and the document are unchanged (ADR-0037 §6).
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
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
    boardMats: new Map(),
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
      boardMats: new Map(),
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
  const entitySlots = new Map<Entity, IceEditableSlot>();
  const boardMats = new Map<Entity, BoardMat>();
  for (const [objectId, entity] of report.objects) {
    const object = byObjectId.get(objectId);
    if (object?.kind === "card" || object?.kind === "note") {
      entitySlots.set(entity, { cardId: object.cardId, boardId: object.boardId });
    }
    if (object?.kind === "minimat") {
      boardMats.set(entity, {
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
    boardMats,
    stubs: 0,
    pinEntities: new Map(),
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
      boardMats: new Map(),
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
  const entitySlots = new Map<Entity, IceEditableSlot>();
  const boardMats = new Map<Entity, BoardMat>();
  for (const [objectId, entity] of report.objects) {
    const object = byObjectId.get(objectId);
    if (object?.kind === "card" || object?.kind === "note") {
      entitySlots.set(entity, { cardId: object.cardId, boardId: object.boardId });
    }
    if (object?.kind === "minimat") {
      boardMats.set(entity, {
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
    boardMats,
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
/**
 * The spawned links and the table that keeps them live.
 *
 * A link is a drawing between two *places*, so each end is described as a
 * placement plus its chain of Board rects (`anchorWorld` folds them into world
 * space). The kind re-routes from that table whenever an endpoint moves, so a
 * drag moves its links with no document write per frame.
 */
interface EdgeSpawns {
  /**
   * Bring the drawn links in line with the document: spawn a link that arrived
   * (a peer drew one, or this seat did), drop one that left. The caller supplies
   * the removal so a stale link disappears without eating the selection.
   */
  sync(removeEntity: (entity: Entity) => void): void;
  /** What the desk is actually drawing, for the dev-only state bridge. */
  debug(): readonly (IceDebugEdge & { readonly entity: Entity })[];
  dispose(): void;
}

/** The middle of a rect: what a Board end measures its facing wall against. */
function rectCentre(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A Board's frame origins, outermost first — the fold `anchorWorld` undoes. */
function boardFrames(
  boards: readonly Board[],
  boardId: string,
): { x: number; y: number; width: number; height: number }[] {
  const path: { x: number; y: number; width: number; height: number }[] = [];
  let current = boards.find((board) => board.id === boardId);
  while (current !== undefined) {
    path.unshift(current.rect);
    const parent = current.parentBoardId;
    current = parent === undefined ? undefined : boards.find((board) => board.id === parent);
  }
  return path;
}

/**
 * Draw the View's links as `suite.edge` objects.
 *
 * Exported for its own tests: the surface's suite mocks the kind, so the only
 * way to prove that a link lands on its connector (and that a link which left
 * the document leaves the desk) is to drive this function directly.
 */
export function spawnLinkEdges(
  engine: CanvasEngine,
  workspace: WorkspaceDocument,
  rootBoardId: string,
  boardMats: ReadonlyMap<Entity, BoardMat>,
  setLinkOf: (next: ((edgeId: string) => SuiteEdgeLink | undefined) | undefined) => void,
): EdgeSpawns {
  // Re-read on every `sync`: a frame a peer moved has to carry its link with it.
  let boards = workspace.listBoards();
  const framesOf = (boardId: string) => boardFrames(boards, boardId);
  /** A Board end, with the frame's current world rect filled in. */
  const withFrame = (end: SuiteEdgeEnd): SuiteEdgeEnd => {
    if (end.boardId === undefined) return end;
    const rect = boardWorldRect(boards, end.boardId);
    return rect === undefined ? { frames: end.frames } : { ...end, frame: rect };
  };
  const placementOf = (cardId: string) =>
    workspace.listPlacements().find((placement) => placement.cardId === cardId);
  /** The plane an end is drawn on: a card's Board, or a frame's parent Board. */
  const planeOfEnd = (id: string, kind: GraphEdge["sourceKind"]): string | undefined =>
    kind === "board"
      ? (boards.find((board) => board.id === id)?.parentBoardId ?? rootBoardId)
      : placementOf(id)?.boardId;
  // A Board's mat on the desk is where its inside lives: a link drawn on that
  // plane is a child of the mat, so entering the Board shows the link at full
  // size and the plane shows it inside the frame's own face.
  const matOf = (boardId: string): Entity | undefined => {
    for (const [entity, mat] of boardMats) {
      if (mat.boardId === boardId) return entity;
    }
    return undefined;
  };

  // The kind owns the link shape; this module only has to hand it back by id.
  const links = new Map<string, SuiteEdgeLink>();
  const spawned = new Map<string, Entity>();
  const drawn = new Map<string, IceDebugEdge>();

  const sync = (removeEntity: (entity: Entity) => void = () => {}): void => {
    boards = workspace.listBoards();
    for (const [edgeId, link] of [...links]) {
      if (link.source.boardId === undefined && link.target.boardId === undefined) continue;
      links.set(edgeId, {
        ...link,
        source: withFrame(link.source),
        target: withFrame(link.target),
      });
    }
    // Only edges that can be drawn count: a link whose end lost its placement
    // is not wanted, so the entity it used to have is reaped below.
    const edges = workspace
      .listSubtreeEdges(rootBoardId)
      .filter(
        (edge) =>
          planeOfEnd(edge.source, edge.sourceKind) !== undefined &&
          planeOfEnd(edge.target, edge.targetKind) !== undefined,
      );
    const wanted = new Set(edges.map((edge) => edge.id));
    for (const [edgeId, entity] of [...spawned]) {
      if (wanted.has(edgeId)) continue;
      removeEntity(entity);
      spawned.delete(edgeId);
      links.delete(edgeId);
      drawn.delete(edgeId);
    }

    for (const edge of edges) {
      if (spawned.has(edge.id) || links.has(edge.id)) continue;
      const sourceBoard = planeOfEnd(edge.source, edge.sourceKind);
      const targetBoard = planeOfEnd(edge.target, edge.targetKind);
      if (sourceBoard === undefined || targetBoard === undefined) continue;
      const frame = edgeFrameOf(boards, sourceBoard, targetBoard);
      if (frame === undefined) continue;

      /**
       * One end as the kind reads it. A card end carries its placement and
       * connectors; a Board end carries the frame's id, and the resolver below
       * turns it into the rect the wall is taken from.
       */
      const endOfEdge = (
        id: string,
        kind: GraphEdge["sourceKind"],
        connectorId: string | undefined,
      ): SuiteEdgeEnd | null => {
        if (kind === "board") return { boardId: id, frames: [] };
        const placement = placementOf(id);
        if (placement === undefined) return null;
        return {
          placement: {
            x: placement.x,
            y: placement.y,
            ...(placement.width === undefined ? {} : { width: placement.width }),
            ...(placement.height === undefined ? {} : { height: placement.height }),
          },
          frames: framesOf(placement.boardId),
          // Without the card's connectors a named connector cannot be resolved,
          // and `anchorWorld` falls back to the card's centre — a link that says
          // it left the east connector would leave the middle instead.
          connectors: workspace.getCard(id)?.connectors ?? [],
          ...(connectorId === undefined ? {} : { connectorId }),
        };
      };
      const from = endOfEdge(edge.source, edge.sourceKind, edge.sourceConnector);
      const to = endOfEdge(edge.target, edge.targetKind, edge.targetConnector);
      if (from === null || to === null) continue;

      // The link is drawn on its frame's plane, so both anchors come off the
      // world and the object is spawned inside that frame — the object's own
      // coordinates are frame-local, and the kind resolves the same frame while
      // the viewer is on the plane.
      const origin = boardWorldRect(boards, frame.boardId) ?? { x: 0, y: 0 };
      const parent = matOf(frame.boardId);
      const sourceRect =
        edge.sourceKind === "board" ? boardWorldRect(boards, edge.source) : undefined;
      const targetRect =
        edge.targetKind === "board" ? boardWorldRect(boards, edge.target) : undefined;
      if (edge.sourceKind === "board" && sourceRect === undefined) continue;
      if (edge.targetKind === "board" && targetRect === undefined) continue;
      // A frame end leaves by the wall facing the other end, so each side is
      // measured against the other's middle before either anchor is taken.
      // A card end's middle is `anchorWorld` with no connector, which is the
      // card's centre; a frame end's is its rect's.
      const cardCentre = (end: SuiteEdgeEnd) =>
        anchorWorld({ placement: end.placement ?? { x: 0, y: 0 }, frames: end.frames });
      const cardAnchor = (end: SuiteEdgeEnd) =>
        anchorWorld({
          placement: end.placement ?? { x: 0, y: 0 },
          frames: end.frames,
          ...(end.connectors === undefined ? {} : { connectors: end.connectors }),
          ...(end.connectorId === undefined ? {} : { connectorId: end.connectorId }),
        });
      const sourceCentre = sourceRect === undefined ? cardCentre(from) : rectCentre(sourceRect);
      const targetCentre = targetRect === undefined ? cardCentre(to) : rectCentre(targetRect);
      // A card end keeps its own anchor — the connector it names, or its centre —
      // and only a frame end is aimed at the other end's wall.
      const worldFrom =
        sourceRect === undefined ? cardAnchor(from) : boardSideAnchor(sourceRect, targetCentre);
      const worldTo =
        targetRect === undefined ? cardAnchor(to) : boardSideAnchor(targetRect, sourceCentre);
      const localFrom = { x: worldFrom.x - origin.x, y: worldFrom.y - origin.y };
      const localTo = { x: worldTo.x - origin.x, y: worldTo.y - origin.y };
      const spawn = suiteEdgeSpawn({
        edgeId: edge.id,
        kind: edge.kind,
        path: edge.path,
        from: localFrom,
        to: localTo,
        arrow: edge.bidirectional,
      });
      try {
        spawned.set(
          edge.id,
          engine.ops.spawnWidget(spawn.type, {
            x: spawn.x,
            y: spawn.y,
            w: spawn.w,
            h: spawn.h,
            props: spawn.props,
            undoable: false,
            ...(parent === undefined ? {} : { parent }),
          }),
        );
        links.set(edge.id, {
          source: withFrame(from),
          target: withFrame(to),
          ...(origin.x === 0 && origin.y === 0 ? {} : { origin }),
        } as SuiteEdgeLink);
        drawn.set(edge.id, {
          edgeId: edge.id,
          frame: frame.boardId,
          from: localFrom,
          to: localTo,
          kind: edge.kind,
          label: edge.label ?? null,
          sourceKind: edge.sourceKind ?? null,
          targetKind: edge.targetKind ?? null,
        });
      } catch (error) {
        // A refused link must not take the canvas with it: the sheet still draws,
        // and the reason is said once so a broken kind is not silent.
        console.warn(`[suite.edge] ${edge.id}: ${describeError(error)}`);
      }
    }
  };

  sync();
  setLinkOf((edgeId) => links.get(edgeId));

  return {
    sync,
    debug: () =>
      [...drawn.values()].map((edge) => ({
        ...edge,
        entity: spawned.get(edge.edgeId) as Entity,
      })),
    dispose() {
      setLinkOf(undefined);
      for (const entity of spawned.values()) {
        try {
          engine.ops.setSelection([entity]);
          engine.ops.deleteSelection();
        } catch {
          // A refused removal is repaired by the next reconcile.
        }
      }
      spawned.clear();
      links.clear();
      drawn.clear();
    },
  };
}

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
}

/** The calm no-desk card. Exported so Storybook can show it without WebGPU. */
export function IceSurfaceFallback({ title, message, detail }: IceSurfaceFallbackProps) {
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
      </div>
    </div>
  );
}

/** The ICE mount. In the app it projects the live workspace read-only. */
export interface IceSurfaceProps {
  /** Where the fallback/HUD returns; the standalone demo overrides it to `/`. */
  /**
   * The live workspace to project. Omit for the standalone demo; `null` means
   * the app has the workspace but it is not hydrated yet, so the surface waits
   * instead of falling back to a demo.
   */
  readonly workspace?: WorkspaceDocument | null;
  /** Root board/View to frame. The surface waits while this is null. */
  readonly rootBoardId?: string | null;
}

export function IceSurface({ workspace, rootBoardId = null }: IceSurfaceProps = {}) {
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
  // The desk follows the app's theme: the mat is neutral in both, and the only
  // coloured things on it are what the user put down (see `suiteDeskTheme.ts`).
  const theme = useThemeStore((state) => state.theme);
  /**
   * The whole workspace, for the two things the surface must follow rather than
   * write: which Boards exist (pointer attribution) and when the document moved
   * under it (a peer's commit). The desk itself stays imperative.
   */
  const snapshot = useWorkspaceSnapshot();
  const pendingPinFocus = useUiStore((state) => state.pendingPinFocus);
  const dropPinRequest = useUiStore((state) => state.dropPinRequest);
  const actorId = useRef(`local-${Math.random().toString(36).slice(2, 10)}`);
  const [runId, setRunId] = useState(0);
  const owned = useRef<{
    engine?: CanvasEngine;
    doc?: DocSession;
    gpu?: EngineGpu;
    clearCardRenderer?: (() => void) | undefined;
    edges?: EdgeSpawns | undefined;
  }>({});
  const pendingFailure = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingFit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seededEntities = useRef<readonly Entity[]>([]);
  /**
   * The Board tree, for pointer attribution ("which Board is this peer in") and
   * for the reconcile that follows a document change. Kept beside the snapshot
   * rather than read from Loro per sample: a pointer moves at 30 Hz, a Board
   * list changes when someone edits the tree.
   */
  const boardsRef = useRef<readonly Board[]>([]);
  /** The screen-space layer host: presence and connectors, above the desk. */
  const overlaysRef = useRef<HTMLDivElement | null>(null);
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
    const { engine, doc, gpu, clearCardRenderer, edges } = owned.current;
    owned.current = {};
    edges?.dispose();
    clearCardRenderer?.();
    if (doc !== undefined) quietly(() => doc.close());
    if (engine !== undefined) quietly(() => engine.dispose());
    if (gpu !== undefined) quietly(() => gpu.destroy());
  }, [clearPendingFailure, clearPendingFit]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `theme` is read once, at mount; the theme effect repaints
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

        // The Suite kinds are loaded for **every** surface, demo included: the
        // demo projects the same example, so a Board is a `suite.board` there
        // too. A kind that is not registered fails its spawn and takes its
        // children with it, which is exactly how the demo went blank once.
        const suiteCardModules = await Promise.all([
          import("./suiteCardKind"),
          import("./suiteCardWorkspace"),
          import("./suitePinKind"),
          import("./suiteBoardKind"),
          import("./suiteEdgeKind"),
        ]);
        if (cancelled) return;
        // Every rung of the card's type ladder is its own kind (ICE fixes a
        // note's type size per kind), so all of them are registered, and
        // `suite.board` is the frame a Board is drawn as.
        const widgets = [
          ...objects.DESK_OBJECTS,
          ...suiteCardModules[0].SUITE_CARD_RUNGS.map((rung) => rung.object),
          suiteCardModules[2].SuitePin,
          suiteCardModules[3].SuiteBoard,
          suiteCardModules[4].SuiteEdge,
        ];

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
        if (SUITE_CARD_DOM_FACE) {
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

        // Links are drawn after the Boards and cards exist: an edge is a line
        // between two *places*, and its frame is the lowest Board that holds
        // both ends (`edgeFrameOf`). The table is what lets the kind re-route a
        // link when a card moves, without reading the document per frame.
        const edges: EdgeSpawns | undefined =
          liveWorkspace !== null && rootBoardId !== null
            ? spawnLinkEdges(
                engine,
                liveWorkspace,
                rootBoardId,
                report.boardMats,
                suiteCardModules[4].setSuiteEdgeLinkOf,
              )
            : undefined;
        owned.current = { ...owned.current, edges };
        const layer = desk.deskLayer({
          theme: objects.deskTheme(theme),
          palette: suitePalette(objects.deskPalette(theme)),
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
          objects,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme is read at submit time and repainted by the theme effect
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
        if (status.state === "ready") {
          // The ground and the light: a neutral mat, and the desk's own
          // tree-shadow dapple switched off (it can only ever be a splotch on an
          // infinite canvas — see `suiteDeskLight.ts`).
          quietly(() => {
            applySuiteDeskTheme(layer as SuiteDeskSurface, theme);
            applySuiteDeskLight(layer as SuiteLightDesk);
          });
          frameDemo();
        }
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
    zoomBy(factor: number): void;
    fitView(): void;
  } | null>(null);
  const [portalPath, setPortalPath] = useState<readonly string[]>([]);
  const portalDepth = useRef(0);
  /** The same path with ids, which the frame contract and the debug bridge need. */
  const portalFramesRef = useRef<readonly { id: string; name: string }[]>([]);
  const [whiteboard, setWhiteboard] = useState<{
    cardId: string;
    box: { left: number; top: number; width: number; height: number; scale: number };
  } | null>(null);
  /**
   * True while a pointer is down on the canvas. The inline whiteboard uses it to
   * suspend its paint rather than being unmounted: a drag, a pan or a resize
   * should not tear down (and rehydrate) an editor.
   */
  const [suspendedStage, setSuspendedStage] = useState(false);
  const [layerReady, setLayerReady] = useState(0);
  const flightRef = useRef<{ plan: FlightPlan; startedAt: number } | null>(null);

  /**
   * The one way to read and move the camera, in **ICE's own convention**: the
   * camera is the world point at the viewport's top-left, so
   * `screen = (world - camera) * zoom` and `world = screen / zoom + camera`.
   *
   * This is the surface's only camera convention now. It used to publish a
   * screen-offset camera while the projection and the overlays applied ICE's
   * formula, which put every peer dot and presence ring a zoom-factor away from
   * the card it belonged to. A camera read here can be handed to ICE unchanged.
   */
  const cameraApi = useMemo(() => {
    if (phase.kind !== "ready") return null;
    const { engine, core } = phase;
    const cameraOf = (): FlightCamera | null => {
      const world = worldOf(engine);
      if (world === undefined) return null;
      const view = world.getResource(core.Camera);
      if (view === undefined) return null;
      const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
      return { x: view.x, y: view.y, zoom };
    };
    const viewportOf = (): FlightViewport | null => {
      const world = worldOf(engine);
      const size = world?.getResource(core.Viewport);
      const root = surfaceRef.current;
      const width = size !== undefined && size.w > 0 ? size.w : (root?.clientWidth ?? 0);
      const height = size !== undefined && size.h > 0 ? size.h : (root?.clientHeight ?? 0);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      return { width, height };
    };
    const write = (camera: FlightCamera): void => {
      const world = worldOf(engine);
      if (world === undefined) return;
      if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
      core.writeRuntimeResource(world, core.Camera, {
        x: camera.x,
        y: camera.y,
        zoom: camera.zoom,
        gesturing: false,
      });
    };
    return { cameraOf, viewportOf, write };
  }, [phase]);

  /**
   * Navigation is movement (ADR-0037 §6): every camera change is a flight,
   * planned from the distance and sampled per frame. No `zoomTo`, `panTo` or
   * `zoomToFit` shortcut lives on this path — the only `zoomToFit` left is the
   * initial demo framing.
   */
  const flyTo = useCallback(
    (target: FlightCamera | null): void => {
      if (cameraApi === null || target === null) return;
      if (prefersReducedMotion()) {
        cameraApi.write(target);
        return;
      }
      const from = cameraApi.cameraOf();
      if (from === null) return;
      const plan = planFlight(from, target, cameraApi.viewportOf());
      if (!plan.moving) {
        cameraApi.write(plan.to);
        return;
      }
      flightRef.current = { plan, startedAt: performance.now() };
    },
    [cameraApi],
  );

  // The Board tree is attribution data and content bounds; a pointer sample
  // reads it 30 times a second, so it is cached rather than rebuilt.
  useEffect(() => {
    boardsRef.current = snapshot.boards;
  }, [snapshot.boards]);

  /**
   * Convergence: a document change this seat did not make — a peer's drag, a
   * link drawn elsewhere, an undo — has to reach the desk. The projection is
   * derived, so the answer is always "reconcile from the document", coalesced to
   * one pass per frame because a sync of a 5k workspace is not a keystroke cost.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot arrays are the trigger; reconcile reads the document directly.
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null) return;
    const handle = requestAnimationFrame(() => commandsRef.current?.reconcile());
    return () => cancelAnimationFrame(handle);
  }, [
    snapshot.cards,
    snapshot.edges,
    snapshot.boards,
    phase.kind,
    seed,
    layerReady,
    workspaceMode,
    liveWorkspace,
  ]);

  // The editable root board: drag and resize commit once per gesture, delete is
  // one trash write, and undo/redo are Loro's. ICE's own history is never read.
  useEffect(() => {
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null || rootBoardId === null) return;
    const root = surfaceRef.current;
    const desk = deskLayerRef.current;
    const overlays = overlaysRef.current;
    if (root === null || desk === null || overlays === null) return;

    const { engine, core } = phase;
    const slots = seed.entitySlots;

    /** One camera convention, and it is ICE's: see `cameraApi` above. */
    const cameraOf = () => cameraApi?.cameraOf() ?? null;

    // The committed rect is the widget's own `Position`/`Size`, never the
    // paper's drawn extents: `half` is "as drawn", so it carries the hold's
    // lift and would commit a shifted card.
    const rectOf = (entity: Entity) => {
      // A projected slot can outlive its entity for one tick (a replace, a
      // teardown, a peer's delete); reading a missing component throws, so the
      // box is asked for only when the entity still carries one.
      if (!phase.engine.world.has(entity, phase.core.Position)) return null;
      if (!phase.engine.world.has(entity, phase.core.Size)) return null;
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

    /** The View's live placements: trashed cards are not on the View. */
    const livePlacements = () =>
      liveWorkspace.listBoardPlacements(rootBoardId).filter((placement) => {
        const card = liveWorkspace.getCard(placement.cardId);
        // A trashed card keeps its placement; it is simply not on the View.
        return card !== undefined && !card.deletedAt;
      });

    /** Fit View frames the whole View; a Board's frame counts as content. */
    const contentBounds = (): FitRect | null => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let seen = false;
      const include = (x: number, y: number, width: number, height: number): void => {
        if (![x, y, width, height].every((value) => Number.isFinite(value))) return;
        seen = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
      };
      for (const placement of livePlacements()) {
        include(
          placement.x,
          placement.y,
          extentOf(placement.width, DEFAULT_CARD_WIDTH),
          extentOf(placement.height, DEFAULT_CARD_HEIGHT),
        );
      }
      for (const section of liveWorkspace.listSections(rootBoardId)) {
        include(section.x, section.y, section.width, section.height);
      }
      if (!seen) return null;
      return {
        x: minX,
        y: minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      };
    };

    const projection = new CardProjection<Entity>({
      spawn: (placement: CanonicalPlacement) => {
        // The rung is the card's own: a reflow resize stores one, and every
        // other card derives it from its extent. Same function either way, so a
        // freshly dropped card and a reflowed one cannot disagree.
        const entity = engine.ops.spawnWidget(cardTypeForScale(cardScaleOf(placement)), {
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
        slots.set(entity, {
          cardId: placement.cardId,
          boardId: placement.boardId,
          text: placement.text ?? "",
        });
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
      keyOf: (placement) => `${placement.text ?? ""}\u001f${cardScaleOf(placement)}`,
    });

    /** The View's live placements, in the shape the projection reconciles. */
    const canonicalPlacements = (): CanonicalPlacement[] =>
      livePlacements().map((placement) => ({
        boardId: placement.boardId,
        cardId: placement.cardId,
        x: placement.x,
        y: placement.y,
        text: faceText(placement.cardId),
        ...(placement.width !== undefined ? { width: placement.width } : {}),
        ...(placement.height !== undefined ? { height: placement.height } : {}),
        ...(placement.typeScale !== undefined ? { typeScale: placement.typeScale } : {}),
      }));

    // Seed the projection with the *same* render key a reconcile computes, or
    // the first reconcile would replace every card it was handed: the key is
    // text plus rung, and a registration that carried only the text would not
    // match itself.
    const seededPlacements = new Map(
      canonicalPlacements().map((placement) => [placement.cardId, placement]),
    );
    for (const [entity, slot] of seed.entitySlots) {
      const placement = seededPlacements.get(slot.cardId);
      const text = faceText(slot.cardId);
      projection.register(
        entity,
        slot.cardId,
        slot.boardId,
        placement === undefined ? text : `${text}\u001f${cardScaleOf(placement)}`,
      );
    }

    /**
     * The rung a card's writing is laid out at: the stored rung when a reflow
     * pinned one, otherwise what its box implies — and in either case the
     * writing has the last word, so a card is never drawn with text that runs
     * off it (`suiteCardFit.ts`).
     */
    function cardScaleOf(placement: CanonicalPlacement): number {
      const proposed = placement.typeScale ?? scaleForExtent(placement);
      // No size on the placement means the card's natural extent, which the fit
      // module resolves itself; a stored rung is a request, not a promise.
      const extent = {
        width: placement.width ?? DEFAULT_CARD_WIDTH,
        height: placement.height ?? DEFAULT_CARD_HEIGHT,
      };
      const fitted = cardFit(placement.text ?? "", extent).rung;
      return Math.min(proposed, fitted);
    }

    /** Re-apply the shell's selection after entities were spawned or removed. */
    const restoreSelection = (): void => {
      const selected = useUiStore
        .getState()
        .selectedNodeIds.map((cardId) => projection.entityOf(cardId))
        .filter((entity): entity is Entity => entity !== undefined);
      try {
        if (selected.length > 0) engine.ops.setSelection(selected);
      } catch {
        // A refused selection is cosmetic; the next click repairs it.
      }
    };

    /** The card faces: one widget per live placement. */
    const reconcileCards = () => {
      const report = projection.reconcile(canonicalPlacements(), {
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
        restoreSelection();
      }
    };

    /**
     * A document change: re-derive what the desk draws from the new truth.
     * Cards and links both, because a link is document data too — one a peer
     * drew must appear here without a reload, and one they deleted must go.
     */
    const reconcile = () => {
      reconcileCards();
      const edges = owned.current.edges;
      if (edges !== undefined) {
        edges.sync((entity) => removeEntities([entity]));
        restoreSelection();
      }
    };

    /**
     * One notch of the zoom cluster.
     *
     * This is *not* a flight. A flight is for travelling somewhere (a card, a
     * type); a zoom step is a continuous adjustment, and animating
     * each one made a held button hop and lag behind the pointer. The camera is
     * written at once, so clicks and holds both feel like the wheel they stand
     * in for. The anchor is the viewport centre, so the step keeps whatever is
     * in the middle of the screen in the middle of the screen.
     */
    const zoomBy = (factor: number): void => {
      const camera = cameraApi?.cameraOf() ?? null;
      const viewport = cameraApi?.viewportOf() ?? null;
      if (camera === null || viewport === null) return;
      if (!Number.isFinite(factor) || factor <= 0) return;
      // A step interrupts a flight: the user is steering, and the flight was
      // taking them elsewhere.
      flightRef.current = null;
      cameraApi?.write(
        zoomedCamera(camera, camera.zoom * factor, {
          x: viewport.width / 2,
          y: viewport.height / 2,
        }),
      );
    };

    /**
     * Fit the View's content. The View is the frame, so this frames its cards
     * and its sections — never the whole workspace, and never a fixed scale.
     */
    const fitView = (): void => {
      const viewport = cameraApi?.viewportOf() ?? null;
      if (viewport === null) return;
      const bounds = contentBounds();
      // An empty View has nothing to frame; the camera stays where it is.
      if (bounds === null) return;
      flyTo(fitCamera(bounds, viewport));
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
      // A mat drag or handle writes the Board's rect, not a card placement.
      boardSlots: new Map(
        [...seed.boardMats].map(([entity, mat]) => [
          entity,
          { boardId: mat.boardId, parentBoardId: mat.parentBoardId },
        ]),
      ),
      frameOriginOf: (parentBoardId) => {
        const rect = boardWorldRect(boardsRef.current, parentBoardId);
        return rect === undefined ? { x: 0, y: 0 } : { x: rect.x, y: rect.y };
      },
    });

    /**
     * The link gesture's abort, assigned below once the gesture state exists.
     * Escape asks it first: while a link is being drawn it owns the pointer.
     */
    let cancelLinkDrag: (() => boolean) | null = null;

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
        // A link drag is the first thing Escape abandons: it owns the pointer.
        if (cancelLinkDrag?.() === true) return;
        // Escape is the return gesture: out of a mat before out of a gesture.
        if (portalDepth.current > 0) {
          try {
            engine.ops.exitContainer();
            portalDepth.current -= 1;
            portalFramesRef.current = portalFramesRef.current.slice(0, -1);
            setPortalPath((path) => path.slice(0, -1));
          } catch {
            // A refused exit leaves the camera where it is.
          }
          return;
        }
        engine.ops.cancelActiveGestures();
      },
      zoomBy,
      fitView,
    };

    const detach = attachIcePointerEditing(root, controller);

    const presence = usePresenceStore.getState();
    const roleCaps = presenceRoleCaps(caps.role);
    boardsRef.current = liveWorkspace.listBoards();

    const localPoint = (event: PointerEvent): { x: number; y: number } => {
      const bounds = root.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };

    /* ---------------------------------------------------------------- *
     * Drawing a link
     *
     * A press within a connector's hotspot starts a link instead of a
     * card move. The claim is made in the capture phase on the surface
     * root, before ICE's own listener on the desk below it, so the card
     * is never picked up: a link drag and a move cannot both start.
     *
     * One commit at pointer-up through the bridge planner, then the
     * ordinary reconcile draws it. Nothing is written while the drag is
     * in flight; the preview is a line in an inert layer.
     * ---------------------------------------------------------------- */
    const canLink = caps.bridge.write && roleCaps.drag;
    let linkDrag: LinkDragState | null = null;
    let hover: { readonly entity: Entity; readonly anchors: readonly ConnectorAnchor[] } | null =
      null;
    let lastHoverAt = 0;

    /**
     * The anchors an entity offers a link. A card offers its connectors; a Board
     * offers the midpoints of its four walls, because a frame has no perimeter
     * to hang a connector on (ADR-0041).
     */
    const connectorsOf = (entity: Entity): ConnectorAnchor[] => {
      const rect = rectOf(entity);
      if (rect === null) return [];
      const mat = seed.boardMats.get(entity);
      if (mat !== undefined) return boardAnchors(rect);
      const slot = slots.get(entity);
      if (slot === undefined) return [];
      const card = liveWorkspace.getCard(slot.cardId);
      if (card === undefined) return [];
      return connectorAnchors(card.connectors, rect);
    };

    /** What an entity is, as a link end: a card's id, or a Board's. */
    const endOf = (entity: Entity): { id: string; kind: "card" | "board" } | null => {
      const mat = seed.boardMats.get(entity);
      if (mat !== undefined) return { id: mat.boardId, kind: "board" };
      const slot = slots.get(entity);
      return slot === undefined ? null : { id: slot.cardId, kind: "card" };
    };

    const linkLayer = createSuiteConnectorLayer({
      container: overlays,
      camera: () => cameraApi?.cameraOf() ?? null,
      anchors: () => hover?.anchors ?? [],
      drag: () =>
        linkDrag === null
          ? null
          : {
              from: linkDrag.anchor,
              pointer: linkDrag.pointer,
              target: linkDrag.target?.point ?? null,
            },
    });
    overlays.append(linkLayer.layer);

    const cancelLink = (): boolean => {
      if (linkDrag === null) return false;
      linkDrag = null;
      hover = null;
      presence.setConnect(null);
      linkLayer.sync();
      return true;
    };
    cancelLinkDrag = cancelLink;

    const finishLink = (): void => {
      if (linkDrag === null) return;
      const intent = endLinkDrag(linkDrag);
      linkDrag = null;
      hover = null;
      presence.setConnect(null);
      linkLayer.sync();
      if (intent === null) return;
      try {
        const plan = planEdgeCreate(intent, { capabilities: caps.bridge });
        if (plan.status === "commit") {
          applyCanonicalWrite(workspaceWriter(liveWorkspace), plan.write);
        }
      } catch (error) {
        // A refused link leaves the document untouched; the desk already
        // dropped the preview, so there is nothing to undo.
        console.warn("[ice] could not draw link", describeError(error));
      }
      reconcile();
    };

    const updateLink = (
      screen: { x: number; y: number },
      world: { x: number; y: number },
    ): void => {
      if (linkDrag === null) return;
      const entity = pickEntity(screen);
      let target: LinkDragTarget | null = null;
      if (entity !== null) {
        const anchors = connectorsOf(entity);
        const end = endOf(entity);
        if (anchors.length > 0) hover = { entity, anchors };
        if (end !== null && !(end.kind === linkDrag.source.kind && end.id === linkDrag.source.id)) {
          const nearest = nearestConnector(anchors, world);
          if (nearest !== null) {
            target = {
              kind: end.kind,
              id: end.id,
              ...(end.kind === "card" ? { connectorId: nearest.connectorId } : {}),
              point: nearest.point,
            };
          }
        }
      } else if (hover !== null) {
        hover = null;
      }
      linkDrag = moveLinkDrag(linkDrag, world, target);
      presence.setConnect(connectSample(linkDrag));
      linkLayer.sync();
    };

    const onLinkDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !canLink) return;
      const camera = cameraApi?.cameraOf() ?? null;
      if (camera === null) return;
      const screen = localPoint(event);
      const world = screenToWorld(screen, camera);
      // A dot sits *on* the edge, so the press can land a hair outside the
      // object: the entity under the pointer answers first, then the one the
      // dots were offered for.
      const picked = pickEntity(screen);
      const candidates = [picked, hover?.entity ?? null].filter(
        (entity): entity is Entity => entity !== null,
      );
      let started: LinkDragState | null = null;
      let startedOn: { entity: Entity; anchors: ConnectorAnchor[] } | null = null;
      for (const entity of candidates) {
        const end = endOf(entity);
        if (end === null) continue;
        const anchors = connectorsOf(entity);
        const anchor = connectorAt(anchors, world, linkHotspotRadius(camera.zoom));
        if (anchor === null) continue;
        started = beginLinkDrag({
          boardId: rootBoardId,
          id: end.id,
          kind: end.kind,
          connectorId: anchor.connectorId,
          anchor: anchor.point,
          pointer: world,
          minTravel: linkMinTravel(camera.zoom),
        });
        if (started !== null) {
          startedOn = { entity, anchors };
          break;
        }
      }
      if (started === null || startedOn === null) return;
      linkDrag = started;
      hover = startedOn;
      // Claim the press before ICE's desk sees it, and keep the moves coming
      // when the pointer leaves the surface mid-drag.
      event.preventDefault();
      event.stopPropagation();
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        // No capture available: the root's own listeners still see the drag
        // while the pointer is over it, and Escape abandons the rest.
      }
      presence.setConnect(connectSample(started));
      presence.setPointer(null);
      linkLayer.sync();
    };

    const onLinkUp = (event: PointerEvent): void => {
      if (linkDrag === null) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        root.releasePointerCapture(event.pointerId);
      } catch {
        // The capture may already be gone; releasing twice is not an error.
      }
      finishLink();
    };

    const onLinkCancel = (): void => {
      cancelLink();
    };

    root.addEventListener("pointerdown", onLinkDown, true);
    root.addEventListener("pointerup", onLinkUp, true);
    root.addEventListener("pointercancel", onLinkCancel, true);

    /* ---------------------------------------------------------------- *
     * Peer presence
     *
     * Presence is published from the surface that owns the camera: a peer
     * sample is a point in the document, and only ICE knows where the
     * document is on screen. Three rules hold it together:
     *
     * - the seat's role decides what may be published (a viewer points and
     *   selects, never drags or draws a marquee);
     * - a sample is throttled to a peer redraw rate, not a frame rate;
     * - `board` stays the View so peers on one View always see each other,
     *   while `boardOf` carries the deepest Board under the pointer — the
     *   attribution a flattened View cannot express.
     * ---------------------------------------------------------------- */

    const paintPointer = (event: PointerEvent): void => {
      if (!roleCaps.pointer) return;
      const camera = cameraApi?.cameraOf() ?? null;
      if (camera === null) return;
      const point = screenToWorld(localPoint(event), camera);
      presence.setPointer(pointerSample(point, camera));
      presence.setBoardOf(ownerBoardAt(boardsRef.current, rootBoardId, point));
    };

    let press: ReturnType<typeof beginPresencePress> = null;
    let pressEntity: Entity | null = null;
    let lastMarquee: { x: number; y: number; width: number; height: number } | null = null;
    let dragPublished = false;
    let watchHandle = 0;
    let lastWatchAt = 0;
    let lastPointerAt = 0;
    const PRESENCE_INTERVAL_MS = 33;

    /** The in-flight gesture pass: a drag ghost and a marquee, at peer rate. */
    const watch = (now: number): void => {
      watchHandle = requestAnimationFrame(watch);
      if (now - lastWatchAt < PRESENCE_INTERVAL_MS) return;
      lastWatchAt = now;

      if (press === null || pressEntity === null) {
        if (dragPublished) {
          dragPublished = false;
          presence.setDragging(null);
        }
      } else {
        const drag = presenceDragFor(
          press,
          rectOf(pressEntity),
          useUiStore.getState().selectedNodeIds,
        );
        if (drag !== null) {
          dragPublished = true;
          presence.setDragging(drag);
        } else if (dragPublished) {
          // The card came back to where it was pressed: the gesture is over.
          dragPublished = false;
          presence.setDragging(null);
        }
      }

      if (roleCaps.marquee) {
        const buffer = phase.engine.stack?.marqueeBuffer?.rect ?? null;
        const box =
          buffer === null
            ? null
            : marqueeSample({ x: buffer.x, y: buffer.y, width: buffer.w, height: buffer.h });
        const key = box === null ? "" : `${box.x}:${box.y}:${box.width}:${box.height}`;
        const previous =
          lastMarquee === null
            ? ""
            : `${lastMarquee.x}:${lastMarquee.y}:${lastMarquee.width}:${lastMarquee.height}`;
        if (key !== previous) {
          lastMarquee = box;
          presence.setSelectionBox(box);
        }
      }
    };

    const startWatch = (): void => {
      if (watchHandle !== 0) return;
      watchHandle = requestAnimationFrame(watch);
    };

    const onPresenceDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      // A link drag already claimed this press (its listener runs first).
      if (linkDrag !== null) return;
      if (!roleCaps.drag && !roleCaps.marquee) return;
      // A press is not a drag: the ghost only exists once the card moved, and
      // the watch loop is what notices that.
      startWatch();
      if (!roleCaps.drag) return;
      const entity = pickEntity(localPoint(event));
      if (entity === null) return;
      const slot = slots.get(entity);
      if (slot === undefined) return;
      press = beginPresencePress({
        cardId: slot.cardId,
        planeId: rootBoardId,
        box: rectOf(entity),
      });
      pressEntity = press === null ? null : entity;
    };

    /** Show a card's connectors while the pointer rests on it. */
    const updateHover = (event: PointerEvent): void => {
      // A seat that cannot draw a link is not offered one: the dots are a
      // promise the press keeps.
      if (!canLink) return;
      const now = performance.now();
      if (now - lastHoverAt < 50) return;
      lastHoverAt = now;
      // A Board mat is an end too, so the test is "can this take a link", not
      // "is this a card".
      const screen = localPoint(event);
      const entity = pickEntity(screen);
      if (entity === null && hover !== null) {
        // The dots sit on the edge, so reaching for one takes the pointer just
        // outside the object it belongs to. The offer stays while the pointer is
        // within a hotspot of it; only leaving that clears it.
        const camera = cameraApi?.cameraOf() ?? null;
        const radius = camera === null ? 0 : linkHotspotRadius(camera.zoom) * 2;
        if (
          camera !== null &&
          connectorAt(hover.anchors, screenToWorld(screen, camera), radius) !== null
        ) {
          return;
        }
      }
      if (entity === null || endOf(entity) === null) {
        if (hover !== null) {
          hover = null;
          linkLayer.sync();
        }
        return;
      }
      hover = { entity, anchors: connectorsOf(entity) };
      linkLayer.sync();
    };

    let pointerFrame = 0;
    const onPresenceMove = (event: PointerEvent): void => {
      if (linkDrag !== null) {
        const camera = cameraApi?.cameraOf() ?? null;
        if (camera === null) return;
        const screen = localPoint(event);
        updateLink(screen, screenToWorld(screen, camera));
        return;
      }
      updateHover(event);
      if (!roleCaps.pointer || press !== null || pointerFrame !== 0) return;
      const now = performance.now();
      if (now - lastPointerAt < PRESENCE_INTERVAL_MS) return;
      lastPointerAt = now;
      // One sample per frame at most: pointermove can arrive far faster than a
      // peer can draw, and every publish is an awareness message.
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        paintPointer(event);
      });
    };

    const endPresenceGesture = (): void => {
      if (dragPublished) presence.setDragging(null);
      dragPublished = false;
      press = null;
      pressEntity = null;
      if (watchHandle !== 0) {
        cancelAnimationFrame(watchHandle);
        watchHandle = 0;
      }
      if (lastMarquee !== null) {
        lastMarquee = null;
        presence.setSelectionBox(null);
      }
    };

    const onPresenceLeave = (): void => {
      // A link drag keeps its pointer state: leaving the surface is the drag
      // passing over the shell, not the reader abandoning the gesture.
      if (linkDrag === null && hover !== null) {
        hover = null;
        linkLayer.sync();
      }
      presence.setPointer(null);
      presence.setBoardOf(null);
    };

    const onPresenceUp = (): void => endPresenceGesture();

    root.addEventListener("pointerdown", onPresenceDown, true);
    root.addEventListener("pointermove", onPresenceMove);
    root.addEventListener("pointerup", onPresenceUp, true);
    root.addEventListener("pointercancel", onPresenceUp, true);
    root.addEventListener("pointerleave", onPresenceLeave);

    // A selection is state, not a gesture: publish it when it changes, never on
    // a frame. A viewer keeps this bit; the ghost and the marquee are withheld.
    const unsubscribeSelection = useUiStore.subscribe((state, previous) => {
      if (
        state.selectedNodeIds === previous.selectedNodeIds &&
        state.selectedEdgeIds === previous.selectedEdgeIds
      ) {
        return;
      }
      presence.setSelection(selectionSample(state.selectedNodeIds, state.selectedEdgeIds));
    });

    /* ---------------------------------------------------------------- *
     * The presence layer
     *
     * One inert DOM layer over the desk. It is painted from the same
     * projection the peers are published through, so what this seat draws
     * and what a peer draws cannot drift. The instances are the entities
     * the desk actually holds, in board units — the camera is the only
     * thing that turns them into screen pixels.
     * ---------------------------------------------------------------- */
    const presenceLayer = createIcePresenceLayer({
      container: overlays,
      peers: () => usePresenceStore.getState().peers,
      boardId: rootBoardId,
      camera: () => cameraApi?.cameraOf() ?? null,
      instances: () => {
        const list: IcePresenceInstance[] = [];
        for (const [entity, slot] of slots) {
          const rect = rectOf(entity);
          if (rect === null) continue;
          list.push({
            instanceKey: `card:${slot.cardId}`,
            cardId: slot.cardId,
            boardId: rootBoardId,
            rect,
          });
        }
        return list;
      },
      boardName: (boardId) => boardsRef.current.find((board) => board.id === boardId)?.name,
      viewport: () => cameraApi?.viewportOf() ?? null,
      anchorOf: (cardId, connectorId) => {
        const placement = liveWorkspace.listPlacements().find((entry) => entry.cardId === cardId);
        if (placement === undefined) return null;
        const card = liveWorkspace.getCard(cardId);
        if (card === undefined) return null;
        return anchorWorld({
          placement: {
            x: placement.x,
            y: placement.y,
            ...(placement.width === undefined ? {} : { width: placement.width }),
            ...(placement.height === undefined ? {} : { height: placement.height }),
          },
          frames: boardFrames(boardsRef.current, placement.boardId),
          connectors: card.connectors,
          connectorId,
        });
      },
    });
    overlays.append(presenceLayer.layer);

    // 20 Hz: peers publish at roughly that rate, and a cursor that moves one
    // frame late is invisible, while a layer rebuilt every frame is not free.
    let presenceSyncHandle = 0;
    let lastPresenceSync = 0;
    const syncPresence = (now: number): void => {
      presenceSyncHandle = requestAnimationFrame(syncPresence);
      if (now - lastPresenceSync < 50) return;
      lastPresenceSync = now;
      presenceLayer.sync();
      // Connectors ride the same clock: a pan or a peer's drag moves their
      // world anchors, and a dot that lags the card is a dot that lies.
      linkLayer.sync();

      // The lab runner reads this; a production page never builds it.
      if (import.meta.env.DEV) {
        const boards = boardsRef.current;
        const slotStates: IceDebugSlot[] = [];
        for (const [entity, slot] of slots) {
          // ICE reports a widget's Position in world units, even for a child of
          // a Board; the plane rect is what it is, and the local one is what a
          // commit writes (the placement is frame-local).
          const world = rectOf(entity);
          if (world === null) continue;
          const board = boardWorldRect(boards, slot.boardId);
          slotStates.push({
            entity,
            cardId: slot.cardId,
            boardId: slot.boardId,
            local:
              board === undefined
                ? world
                : { ...world, x: world.x - board.x, y: world.y - board.y },
            world,
          });
        }
        publishIceDebug(
          buildIceDebugSnapshot({
            at: now,
            camera: cameraApi?.cameraOf() ?? null,
            entered: portalFramesRef.current,
            boards: boards.flatMap((board) => {
              const world = boardWorldRect(boards, board.id);
              if (world === undefined) return [];
              return [
                {
                  id: board.id,
                  name: board.name,
                  parentBoardId: board.parentBoardId ?? null,
                  depth: boardDepth(boards, board.id),
                  world,
                  mat: (() => {
                    for (const [entity, entry] of seed.boardMats) {
                      if (entry.boardId === board.id) return rectOf(entity);
                    }
                    return null;
                  })(),
                },
              ];
            }),
            slots: slotStates,
            edges: (owned.current.edges?.debug() ?? []).map((edge) => ({
              edgeId: edge.edgeId,
              frame: edge.frame,
              from: edge.from,
              to: edge.to,
              kind: edge.kind,
              label: edge.label,
              sourceKind: edge.sourceKind,
              targetKind: edge.targetKind,
              box: rectOf(edge.entity),
            })),
            overlays: readIceOverlays(overlays),
            peers: usePresenceStore.getState().peers,
            selection: useUiStore.getState().selectedNodeIds,
          }),
        );
      }
    };
    presenceSyncHandle = requestAnimationFrame(syncPresence);

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
      const mat = seed.boardMats.get(entity);
      if (mat !== undefined) {
        try {
          engine.ops.enterContainer(entity);
          portalDepth.current += 1;
          portalFramesRef.current = [
            ...portalFramesRef.current,
            { id: mat.boardId, name: mat.title },
          ];
          setPortalPath((path) => [...path, mat.title]);
        } catch {
          // A refused entry leaves the camera where it is.
        }
        return;
      }
      // A whiteboard card opens its editor on a double click. Hover is not
      // consent: mounting the drawing surface because the pointer rested on a
      // card covers the board with Excalidraw's chrome, which is not what a
      // reader asked for.
      const slot = seed.entitySlots.get(entity);
      const card = slot === undefined ? undefined : liveWorkspace.getCard(slot.cardId);
      if (slot === undefined || card === undefined || !isWhiteboardCard(card)) return;
      const geometry = desk.geometryOf(entity) as
        | { centre?: readonly [number, number]; half?: readonly [number, number] }
        | undefined;
      const view = engine.world.getResource(core.Camera);
      if (geometry?.centre === undefined || geometry.half === undefined || view === undefined)
        return;
      const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
      const worldWidth = Math.abs(geometry.half[0]) * 2;
      const worldHeight = Math.abs(geometry.half[1]) * 2;
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
    };
    root.addEventListener("dblclick", onDouble);

    // While a pointer is down the canvas is being driven, not read: the inline
    // whiteboard suspends its paint instead of being unmounted, so its editor
    // keeps its caret and Excalidraw keeps its own camera.
    const suspendOn = (): void => setSuspendedStage(true);
    const suspendOff = (): void => setSuspendedStage(false);
    root.addEventListener("pointerdown", suspendOn, true);
    root.addEventListener("pointerup", suspendOff, true);
    root.addEventListener("pointercancel", suspendOff, true);

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
        boards: seed.boardMats,
        sections: new Map(),
        edges: new Map(),
      });
      const store = useUiStore.getState();
      // The menu acts on the selection, so a right-click selects what it hit.
      if (target?.kind === "node") {
        const cardId = target.cardId;
        if (cardId !== undefined && !store.selectedNodeIds.includes(cardId)) {
          store.selectSection(null);
          store.setSelectedNodeIds([cardId]);
        }
      } else if (target?.kind === "board") {
        // A mat is a Board: selecting it selects the frame it stands for.
        store.selectSection(target.boardId ?? null);
        store.setSelectedNodeIds([]);
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
              : { x: view.x, y: view.y, zoom: view.zoom || 1 },
          target,
        }),
      );
    };
    root.addEventListener("contextmenu", onContextMenu);

    /* ---------------------------------------------------------------- *
     * Middle-button panning (iceMiddlePan)
     *
     * ICE reaches its `buttons & 4` check only for a press that landed on
     * the bare canvas: a press captured by a widget with `Position` is
     * routed as a move first. A capture-phase listener on the surface root
     * runs before the desk's own listener, so a middle press over a card, a
     * mat or any overlay is taken here, and ICE never sees it at all — its
     * pan cannot compete with this one.
     * ---------------------------------------------------------------- */
    let middlePan: MiddlePanState | null = null;

    function onMiddleMove(event: PointerEvent): void {
      if (middlePan === null) return;
      const move = updateMiddlePan(middlePan, {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      });
      middlePan = { ...middlePan, moved: move.moved };
      // Sub-threshold travel is a click in waiting: nothing is written.
      if (!move.moved) return;
      cameraApi?.write(move.camera);
    }

    function stopMiddleListeners(): void {
      window.removeEventListener("pointermove", onMiddleMove);
      window.removeEventListener("pointerup", onMiddleUp);
      window.removeEventListener("pointercancel", onMiddleUp);
    }

    function onMiddleUp(event: PointerEvent): void {
      if (middlePan === null) return;
      const { pointerId } = middlePan;
      if (pointerId !== undefined && event.pointerId !== pointerId) return;
      // A click never moved the camera and a drag was already written move by
      // move, so releasing changes nothing either way.
      endMiddlePan(middlePan);
      middlePan = null;
      stopMiddleListeners();
    }

    function onMiddleDown(event: PointerEvent): void {
      if (event.button !== 1) return;
      // Before the desk: no move gesture, no focus change, no browser
      // autoscroll. The capture phase is what makes this work over a card.
      event.preventDefault();
      event.stopPropagation();
      middlePan = beginMiddlePan(
        {
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          isPrimary: event.isPrimary,
        },
        cameraApi?.cameraOf() ?? null,
      );
      if (middlePan === null) return;
      window.addEventListener("pointermove", onMiddleMove);
      window.addEventListener("pointerup", onMiddleUp);
      window.addEventListener("pointercancel", onMiddleUp);
    }

    root.addEventListener("pointerdown", onMiddleDown, true);
    // A middle click over the canvas opens the browser's autoscroll widget
    // unless the press and the `auxclick` that follows are both refused.
    const onMiddleAux = (event: MouseEvent): void => {
      if (event.button === 1) event.preventDefault();
    };
    root.addEventListener("auxclick", onMiddleAux);

    return () => {
      root.removeEventListener("dblclick", onDouble);
      root.removeEventListener("pointerdown", suspendOn, true);
      root.removeEventListener("pointerup", suspendOff, true);
      root.removeEventListener("pointercancel", suspendOff, true);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("pointerdown", onMiddleDown, true);
      root.removeEventListener("auxclick", onMiddleAux);
      root.removeEventListener("pointerdown", onPresenceDown, true);
      root.removeEventListener("pointermove", onPresenceMove);
      root.removeEventListener("pointerup", onPresenceUp, true);
      root.removeEventListener("pointercancel", onPresenceUp, true);
      root.removeEventListener("pointerleave", onPresenceLeave);
      root.removeEventListener("pointerdown", onLinkDown, true);
      root.removeEventListener("pointerup", onLinkUp, true);
      root.removeEventListener("pointercancel", onLinkCancel, true);
      cancelLink();
      cancelLinkDrag = null;
      linkLayer.dispose();
      unsubscribeSelection();
      if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
      endPresenceGesture();
      presence.setPointer(null);
      presence.setBoardOf(null);
      cancelAnimationFrame(presenceSyncHandle);
      presenceLayer.dispose();
      middlePan = null;
      stopMiddleListeners();
      detach();
      controller.cancel();
      commandsRef.current = null;
      portalDepth.current = 0;
      portalFramesRef.current = [];
      setPortalPath([]);
    };
  }, [
    phase,
    seed,
    layerReady,
    workspaceMode,
    liveWorkspace,
    rootBoardId,
    caps.controllerRole,
    caps.role,
    caps.bridge,
    cameraApi,
    flyTo,
  ]);

  /**
   * One per-frame pass over the *camera*: advance a flight and publish the zoom.
   * Nothing here aggregates a document, so it is a handful of comparisons per
   * frame and O(1) work.
   */
  useEffect(() => {
    if (phase.kind !== "ready" || !workspaceMode || liveWorkspace === null) return;
    if (rootBoardId === null || layerReady === 0 || cameraApi === null) return;
    let handle = 0;
    let active = true;

    const tick = (now: number): void => {
      if (!active) return;
      handle = requestAnimationFrame(tick);

      // The chrome inverts this to turn a pointer into a document point, so it
      // has to track pans and flights, not just the commands that write a camera.
      const camera = cameraApi.cameraOf();
      if (camera !== null) publishScreenCamera(camera);

      const flight = flightRef.current;
      if (flight !== null) {
        const elapsed = now - flight.startedAt;
        cameraApi.write(sampleFlight(flight.plan, elapsed));
        if (flightDone(flight.plan, elapsed)) {
          cameraApi.write(flight.plan.to);
          flightRef.current = null;
        }
      }
    };

    handle = requestAnimationFrame(tick);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [phase, cameraApi, workspaceMode, liveWorkspace, rootBoardId, layerReady]);

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

      <div ref={overlaysRef} className="ice-surface__overlays" aria-hidden="true" />

      {workspaceMode && ready !== null ? (
        <div className="ice-surface__zoom">
          <CanvasZoomControls
            onZoomIn={(factor: number) => commandsRef.current?.zoomBy(factor)}
            onZoomOut={(factor: number) => commandsRef.current?.zoomBy(factor)}
            onFitView={() => commandsRef.current?.fitView()}
            onTypes={() => useUiStore.getState().openTypeSettings()}
          />
        </div>
      ) : null}

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
        />
      ) : null}

      {whiteboard !== null ? (
        <SuiteWhiteboardStage
          activeCardId={whiteboard.cardId}
          box={whiteboard.box}
          readOnly={!caps.canWriteLayout}
          suspended={suspendedStage}
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
        />
      ) : null}

      {phase.kind === "loading" ? (
        <IceSurfaceFallback
          title="Starting the ICE desk"
          message="Importing the engine and acquiring the GPU. This is a one-time cost; the default canvas never pays it."
        />
      ) : null}

      {phase.kind === "unavailable" ? (
        <IceSurfaceFallback
          title={
            phase.reason === "api" ? "This browser has no WebGPU" : "WebGPU has no graphics adapter"
          }
          message="ICE is an experimental WebGPU engine, so the desk cannot start here. Run `pnpm dev:ice` and open the printed URL in a headed Chrome started with `--enable-unsafe-webgpu` (`node scripts/ice-chrome.mjs` does both for you). The integrated browser and headless Chrome will not work."
          detail={
            phase.reason === "api"
              ? `${phase.detail} Try Chrome 113+, Edge 113+, or Safari 26+ with hardware acceleration on.`
              : `${phase.detail} Check that hardware acceleration is on and a supported GPU is present.`
          }
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
            ? "Select and drag a card · drag a handle to resize · double-click a mat to enter, a whiteboard to draw · Escape returns"
            : "Pan the mat · wheel to zoom · drag a note to move it"}
        </span>
      </div>
    </section>
  );
}

export default IceSurface;
