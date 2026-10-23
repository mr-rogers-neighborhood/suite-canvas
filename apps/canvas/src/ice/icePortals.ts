/**
 * Lane D: the pure portal / section / edge plan for the ICE surface.
 *
 * This module is the ICE-side twin of `@suite/scene`'s `buildScene`, cut down
 * to the three things the surface needs from the graph and nothing more:
 *
 * - **Board instances.** Every board reachable from the root through portal
 *   cards, with the instance key, the portal card that opened it, the world
 *   transform and the frame it was fitted into. One canonical board may appear
 *   in several instances; each instance is a separate row.
 * - **Section and edge descriptors.** Canonical geometry per instance, ready to
 *   become ICE custom kinds or overlays. They carry the page-space rect they
 *   must clip to (the instance frame) and a paint order.
 * - **Stubs.** A portal stopped by a cycle, the depth cap or a missing target
 *   still has a visible descriptor at its card frame, so the surface can paint
 *   a stub instead of silently dropping the door.
 *
 * ## What this module deliberately does *not* do
 *
 * Nothing here lays out, aligns, snaps, glides or reorders. ICE already owns
 * those affordances and the lead should keep them:
 *
 * - a portal instance's `frame` is the container box to spawn at; ICE's
 *   `frameContent()` fits the child's widgets, `enterContainer` /
 *   `exitContainer` / `exitTo` fly the camera, and `zoomToFit` is the explicit
 *   "show me everything" the plan's `frame` also feeds.
 * - `transform` exists for section/edge/overlay geometry only. It is the same
 *   fit math `@suite/scene` uses, not a second layout model.
 * - snap guides, equal-spacing bars and auto-alignment stay in ICE's `l3-snap`
 *   system and `arrange`; this plan never emits guides and never moves a card.
 * - `setLocked` and `reorder` remain ICE gestures on canonical ids; the plan
 *   only supplies those canonical ids (`sectionId`, `edgeId`, `portalCardId`).
 *
 * ## Identity
 *
 * Selection, presence and undo use the canonical id (`sectionId`, `edgeId`,
 * `portalCardId`, `boardId`). An instance key (`key`, `instanceKey`) is derived
 * from the portal chain and exists only for painting, clipping and hit-testing.
 * Two instances of the same board therefore share every canonical id and share
 * no instance key, which is what multi-placement means (ADR-0035 §6).
 *
 * The module is pure: it reads plain snapshot arrays, sorts copies, never
 * writes to the graph, never touches ICE, and returns a fresh plan for the
 * same input every time.
 */
import {
  type Board,
  type Card,
  type EdgeKind,
  type EdgePath,
  type GraphEdge,
  type Placement,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  placementKey,
  type Section,
} from "@suite/graph";
import {
  fitTransform,
  IDENTITY_TRANSFORM,
  type Point,
  type Rect,
  rectFromPoints,
  rectUnionAll,
  type Size,
  type Transform,
  transformPoint,
  transformRect,
} from "@suite/scene";

/** Hard recursion cap; the root board is depth 0 (ADR-0030 §5). */
export const ICE_PORTAL_MAX_DEPTH = 6;
/** Fit padding for a child board inside its portal frame. */
export const ICE_PORTAL_PADDING = 0.92;
/** Box assumed for a placement that was never resized. */
export const ICE_CARD_SIZE: Size = { width: 224, height: 160 };
/** Bounds assumed for a board with no cards or sections. */
export const ICE_EMPTY_BOARD_SIZE: Size = { width: 360, height: 240 };

const KEY_SEPARATOR = "\u001e";

/** Paint bands: sections, then edges, then portal stubs. */
const LAYER_RANK: Readonly<Record<IcePlanLayer, number>> = { section: 0, edge: 1, stub: 2 };

/* ------------------------------------------------------------------ shapes */

export interface IcePortalConfig {
  readonly maxDepth: number;
  readonly padding: number;
  readonly cardSize: Size;
  readonly emptyBoardSize: Size;
}

