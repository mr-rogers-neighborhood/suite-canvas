/**
 * Pure helpers over the Board tree (ADR-0039).
 *
 * A Board is a titled, coloured frame that holds cards and other Boards. The
 * tree has one implicit level above the stored records: a View's root board
 * shares the View's id and has no record, so a top-level Board's
 * `parentBoardId` names that View. Every helper below therefore works from the
 * stored Boards alone and treats any id it cannot resolve as a root.
 *
 * Nothing here writes, sorts its input or reads a clock: the same Boards give
 * the same tree on every client, which is what lets a surface plan a drag
 * before any write lands.
 */
import type { Board, Placement } from "./schema.js";

export interface Point {
  x: number;
  y: number;
}

export interface BoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Boards are painted bottom-first; fractional `z` keeps a reorder to one write. */
export function sortBoards(boards: readonly Board[]): Board[] {
  return [...boards].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

/** The stored Board with this id, or `undefined` when the id is a View root. */
export function findBoard(boards: readonly Board[], id: string): Board | undefined {
  return boards.find((board) => board.id === id);
}

/** The ids from this Board up to (and including) the root, root first. */
export function boardPath(boards: readonly Board[], boardId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = boardId;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    path.unshift(current);
    current = findBoard(boards, current)?.parentBoardId;
  }
  return path;
}

/** The root View id this Board hangs from; the Board's own id for a View root. */
export function boardRootId(boards: readonly Board[], boardId: string): string {
  return boardPath(boards, boardId)[0] ?? boardId;
}

/** Depth below the root: a View root is 0, a top-level Board is 1. */
export function boardDepth(boards: readonly Board[], boardId: string): number {
  return Math.max(0, boardPath(boards, boardId).length - 1);
}

/** Every Board structurally inside this one, breadth first. */
export function boardDescendants(boards: readonly Board[], boardId: string): Board[] {
  const descendants: Board[] = [];
  const queue = [boardId];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const board of boards) {
      if (board.parentBoardId !== current || seen.has(board.id)) continue;
      seen.add(board.id);
      descendants.push(board);
      queue.push(board.id);
    }
  }
  return descendants;
}

/** True when `candidate` sits somewhere inside `ancestor`. */
export function boardIsDescendant(
  boards: readonly Board[],
  candidate: string,
  ancestor: string,
): boolean {
  return candidate !== ancestor && boardPath(boards, candidate).includes(ancestor);
}

/**
 * The lowest Board that contains both ids — the deepest id shared by their
 * paths, so a Board contained in the other is its own answer. `undefined` when
 * they hang from different View roots: no single plane draws both.
 */
export function boardCommonAncestor(
  boards: readonly Board[],
  first: string,
  second: string,
): string | undefined {
  const secondPath = new Set(boardPath(boards, second));
  let common: string | undefined;
  for (const id of boardPath(boards, first)) {
    if (secondPath.has(id)) common = id;
  }
  return common;
}

/** Where a link between two Boards is drawn, and how deep that frame sits. */
export interface EdgeFrame {
  /** The frame itself: the Boards' lowest common ancestor. */
  boardId: string;
  /** Depth below its View root; a View root is 0. */
  depth: number;
  /** The frame's parent Board, when the frame is itself a stored Board. */
  ancestor?: string;
}

/**
 * The frame a link between these two Boards is drawn in (ADR-0039): the lowest
 * common ancestor, because that is the first plane on which both endpoint
 * cards are visible. `undefined` when the Boards belong to different Views.
 */
export function edgeFrameOf(
  boards: readonly Board[],
  sourceBoardId: string,
  targetBoardId: string,
): EdgeFrame | undefined {
  const boardId = boardCommonAncestor(boards, sourceBoardId, targetBoardId);
  if (boardId === undefined) return undefined;
  const ancestor = findBoard(boards, boardId)?.parentBoardId;
  return {
    boardId,
    depth: boardDepth(boards, boardId),
    ...(ancestor === undefined ? {} : { ancestor }),
  };
}

/**
 * Whether `parentBoardId` may contain `boardId`. Nesting cannot cycle: a Board
 * may not be its own parent, nor be moved inside anything it already holds.
 * An unknown parent (a View id) is always allowed — that is the root plane.
 */
export function canNestBoard(
  boards: readonly Board[],
  boardId: string,
  parentBoardId: string,
): boolean {
  if (boardId === parentBoardId) return false;
  if (findBoard(boards, parentBoardId) === undefined) return true;
  return !boardIsDescendant(boards, parentBoardId, boardId);
}

