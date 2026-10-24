/**
 * The surface's seeds and spawns.
 *
 * Everything here runs once, against a throwaway ICE document: the native and
 * Suite demos build their own objects, the live workspace is projected
 * read-only, and pins and links are markers over the graph. Nothing here writes
 * the workspace, and nothing here is React — the surface's hooks own the
 * lifecycle and call these to put something on the desk.
 */

import {
  boardSideAnchor,
  boardWorldRect,
  edgeFrameOf,
  type GraphEdge,
  type WorkspaceDocument,
} from "@suite/graph";
import type { CanvasEngine, Entity, SpawnWidgetOpts } from "@vibecook/ice";
import type { IceDebugEdge } from "./iceDebug";
import { anchorWorld } from "./iceEdgeGeometry";
import type { IceEditableSlot } from "./iceEditingController";
import { boardFrames, describeError } from "./iceSurfaceShared";
import { type SuiteEdgeEnd, type SuiteEdgeLink, suiteEdgeSpawn } from "./suiteEdgeKind";
import { buildSuiteSeed, projectWorkspaceToIce, spawnIceSuite } from "./suiteProjection";

/**
 * The pin kind's type name. Duplicated by design: importing `suitePinKind`
 * here would pull the ICE runtime into this module's static graph, and the
 * kind itself is loaded in the dynamic block beside the card kind.
 */
export const SUITE_PIN_KIND = "suite.pin";
export const NOTE_TYPE = "desk.note";
export const MINIMAT_TYPE = "desk.minimat";
export const BOARD_TYPE = "desk.board";
export const NOTEBOOK_TYPE = "desk.notebook";
export const DEMO_SEED_COUNT = 10;
/** Which demo the desk seeds. Selected by `?demo=suite`; Native is the default. */
export type DemoMode = "native" | "suite";
/** A workspace projection is not a demo; the mode names where the seed came from. */
export type SeedMode = DemoMode | "workspace";
export const DEMO_PARAM = "demo";

/**
 * Reads the demo choice from a query string. The ICE route keeps its other
 * parameters (`canvas`, workspace id), so the toggle never rewrites the URL.
 */
export function demoModeFromSearch(search: string): DemoMode {
  return new URLSearchParams(search).get(DEMO_PARAM) === "suite" ? "suite" : "native";
}

export function demoLabel(mode: DemoMode): string {
  return mode === "suite" ? "Suite demo" : "Native demo";
}

export interface SeedReport {
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
export interface BoardMat {
  readonly boardId: string;
  readonly parentBoardId: string;
  readonly title: string;
}

/** One omitted entity, kept as a reason plus a human-readable detail. */
export interface SeedSkip {
  readonly reason: string;
  readonly detail: string;
}

/**
 * Seeds the demo desk. Each spawn is independent so one refusing kind still
 * leaves the rest usable, and every failure is reported to the HUD. Child
 * coordinates are frame-local: a note placed with `parent` sits inside that
 * mini mat and moves with it.
 */
export function seedDemoDocument(engine: CanvasEngine): SeedReport {
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
export function seedSuiteDocument(engine: CanvasEngine): SeedReport {
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
export function seedWorkspaceDocument(
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
 * The spawned links and the table that keeps them live.
 *
 * A link is a drawing between two *places*, so each end is described as a
 * placement plus its chain of Board rects (`anchorWorld` folds them into world
 * space). The kind re-routes from that table whenever an endpoint moves, so a
 * drag moves its links with no document write per frame.
 */
export interface EdgeSpawns {
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
export function rectCentre(rect: { x: number; y: number; width: number; height: number }) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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

/**
 * Spawns one marker per pin on the root board. A pin is navigation metadata,
 * not content: the marker is presentational and the document keeps the record.
 */
export function spawnPins(
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