export const DEFAULT_ICE_PORTAL_CONFIG: IcePortalConfig = {
  maxDepth: ICE_PORTAL_MAX_DEPTH,
  padding: ICE_PORTAL_PADDING,
  cardSize: ICE_CARD_SIZE,
  emptyBoardSize: ICE_EMPTY_BOARD_SIZE,
};

export interface IcePortalPlanOptions {
  readonly maxDepth?: number | undefined;
  readonly padding?: number | undefined;
  readonly cardSize?: Size | undefined;
  readonly emptyBoardSize?: Size | undefined;
}

/**
 * The read interface the plan needs: plain snapshot arrays. A
 * `WorkspaceSnapshot` satisfies it structurally, and a document-backed caller
 * passes `listBoards()` / `listCards()` / `listPlacements()` / `listSections()`
 * / `listEdges()` straight in. Nothing is mutated.
 */
export interface IcePortalSource {
  readonly boards: readonly Board[];
  readonly cards: readonly Card[];
  readonly placements: readonly Placement[];
  readonly sections?: readonly Section[] | undefined;
  readonly edges?: readonly GraphEdge[] | undefined;
}

/** Why a portal stopped; mirrors the scene's gate reasons. */
export type IcePortalStopReason = "cycle" | "depth" | "missing";

export type IcePlanLayer = "section" | "edge" | "stub";

/** Fields every paintable descriptor shares, so one sort can order them. */
export interface IcePaintOrder {
  readonly key: string;
  readonly layer: IcePlanLayer;
  readonly z: number;
}

/**
 * One instance of one canonical board.
 *
 * `frame` is the box ICE should spawn the container at (the portal card's
 * page-space rect; the root is its own bounds). `rect` is the fitted content
 * extent inside it. `transform` maps this board's flow coordinates into page
 * space and is only needed for section/edge/overlay geometry.
 */
export interface IceBoardInstancePlan {
  /** Derived instance identity; never a selection id. */
  readonly key: string;
  readonly boardId: string;
  readonly boardName: string;
  /** Depth below the root; the root is 0. */
  readonly depth: number;
  /** Canonical board ids from the root down to, and including, this board. */
  readonly path: readonly string[];
  /** The same path without this board; empty for the root. */
  readonly parentPath: readonly string[];
  /** `key` of the parent instance; `null` for the root. */
  readonly parentKey: string | null;
  /** Canonical portal card that opened this instance; `null` for the root. */
  readonly portalCardId: string | null;
  /** Canonical placement record (`boardId/cardId`) that opened it; `null` at the root. */
  readonly placementId: string | null;
  readonly transform: Transform;
  /** Content bounds in board coordinates (cards and sections). */
  readonly bounds: Rect;
  /** Alias of `bounds`, kept so descriptors read uniformly. */
  readonly local: Rect;
  /** `bounds` mapped into page space after the fit. */
  readonly rect: Rect;
  /** Container box the instance was fitted into, in page space. */
  readonly frame: Rect;
}

export interface IceSectionPlan extends IcePaintOrder {
  /** Canonical id: the selection identity, shared by every instance. */
  readonly sectionId: string;
  readonly boardId: string;
  readonly instanceKey: string;
  readonly path: readonly string[];
  readonly depth: number;
  readonly transform: Transform;
  /** Board-space rectangle, exactly as the document stores it. */
  readonly local: Rect;
  /** `local` mapped into page space. */
  readonly rect: Rect;
  /** Page-space box this descriptor must clip to: its board instance's frame. */
  readonly clip: Rect;
  readonly layer: "section";
  readonly z: number;
  readonly title: string;
  readonly color: string | null;
}