function contains(rect: BoardRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** A Board's rect in the root plane, accumulating every ancestor's origin. */
export function boardWorldRect(boards: readonly Board[], boardId: string): BoardRect | undefined {
  const board = findBoard(boards, boardId);
  if (board === undefined) return undefined;
  let x = board.rect.x;
  let y = board.rect.y;
  for (const ancestorId of boardPath(boards, boardId).slice(0, -1)) {
    const ancestor = findBoard(boards, ancestorId);
    if (ancestor === undefined) continue;
    x += ancestor.rect.x;
    y += ancestor.rect.y;
  }
  return { x, y, width: board.rect.width, height: board.rect.height };
}

/** The derived Section shape; structurally the schema's, without the import cycle. */
export interface BoardSection {
  id: string;
  boardId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  color?: Board["color"];
  createdAt: number;
  updatedAt: number;
}

/**
 * The legacy Section projection of the Board tree (ADR-0039 transition).
 *
 * The React Flow and scene surfaces still draw "sections of a view", so the
 * graph keeps deriving that shape: one Section per Board, flattened into the
 * view's own plane with `boardId` set to the View. Read-only; nothing is ever
 * stored in this shape.
 */
export function sectionsFromBoards(boards: readonly Board[]): BoardSection[] {
  const sections: BoardSection[] = [];
  for (const board of boards) {
    const rect = boardWorldRect(boards, board.id);
    if (rect === undefined) continue;
    sections.push({
      id: board.id,
      boardId: boardRootId(boards, board.id),
      title: board.name,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      z: board.z,
      ...(board.color === undefined ? {} : { color: board.color }),
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
    });
  }
  return sections.sort(
    (a, b) =>
      a.boardId.localeCompare(b.boardId) ||
      a.z - b.z ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
}

/**
 * The innermost Board whose rect contains `point` (given in `parentBoardId`'s
 * frame), or `undefined` when the point is on the plane itself. Children win
 * over parents, so a card dropped on a nested Board is owned by the nested one.
 */
export function boardAt(
  boards: readonly Board[],
  point: Point,
  parentBoardId: string | undefined,
): Board | undefined {
  let best: Board | undefined;
  let area = Number.POSITIVE_INFINITY;
  for (const board of boards) {
    if (board.parentBoardId !== parentBoardId) continue;
    if (!contains(board.rect, point)) continue;
    const own = board.rect.width * board.rect.height;
    if (own < area || (own === area && best !== undefined && board.id < best.id)) {
      best = board;
      area = own;
    }
  }
  if (best === undefined) return undefined;
  const local = { x: point.x - best.rect.x, y: point.y - best.rect.y };
  return boardAt(boards, local, best.id) ?? best;
}

/**
 * The Board that owns a card dropped at `point` on the root plane: the
 * innermost containing Board, or the root itself (which the placement stores
 * as `boardId`).
 */
export function ownerBoardAt(boards: readonly Board[], rootBoardId: string, point: Point): string {
  return boardAt(boards, point, rootBoardId)?.id ?? rootBoardId;
}

/**
 * The set that moves with a Board drag: the Board, everything nested in it and
 * the placements its subtree owns. Captured from stored geometry so peers and
 * the drag leader agree without an extra presence payload.
 */
export function boardMovePlan(
  boards: readonly Board[],
  boardId: string,
  placements: readonly Placement[],
): { boards: Board[]; placements: Placement[] } {
  const board = findBoard(boards, boardId);
  if (board === undefined) return { boards: [], placements: [] };
  const moving = [board, ...boardDescendants(boards, boardId)];
  const ids = new Set(moving.map((entry) => entry.id));
  return {
    boards: moving,
    placements: placements.filter((placement) => ids.has(placement.boardId)),
  };
}

/** Which side of a frame a link is drawn from (ADR-0041). */
export type BoardSide = "north" | "east" | "south" | "west";

/**
 * The side of a frame a link leaves by: the side whose midpoint faces `toward`.
 * A Board end attaches at a side midpoint rather than at a connector, because a
 * frame has no perimeter to hang one on — the wall itself is the anchor.
 */
export function boardSideFacing(rect: BoardRect, toward: Point): { side: BoardSide; point: Point } {
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = toward.x - centre.x;
  const dy = toward.y - centre.y;
  // Compare the travel against the frame's own aspect so a wide Board does not
  // always answer east/west: what matters is which wall is nearest the line.
  const horizontal = Math.abs(dx) * rect.height >= Math.abs(dy) * rect.width;
  if (horizontal) {
    return dx >= 0
      ? { side: "east", point: { x: rect.x + rect.width, y: centre.y } }
      : { side: "west", point: { x: rect.x, y: centre.y } };
  }
  return dy >= 0
    ? { side: "south", point: { x: centre.x, y: rect.y + rect.height } }
    : { side: "north", point: { x: centre.x, y: rect.y } };
}

/**
 * The point a Board's link end attaches at, in the Board's parent frame: the
 * midpoint of the wall facing `toward` (a world point), expressed as `rect` is.
 */
export function boardSideAnchor(rect: BoardRect, toward: Point): Point {
  return boardSideFacing(rect, toward).point;
}
