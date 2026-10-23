import {
  type Board,
  type Card,
  type GraphEdge,
  type LayoutPlan,
  type LayoutPlanPlacement,
  type LayoutPlanSize,
  type LayoutPlanSummary,
  type Placement,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  type Section,
  type WorkspaceDocument,
} from "@suite/graph";
import {
  type BuildSceneInput,
  type Camera,
  DEFAULT_FRACTAL_RECIPE,
  DEFAULT_SCENE_CONFIG,
  type FractalRecipe,
  type LayoutItem,
  type Point,
  planFractalLayout,
  type SceneCardInput,
  type LayoutPlan as SceneLayoutPlan,
} from "@suite/scene";

/**
 * The one-shot fractal layout command. Planning is pure: it reads a snapshot and
 * returns a graph `LayoutPlan` for preview. Only `applyBoardFractal` writes, and
 * it writes the whole plan as one undoable batch. There is no live reflow mode.
 */

/** Snapshot-like input; a canvas `WorkspaceSnapshot` satisfies it. */
export interface LayoutSnapshot {
  readonly boards: readonly Board[];
  readonly cards: readonly Card[];
  readonly placements: readonly Placement[];
  readonly sections?: readonly Section[] | undefined;
  readonly edges?: readonly GraphEdge[] | undefined;
}

export interface PlanBoardFractalInput {
  readonly snapshot: LayoutSnapshot;
  readonly rootBoardId: string;
  readonly recipe?: FractalRecipe | undefined;
  /** Cards to arrange; omitted or empty arranges every card on the board. */
  readonly selection?: readonly string[] | undefined;
  /** Cards that keep their stored coordinates. */
  readonly pinned?: readonly string[] | undefined;
  /** Hard recursion cap through portals; the root board is depth 0. */
  readonly maxDepth?: number | undefined;
  /** False keeps the layout to the root board and never sizes portal frames. */
  readonly recursive?: boolean | undefined;
  /** Page-space offset for the arranged root level. */
  readonly origin?: Point | undefined;
  readonly camera?: Camera | undefined;
}

const IDENTITY_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Maps the workspace snapshot onto the scene projection input. */
export function buildLayoutSceneInput(input: PlanBoardFractalInput): BuildSceneInput {
  const { snapshot } = input;
  return {
    boards: snapshot.boards.map((board) => ({ id: board.id, name: board.name })),
    cards: snapshot.cards.map((card) => ({
      id: card.id,
      primaryTypeId: card.primaryTypeId,
      properties: card.properties,
      connectors: card.connectors,
    })),
    placements: snapshot.placements.map((placement) => ({
      boardId: placement.boardId,
      cardId: placement.cardId,
      x: placement.x,
      y: placement.y,
      z: placement.z,
      width: placement.width,
      height: placement.height,
    })),
    sections: snapshot.sections?.map((section) => ({
      id: section.id,
      boardId: section.boardId,
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      z: section.z,
      color: section.color,
    })),
    edges: snapshot.edges?.map((edge) => ({
      id: edge.id,
      boardId: edge.boardId,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      path: edge.path,
      sourceConnector: edge.sourceConnector,
      targetConnector: edge.targetConnector,
      label: edge.label,
    })),
    rootBoardId: input.rootBoardId,
    camera: input.camera ?? IDENTITY_CAMERA,
  };
}

/** Empty string means "portal with no target"; treat it as a plain card here. */
function portalTarget(card: SceneCardInput): string | undefined {
  if (card.primaryTypeId !== PORTAL_TYPE_ID) return undefined;
  const value = card.properties[PORTAL_BOARD_FIELD_ID];
  if (typeof value !== "string") return undefined;
  const target = value.trim();
  return target.length > 0 ? target : undefined;
}

