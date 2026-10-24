import {
  effectiveScale,
  fitTransform,
  IDENTITY_TRANSFORM,
  rectFromPoints,
  rectUnionAll,
  transformPoint,
  transformRect,
} from "./geometry.js";
import { DEFAULT_LOD_CONFIG, resolveLod } from "./lod.js";
import type {
  BoardInstance,
  BuildSceneInput,
  Camera,
  CardInstance,
  EdgeInstance,
  Point,
  PortalConfig,
  PortalGateReason,
  PortalGateState,
  PortalInstance,
  Rect,
  Scene,
  SceneCardInput,
  SceneConfig,
  SceneCounts,
  SceneEdgeInput,
  ScenePath,
  ScenePlacementInput,
  SceneSectionInput,
  SectionInstance,
  Transform,
} from "./types.js";

export const DEFAULT_PORTAL_CONFIG: PortalConfig = {
  expansionScale: 0.5,
  collapseScale: 0.35,
  minScreenSize: 96,
  dwellMs: 80,
  padding: 0.92,
  maxDepth: 6,
};

export const DEFAULT_SCENE_CONFIG: SceneConfig = {
  lod: DEFAULT_LOD_CONFIG,
  portal: DEFAULT_PORTAL_CONFIG,
  cardSize: { width: 224, height: 160 },
  emptyBoardSize: { width: 360, height: 240 },
};

export function resolveSceneConfig(partial: Partial<SceneConfig> | undefined): SceneConfig {
  if (!partial) return DEFAULT_SCENE_CONFIG;
  return {
    lod: partial.lod ?? DEFAULT_SCENE_CONFIG.lod,
    portal: partial.portal ?? DEFAULT_SCENE_CONFIG.portal,
    cardSize: partial.cardSize ?? DEFAULT_SCENE_CONFIG.cardSize,
    emptyBoardSize: partial.emptyBoardSize ?? DEFAULT_SCENE_CONFIG.emptyBoardSize,
  };
}

/* ----------------------------------------------------------- instance keys */

const PATH_SEPARATOR = "\u001f";
const KEY_SEPARATOR = "\u001e";

export function pathKey(path: ScenePath): string {
  return path.join(PATH_SEPARATOR);
}

export function boardInstanceKey(path: ScenePath): string {
  return `b:${pathKey(path)}`;
}

export function cardInstanceKey(path: ScenePath, cardId: string): string {
  return `${boardInstanceKey(path)}${KEY_SEPARATOR}c:${cardId}`;
}

export function sectionInstanceKey(path: ScenePath, sectionId: string): string {
  return `${boardInstanceKey(path)}${KEY_SEPARATOR}s:${sectionId}`;
}

export function edgeInstanceKey(path: ScenePath, edgeId: string): string {
  return `${boardInstanceKey(path)}${KEY_SEPARATOR}e:${edgeId}`;
}

export function portalInstanceKey(path: ScenePath, cardId: string): string {
  return `${boardInstanceKey(path)}${KEY_SEPARATOR}p:${cardId}`;
}

/* ------------------------------------------------------------- portal gate */

export interface PortalGateInput {
  readonly previous?: PortalGateState | undefined;
  /** Effective scale of the portal's own board (camera zoom × ancestor scales). */
  readonly effectiveScale: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** Depth the child board would have. */
  readonly depth: number;
  readonly nowMs: number;
  readonly config: PortalConfig;
  readonly targetExists: boolean;
  readonly cycle: boolean;
  readonly focused?: boolean | undefined;
}

export interface PortalGateDecision {
  readonly expanded: boolean;
  readonly reason: PortalGateReason;
  readonly state: PortalGateState;
}

const COLLAPSED_GATE: PortalGateState = { expanded: false, pendingSinceMs: null };

/**
 * Collapse immediately below the lower band; expand only above the higher band
 * and after a dwell so a portal does not flash its live board while panning.
 */