export interface IceEdgePlan extends IcePaintOrder {
  /** Canonical id: the selection identity, shared by every instance. */
  readonly edgeId: string;
  readonly boardId: string;
  readonly instanceKey: string;
  readonly path: readonly string[];
  readonly depth: number;
  readonly transform: Transform;
  /** Board-space anchors, resolved through the card connectors. */
  readonly localFrom: Point;
  readonly localTo: Point;
  /** Page-space anchors; the ICE overlay draws between these. */
  readonly from: Point;
  readonly to: Point;
  /** Page-space bounds of the two anchors, at least one unit wide/tall. */
  readonly bounds: Rect;
  /** Page-space box this descriptor must clip to: its board instance's frame. */
  readonly clip: Rect;
  readonly kind: EdgeKind;
  readonly route: EdgePath;
  readonly bidirectional: boolean;
  readonly label: string | null;
  readonly labelOffset: number | null;
  readonly layer: "edge";
  readonly z: number;
}

/** A portal that must not open, drawn as a stub at its own card frame. */
export interface IcePortalStubPlan extends IcePaintOrder {
  readonly reason: IcePortalStopReason;
  /** Canonical board that contains the portal card. */
  readonly boardId: string;
  readonly instanceKey: string;
  readonly path: readonly string[];
  /** Depth the target board would have had. */
  readonly depth: number;
  readonly portalCardId: string;
  readonly placementId: string;
  /** Stored `board` value; empty when the portal was never pointed at a board. */
  readonly targetBoardId: string;
  readonly targetBoardName: string | null;
  readonly transform: Transform;
  /** Portal card rectangle in the containing board's coordinates. */
  readonly local: Rect;
  /** `local` mapped into page space: the stub's visible box. */
  readonly frame: Rect;
  /** Page-space box this descriptor must clip to: its board instance's frame. */
  readonly clip: Rect;
  readonly label: string;
  readonly layer: "stub";
  readonly z: number;
}

/** One canonical board rolled up across every instance it appears in. */
export interface IceBoardPlan {
  readonly boardId: string;
  readonly name: string;
  /** Instance keys in first-visit (pre-order) order. */
  readonly instanceKeys: readonly string[];
  readonly instanceCount: number;
}

/** A portal the walk refused to open, in traversal order. */
export interface IcePortalSkip {
  readonly reason: IcePortalStopReason;
  readonly boardId: string;
  readonly instanceKey: string;
  readonly portalCardId: string;
  readonly placementId: string;
  readonly targetBoardId: string;
  readonly depth: number;
  readonly detail: string;
}

export interface IcePortalPlanCounts {
  /** Distinct canonical boards reached, the root included. */
  readonly boards: number;
  readonly instances: number;
  readonly sections: number;
  readonly edges: number;
  readonly stubs: number;
  readonly cycles: number;
  readonly depthStops: number;
  readonly missing: number;
  readonly maxDepth: number;
}

/** The whole plan: descriptors only, no entities and no rendering. */
export interface IcePortalPlan {
  readonly rootBoardId: string;
  readonly maxDepth: number;
  readonly boards: readonly IceBoardPlan[];
  /** Pre-order: root first, then each opened board in portal order. */
  readonly instances: readonly IceBoardInstancePlan[];
  readonly sections: readonly IceSectionPlan[];
  readonly edges: readonly IceEdgePlan[];
  readonly stubs: readonly IcePortalStubPlan[];
  readonly skipped: readonly IcePortalSkip[];
  readonly counts: IcePortalPlanCounts;
}

/* -------------------------------------------------------------------- keys */

/** `b:root` at the root; `b:root ␞ p:card ␞ b:child` below it. */
export function iceInstanceKey(
  parentKey: string | null,
  boardId: string,
  portalCardId: string | null,
): string {
  const board = `b:${boardId}`;
  if (parentKey === null) return board;
  return `${parentKey}${KEY_SEPARATOR}p:${portalCardId ?? ""}${KEY_SEPARATOR}${board}`;
}

export function iceSectionKey(instanceKey: string, sectionId: string): string {
  return `${instanceKey}${KEY_SEPARATOR}s:${sectionId}`;
}