function layoutItems(
  scene: BuildSceneInput,
  selection: readonly string[] | undefined,
  pinned: readonly string[] | undefined,
  createdAt: ReadonlyMap<string, number>,
): Record<string, LayoutItem[]> {
  const boards: Record<string, LayoutItem[]> = {};
  for (const board of scene.boards) boards[board.id] = [];

  const cardsById = new Map(scene.cards.map((card) => [card.id, card]));
  const pinnedIds = new Set(pinned ?? []);
  const selectedIds = new Set(selection ?? []);
  const selectedOnly = selectedIds.size > 0;

  for (const placement of scene.placements) {
    const bucket = boards[placement.boardId];
    if (!bucket) continue;
    const card = cardsById.get(placement.cardId);
    if (!card) continue;
    const isPinned = pinnedIds.has(card.id);
    const target = portalTarget(card);
    const created = createdAt.get(`${placement.boardId}\u001f${placement.cardId}`);
    const item: LayoutItem = {
      id: card.id,
      width: placement.width ?? DEFAULT_SCENE_CONFIG.cardSize.width,
      height: placement.height ?? DEFAULT_SCENE_CONFIG.cardSize.height,
      z: placement.z,
      x: placement.x,
      y: placement.y,
      typeId: card.primaryTypeId,
    };
    bucket.push({
      ...item,
      ...(created !== undefined ? { createdAt: created } : {}),
      ...(isPinned ? { pinned: true } : {}),
      ...(!isPinned && selectedOnly && !selectedIds.has(card.id) ? { excluded: true } : {}),
      ...(target !== undefined ? { portalBoardId: target } : {}),
    });
  }
  return boards;
}

/** The raw scene plan, including issues and portal fits, for a preview surface. */
export function planFractalScene(input: PlanBoardFractalInput): SceneLayoutPlan {
  const scene = buildLayoutSceneInput(input);
  const createdAt = new Map<string, number>();
  for (const placement of input.snapshot.placements) {
    createdAt.set(`${placement.boardId}\u001f${placement.cardId}`, placement.createdAt);
  }
  const maxDepth = input.maxDepth ?? (input.recursive === false ? 0 : undefined);
  return planFractalLayout({
    rootBoardId: input.rootBoardId,
    boards: layoutItems(scene, input.selection, input.pinned, createdAt),
    recipe: input.recipe ?? DEFAULT_FRACTAL_RECIPE,
    ...(maxDepth !== undefined ? { maxDepth } : {}),
    ...(input.origin !== undefined ? { origin: input.origin } : {}),
  });
}

/**
 * Maps a scene plan to the graph layout plan. Recursive portal frames carry the
 * size the frame must take to fit the child board; plain placements are moves
 * only, so a card's own size is never rewritten by a layout.
 */
export function layoutPlanFromScene(plan: SceneLayoutPlan): LayoutPlan {
  const placements: LayoutPlanPlacement[] = [];
  const portalSizes: Record<string, LayoutPlanSize> = {};
  const boards: string[] = [];

  const visit = (board: SceneLayoutPlan): void => {
    if (!boards.includes(board.boardId)) boards.push(board.boardId);
    for (const portal of board.portals) {
      portalSizes[portal.cardId] = { width: portal.frame.width, height: portal.frame.height };
      if (portal.child) visit(portal.child);
    }
    for (const placement of board.placements) {
      const isPortal = board.portals.some((portal) => portal.cardId === placement.id);
      placements.push({
        boardId: board.boardId,
        cardId: placement.id,
        x: placement.x,
        y: placement.y,
        ...(isPortal ? { width: placement.width, height: placement.height } : {}),
      });
    }
  };

  visit(plan);
  return { boards, placements, portalSizes };
}

/** Plans only; safe to call on every keystroke, never writes. */
export function planBoardFractal(input: PlanBoardFractalInput): LayoutPlan {
  return layoutPlanFromScene(planFractalScene(input));
}

/** The one write: the whole plan lands as a single undo step. */
export function applyBoardFractal(
  workspace: WorkspaceDocument,
  input: PlanBoardFractalInput,
): LayoutPlanSummary {
  return workspace.applyLayoutPlan(planBoardFractal(input));
}