export function resolvePortalGate(input: PortalGateInput): PortalGateDecision {
  const { config } = input;
  if (!input.targetExists) return { expanded: false, reason: "no-target", state: COLLAPSED_GATE };
  if (input.cycle) return { expanded: false, reason: "cycle", state: COLLAPSED_GATE };
  if (input.depth > config.maxDepth) {
    return { expanded: false, reason: "depth", state: COLLAPSED_GATE };
  }
  if (input.focused) {
    return { expanded: true, reason: "focus", state: { expanded: true, pendingSinceMs: null } };
  }
  const screenSize = Math.min(input.screenWidth, input.screenHeight);
  if (input.effectiveScale < config.collapseScale) {
    return { expanded: false, reason: "scale", state: COLLAPSED_GATE };
  }
  if (screenSize < config.minScreenSize) {
    return { expanded: false, reason: "screen-size", state: COLLAPSED_GATE };
  }
  if (input.previous?.expanded)
    return { expanded: true, reason: "expanded", state: input.previous };
  const eligible =
    input.effectiveScale >= config.expansionScale && screenSize >= config.minScreenSize;
  if (!eligible) {
    return {
      expanded: false,
      reason: input.effectiveScale < config.expansionScale ? "scale" : "screen-size",
      state: COLLAPSED_GATE,
    };
  }
  if (config.dwellMs <= 0) {
    return { expanded: true, reason: "expanded", state: { expanded: true, pendingSinceMs: null } };
  }
  const pendingSinceMs = input.previous?.pendingSinceMs ?? input.nowMs;
  if (input.nowMs - pendingSinceMs >= config.dwellMs) {
    return { expanded: true, reason: "expanded", state: { expanded: true, pendingSinceMs: null } };
  }
  return { expanded: false, reason: "dwell", state: { expanded: false, pendingSinceMs } };
}

/* ------------------------------------------------------------------- build */

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const bucket = grouped.get(key(item));
    if (bucket) bucket.push(item);
    else grouped.set(key(item), [item]);
  }
  return grouped;
}

function placementRect(placement: ScenePlacementInput, config: SceneConfig): Rect {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width ?? config.cardSize.width,
    height: placement.height ?? config.cardSize.height,
  };
}

/**
 * The portal card's legacy vocabulary.
 *
 * `@suite/graph` retired the portal type (ADR-0039: a portal is a Board nested
 * inside a Board), so a current document cannot produce one. The scene
 * projection still knows how to draw a card that opens another board, so the
 * two ids live here; only data written before the change reaches this path.
 */
export const SCENE_PORTAL_TYPE_ID = "portal";
export const SCENE_PORTAL_BOARD_FIELD_ID = "portal-board";

/** Empty string means "portal card, but no target"; null means "not a portal". */
function portalTargetId(card: SceneCardInput): string | null {
  if (card.primaryTypeId !== SCENE_PORTAL_TYPE_ID) return null;
  const value = card.properties[SCENE_PORTAL_BOARD_FIELD_ID];
  return typeof value === "string" ? value.trim() : "";
}

function edgeEndpoint(
  placement: ScenePlacementInput,
  card: SceneCardInput | undefined,
  connectorId: string | undefined,
  transform: Transform,
  config: SceneConfig,
): Point {
  const local = placementRect(placement, config);
  const connector = connectorId
    ? card?.connectors?.find((candidate) => candidate.id === connectorId)
    : undefined;
  const boardPoint = connector
    ? { x: local.x + connector.x * local.width, y: local.y + connector.y * local.height }
    : { x: local.x + local.width / 2, y: local.y + local.height / 2 };
  return transformPoint(transform, boardPoint);
}

function nonEmptyRect(value: Rect): Rect {
  return {
    x: value.x,
    y: value.y,
    width: Math.max(1, value.width),
    height: Math.max(1, value.height),
  };
}

function comparePlacements(a: ScenePlacementInput, b: ScenePlacementInput): number {
  return a.z - b.z || a.cardId.localeCompare(b.cardId);
}