export function iceEdgeKey(instanceKey: string, edgeId: string): string {
  return `${instanceKey}${KEY_SEPARATOR}e:${edgeId}`;
}

export function iceStubKey(instanceKey: string, portalCardId: string): string {
  return `${instanceKey}${KEY_SEPARATOR}x:${portalCardId}`;
}

/** Layer first, then the descriptor's own z, then its key. */
export function compareIcePaint(a: IcePaintOrder, b: IcePaintOrder): number {
  return LAYER_RANK[a.layer] - LAYER_RANK[b.layer] || a.z - b.z || a.key.localeCompare(b.key);
}

/* ------------------------------------------------------------------- input */

export function resolveIcePortalConfig(options?: IcePortalPlanOptions): IcePortalConfig {
  if (!options) return DEFAULT_ICE_PORTAL_CONFIG;
  return {
    maxDepth: options.maxDepth ?? DEFAULT_ICE_PORTAL_CONFIG.maxDepth,
    padding: options.padding ?? DEFAULT_ICE_PORTAL_CONFIG.padding,
    cardSize: options.cardSize ?? DEFAULT_ICE_PORTAL_CONFIG.cardSize,
    emptyBoardSize: options.emptyBoardSize ?? DEFAULT_ICE_PORTAL_CONFIG.emptyBoardSize,
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(key(item));
    if (bucket) bucket.push(item);
    else grouped.set(key(item), [item]);
  }
  return grouped;
}

function placementRect(placement: Placement, config: IcePortalConfig): Rect {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width ?? config.cardSize.width,
    height: placement.height ?? config.cardSize.height,
  };
}

function nonEmptyRect(value: Rect): Rect {
  return {
    x: value.x,
    y: value.y,
    width: Math.max(1, value.width),
    height: Math.max(1, value.height),
  };
}

function comparePlacements(a: Placement, b: Placement): number {
  return a.z - b.z || a.cardId.localeCompare(b.cardId);
}

function compareSections(a: Section, b: Section): number {
  return a.z - b.z || a.id.localeCompare(b.id);
}

function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return a.id.localeCompare(b.id);
}

/** Card ids already on the path are cycles, never a second expansion. */
function portalTargetId(card: Card): string | null {
  if (!card.typeIds.includes(PORTAL_TYPE_ID)) return null;
  const value = card.properties[PORTAL_BOARD_FIELD_ID];
  return typeof value === "string" ? value.trim() : "";
}

/** A connector anchor, or the card centre when the link has none. */
function edgeAnchor(card: Card | undefined, box: Rect, connectorId: string | undefined): Point {
  const connector =
    connectorId === undefined
      ? undefined
      : card?.connectors.find((candidate) => candidate.id === connectorId);
  if (!connector) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return { x: box.x + connector.x * box.width, y: box.y + connector.y * box.height };
}

interface VisitInput {
  readonly boardId: string;
  readonly path: readonly string[];
  readonly parentPath: readonly string[];
  readonly parentKey: string | null;
  readonly portalCardId: string | null;
  readonly placementId: string | null;
  readonly depth: number;
  readonly transform: Transform;
  /** Page-space container box this instance was fitted into. */
  readonly frame: Rect;
}

/* ------------------------------------------------------------------- build */

/**
 * Projects a workspace snapshot into the ICE plan. Pure and deterministic:
 * the same snapshot and options yield the same plan, and no input array is
 * reordered in place.
 */
export function planIcePortals(
  source: IcePortalSource,
  rootBoardId: string,
  options?: IcePortalPlanOptions,
): IcePortalPlan {
  const config = resolveIcePortalConfig(options);

  const boardsById = new Map(source.boards.map((board) => [board.id, board] as const));
  const cardsById = new Map(source.cards.map((card) => [card.id, card] as const));
  const placementsByBoard = groupBy(source.placements, (placement) => placement.boardId);
  const sectionsByBoard = groupBy(source.sections ?? [], (section) => section.boardId);
  const edgesByBoard = groupBy(source.edges ?? [], (edge) => edge.boardId);

  const instances: IceBoardInstancePlan[] = [];
  const sections: IceSectionPlan[] = [];
  const edges: IceEdgePlan[] = [];
  const stubs: IcePortalStubPlan[] = [];
  const skipped: IcePortalSkip[] = [];
  const instanceKeysByBoard = new Map<string, string[]>();

  const boundsCache = new Map<string, Rect>();
  const boardBounds = (boardId: string): Rect => {
    const cached = boundsCache.get(boardId);
    if (cached) return cached;
    const rects: Rect[] = [];
    for (const placement of placementsByBoard.get(boardId) ?? []) {
      rects.push(placementRect(placement, config));
    }
    for (const section of sectionsByBoard.get(boardId) ?? []) {
      rects.push({ x: section.x, y: section.y, width: section.width, height: section.height });
    }
    const union = rectUnionAll(rects) ?? {
      x: 0,
      y: 0,
      width: config.emptyBoardSize.width,
      height: config.emptyBoardSize.height,
    };
    boundsCache.set(boardId, union);
    return union;
  };

  const visit = (input: VisitInput): void => {
    const { boardId, path, parentPath, parentKey, portalCardId, placementId, depth } = input;
    const key = iceInstanceKey(parentKey, boardId, portalCardId);
    const bounds = boardBounds(boardId);
    const rect = transformRect(input.transform, bounds);
    const clip = input.frame;

    instances.push({
      key,
      boardId,
      boardName: boardsById.get(boardId)?.name ?? boardId,
      depth,
      path,
      parentPath,
      parentKey,
      portalCardId,
      placementId,
      transform: input.transform,
      bounds,
      local: bounds,
      rect,
      frame: clip,
    });
    const seen = instanceKeysByBoard.get(boardId);
    if (seen) seen.push(key);
    else instanceKeysByBoard.set(boardId, [key]);

    for (const section of [...(sectionsByBoard.get(boardId) ?? [])].sort(compareSections)) {
      const local: Rect = {
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
      };
      sections.push({
        key: iceSectionKey(key, section.id),
        sectionId: section.id,
        boardId,
        instanceKey: key,
        path,
        depth,
        transform: input.transform,
        local,
        rect: transformRect(input.transform, local),
        clip,
        layer: "section",
        z: section.z,
        title: section.title,
        color: section.color ?? null,
      });
    }

    const boardPlacements = [...(placementsByBoard.get(boardId) ?? [])].sort(comparePlacements);
    const placementByCard = new Map<string, Placement>();
    for (const placement of boardPlacements) placementByCard.set(placement.cardId, placement);

    for (const [index, edge] of [...(edgesByBoard.get(boardId) ?? [])]
      .sort(compareEdges)
      .entries()) {
      const sourcePlacement = placementByCard.get(edge.source);
      const targetPlacement = placementByCard.get(edge.target);
      if (!sourcePlacement || !targetPlacement) continue;
      const localFrom = edgeAnchor(
        cardsById.get(edge.source),
        placementRect(sourcePlacement, config),
        edge.sourceConnector,
      );
      const localTo = edgeAnchor(
        cardsById.get(edge.target),
        placementRect(targetPlacement, config),
        edge.targetConnector,
      );
      const from = transformPoint(input.transform, localFrom);
      const to = transformPoint(input.transform, localTo);
      edges.push({
        key: iceEdgeKey(key, edge.id),
        edgeId: edge.id,
        boardId,
        instanceKey: key,
        path,
        depth,
        transform: input.transform,
        localFrom,
        localTo,
        from,
        to,
        bounds: nonEmptyRect(rectFromPoints(from, to)),
        clip,
        kind: edge.kind,
        route: edge.path,
        bidirectional: edge.bidirectional,
        label: edge.label ?? null,
        labelOffset: edge.labelOffset ?? null,
        layer: "edge",
        z: index,
      });
    }

    for (const placement of boardPlacements) {
      const card = cardsById.get(placement.cardId);
      if (card === undefined) continue;
      const target = portalTargetId(card);
      if (target === null) continue;

      const local = placementRect(placement, config);
      const portalFrame = transformRect(input.transform, local);
      const cardPlacementId = placementKey(placement.boardId, placement.cardId);
      const childDepth = depth + 1;
      const targetBoard = target === "" ? undefined : boardsById.get(target);
      const targetMissing = targetBoard === undefined;
      const cycle = !targetMissing && path.includes(target);
      const depthCapped = !targetMissing && !cycle && childDepth > config.maxDepth;

      if (targetMissing || cycle || depthCapped) {
        const reason: IcePortalStopReason = targetMissing ? "missing" : cycle ? "cycle" : "depth";
        const label = targetBoard?.name ?? "Unavailable board";
        stubs.push({
          key: iceStubKey(key, card.id),
          reason,
          boardId,
          instanceKey: key,
          path,
          depth: childDepth,
          portalCardId: card.id,
          placementId: cardPlacementId,
          targetBoardId: target,
          targetBoardName: targetBoard?.name ?? null,
          transform: input.transform,
          local,
          frame: portalFrame,
          clip,
          label,
          layer: "stub",
          z: placement.z,
        });
        skipped.push({
          reason,
          boardId,
          instanceKey: key,
          portalCardId: card.id,
          placementId: cardPlacementId,
          targetBoardId: target,
          depth: childDepth,
          detail: skipDetail(reason, target, path, childDepth, config.maxDepth),
        });
        continue;
      }

      visit({
        boardId: target,
        path: [...path, target],
        parentPath: path,
        parentKey: key,
        portalCardId: card.id,
        placementId: cardPlacementId,
        depth: childDepth,
        transform: fitTransform(boardBounds(target), portalFrame, config.padding),
        frame: portalFrame,
      });
    }
  };

  // A missing root still produces a root instance; the plan never throws for
  // data it can describe, and the surface shows an empty board.
  const rootBounds = boardBounds(rootBoardId);
  const rootFrame: Rect = { ...rootBounds };
  visit({
    boardId: rootBoardId,
    path: [rootBoardId],
    parentPath: [],
    parentKey: null,
    portalCardId: null,
    placementId: null,
    depth: 0,
    transform: IDENTITY_TRANSFORM,
    frame: rootFrame,
  });

  const boards: IceBoardPlan[] = [...instanceKeysByBoard].map(([boardId, keys]) => ({
    boardId,
    name: boardsById.get(boardId)?.name ?? boardId,
    instanceKeys: keys,
    instanceCount: keys.length,
  }));

  const counts: IcePortalPlanCounts = {
    boards: boards.length,
    instances: instances.length,
    sections: sections.length,
    edges: edges.length,
    stubs: stubs.length,
    cycles: skipped.filter((entry) => entry.reason === "cycle").length,
    depthStops: skipped.filter((entry) => entry.reason === "depth").length,
    missing: skipped.filter((entry) => entry.reason === "missing").length,
    maxDepth: instances.reduce((deepest, instance) => Math.max(deepest, instance.depth), 0),
  };

  return {
    rootBoardId,
    maxDepth: config.maxDepth,
    boards,
    instances,
    sections,
    edges,
    stubs,
    skipped,
    counts,
  };
}

function skipDetail(
  reason: IcePortalStopReason,
  target: string,
  path: readonly string[],
  childDepth: number,
  maxDepth: number,
): string {
  if (reason === "cycle") {
    return `Portal reopens "${target}", already on the path (${path.join(" → ")}).`;
  }
  if (reason === "depth") {
    return `Portal would open board depth ${childDepth}; the plan stops at ${maxDepth}.`;
  }
  return target === ""
    ? "Portal has no target board."
    : `Portal opens "${target}", which is not in the snapshot.`;
}