function compareSections(a: SceneSectionInput, b: SceneSectionInput): number {
  return a.z - b.z || a.id.localeCompare(b.id);
}

function compareEdges(a: SceneEdgeInput, b: SceneEdgeInput): number {
  return a.id.localeCompare(b.id);
}

/**
 * Project a graph snapshot into board/card/section/edge/portal instances.
 * Inputs are read-only and never sorted in place; every collection returned is
 * deterministic for the same input, camera and `nowMs`.
 */
export function buildScene(input: BuildSceneInput): Scene {
  const config = resolveSceneConfig(input.config);
  const camera: Camera = input.camera;
  const nowMs = input.nowMs ?? 0;
  const titles = input.titles ?? {};
  const lodStates = input.lodStates ?? {};
  const gateStates = input.gateStates ?? {};
  const focusPath: ScenePath = [...(input.focusPath ?? [])];

  const boardsById = new Map(input.boards.map((board) => [board.id, board] as const));
  const cardsById = new Map(input.cards.map((card) => [card.id, card] as const));
  const placementsByBoard = groupBy(input.placements, (placement) => placement.boardId);
  const sectionsByBoard = groupBy(input.sections ?? [], (section) => section.boardId);
  const edgesByBoard = groupBy(input.edges ?? [], (edge) => edge.boardId);

  const boards: BoardInstance[] = [];
  const cards: CardInstance[] = [];
  const sections: SectionInstance[] = [];
  const edges: EdgeInstance[] = [];
  const portals: PortalInstance[] = [];

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

  const instantiateBoard = (
    boardId: string,
    path: ScenePath,
    transform: Transform,
    depth: number,
    parentKey: string | null,
  ): BoardInstance => {
    const boardKey = boardInstanceKey(path);
    const contentBounds = boardBounds(boardId);
    const frame = transformRect(transform, contentBounds);
    const boardScale = effectiveScale(camera, transform);
    const board: BoardInstance = {
      key: boardKey,
      boardId,
      name: boardsById.get(boardId)?.name ?? boardId,
      path,
      depth,
      parentKey,
      transform,
      bounds: contentBounds,
      frame,
      lod: resolveLod(lodStates[boardKey], boardScale, nowMs, config.lod, "card").band,
    };
    boards.push(board);

    for (const section of [...(sectionsByBoard.get(boardId) ?? [])].sort(compareSections)) {
      const key = sectionInstanceKey(path, section.id);
      const local: Rect = {
        x: section.x,
        y: section.y,
        width: section.width,
        height: section.height,
      };
      sections.push({
        key,
        sectionId: section.id,
        boardId,
        boardKey,
        path,
        transform,
        local,
        rect: transformRect(transform, local),
        z: section.z,
        lod: resolveLod(lodStates[key], boardScale, nowMs, config.lod, "section").band,
        title: section.title,
        color: section.color ?? null,
      });
    }

    const boardPlacements = [...(placementsByBoard.get(boardId) ?? [])].sort(comparePlacements);
    const placementByCard = new Map<string, ScenePlacementInput>();
    for (const placement of boardPlacements) placementByCard.set(placement.cardId, placement);

    const pendingPortals: {
      placement: ScenePlacementInput;
      target: string;
      instance: CardInstance;
      lod: CardInstance["lod"];
    }[] = [];

    for (const placement of boardPlacements) {
      const card = cardsById.get(placement.cardId);
      const target = card ? portalTargetId(card) : null;
      const key = cardInstanceKey(path, placement.cardId);
      const local = placementRect(placement, config);
      const lod = resolveLod(
        lodStates[key],
        boardScale,
        nowMs,
        config.lod,
        target === null ? "card" : "portal",
      ).band;
      const instance: CardInstance = {
        key,
        cardId: placement.cardId,
        boardId,
        boardKey,
        path,
        transform,
        local,
        rect: transformRect(transform, local),
        z: placement.z,
        lod,
        portalKey: target === null ? null : portalInstanceKey(path, placement.cardId),
        title: titles[placement.cardId] ?? null,
      };
      cards.push(instance);
      if (target !== null) {
        pendingPortals.push({ placement, target, instance, lod });
      }
    }

    for (const pending of pendingPortals) {
      const { placement, target, instance, lod } = pending;
      const portalKey = portalInstanceKey(path, placement.cardId);
      const targetBoard = target === "" ? undefined : boardsById.get(target);
      const targetMissing = target === "" || targetBoard === undefined;
      const cycle = target !== "" && path.includes(target);
      const childDepth = depth + 1;
      const depthCapped = childDepth > config.portal.maxDepth;
      const fit = targetMissing
        ? { scale: 1, x: instance.rect.x, y: instance.rect.y }
        : fitTransform(boardBounds(target), instance.rect, config.portal.padding);
      const gate = resolvePortalGate({
        previous: gateStates[portalKey],
        effectiveScale: boardScale,
        screenWidth: instance.rect.width * camera.zoom,
        screenHeight: instance.rect.height * camera.zoom,
        depth: childDepth,
        nowMs,
        config: config.portal,
        targetExists: !targetMissing,
        cycle,
        focused: target !== "" && focusPath.includes(target),
      });
      const portalIndex = portals.length;
      let child: BoardInstance | null = null;
      if (gate.expanded && target !== "") {
        child = instantiateBoard(target, [...path, target], fit, childDepth, portalKey);
      }
      const portal: PortalInstance = {
        key: portalKey,
        cardId: placement.cardId,
        boardId,
        path,
        depth: childDepth,
        transform,
        localFrame: instance.local,
        frame: instance.rect,
        targetBoardId: target,
        targetBoardName: targetBoard?.name ?? null,
        targetMissing,
        cycle,
        depthCapped,
        expanded: child !== null,
        impostor: child === null,
        reason: gate.reason,
        gate: gate.state,
        fit,
        childKey: child?.key ?? null,
        lod,
        title: instance.title,
      };
      portals.splice(portalIndex, 0, portal);
    }

    for (const edge of [...(edgesByBoard.get(boardId) ?? [])].sort(compareEdges)) {
      const sourcePlacement = placementByCard.get(edge.source);
      const targetPlacement = placementByCard.get(edge.target);
      if (!sourcePlacement || !targetPlacement) continue;
      const from = edgeEndpoint(
        sourcePlacement,
        cardsById.get(edge.source),
        edge.sourceConnector,
        transform,
        config,
      );
      const to = edgeEndpoint(
        targetPlacement,
        cardsById.get(edge.target),
        edge.targetConnector,
        transform,
        config,
      );
      const key = edgeInstanceKey(path, edge.id);
      edges.push({
        key,
        edgeId: edge.id,
        boardId,
        boardKey,
        path,
        transform,
        from,
        to,
        bounds: nonEmptyRect(rectFromPoints(from, to)),
        kind: edge.kind,
        route: edge.path,
        label: edge.label ?? null,
        lod: resolveLod(lodStates[key], boardScale, nowMs, config.lod, "edge").band,
      });
    }

    return board;
  };

  const root = instantiateBoard(
    input.rootBoardId,
    [input.rootBoardId],
    IDENTITY_TRANSFORM,
    0,
    null,
  );

  const counts: SceneCounts = {
    boards: boards.length,
    cards: cards.length,
    sections: sections.length,
    edges: edges.length,
    portals: portals.length,
    expandedPortals: portals.filter((portal) => portal.expanded).length,
    impostors: portals.filter((portal) => !portal.expanded).length,
    maxDepth: boards.reduce((deepest, board) => Math.max(deepest, board.depth), 0),
  };

  return {
    rootBoardId: input.rootBoardId,
    camera,
    focusPath,
    root,
    boards,
    cards,
    sections,
    edges,
    portals,
    counts,
  };
}
