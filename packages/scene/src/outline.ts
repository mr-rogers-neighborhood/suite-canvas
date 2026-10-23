import { boardInstanceKey } from "./scene.js";
import type { BoardInstance, PortalInstance, Scene, SceneOutlineRow } from "./types.js";

function outlineBoardRow(
  board: BoardInstance,
  portals: ReadonlyMap<string, readonly PortalInstance[]>,
  boards: ReadonlyMap<string, BoardInstance>,
): SceneOutlineRow {
  const children: SceneOutlineRow[] = [];
  for (const portal of portals.get(board.key) ?? []) {
    const child = portal.childKey ? boards.get(portal.childKey) : undefined;
    children.push({
      key: portal.key,
      kind: "portal",
      label: portal.title ?? portal.targetBoardName ?? portal.targetBoardId,
      boardId: portal.targetBoardId,
      cardId: portal.cardId,
      path: child?.path ?? [...portal.path, portal.targetBoardId],
      depth: portal.depth,
      lod: portal.lod,
      expanded: child !== undefined,
      cycle: portal.cycle,
      depthCapped: portal.depthCapped,
      children: child ? [outlineBoardRow(child, portals, boards)] : [],
    });
  }
  return {
    key: board.key,
    kind: "board",
    label: board.name,
    boardId: board.boardId,
    cardId: null,
    path: board.path,
    depth: board.depth,
    lod: board.lod,
    expanded: true,
    cycle: false,
    depthCapped: false,
    children,
  };
}

/**
 * The scene outline is the non-spatial twin of the canvas: root board ->
 * portal instances -> target boards -> nested portals. A cycle or depth stop is
 * a leaf portal row, never a board row, because the target is not instantiated.
 */
export function buildOutline(scene: Scene): readonly SceneOutlineRow[] {
  const boards = new Map(scene.boards.map((board) => [board.key, board] as const));
  const portals = new Map<string, PortalInstance[]>();
  for (const portal of scene.portals) {
    const key = boardInstanceKey(portal.path);
    const bucket = portals.get(key);
    if (bucket) bucket.push(portal);
    else portals.set(key, [portal]);
  }
  return [outlineBoardRow(scene.root, portals, boards)];
}

/** Pre-order flattening; useful for inspectors and keyboard traversal. */
export function flattenOutline(rows: readonly SceneOutlineRow[]): readonly SceneOutlineRow[] {
  const flat: SceneOutlineRow[] = [];
  const visit = (row: SceneOutlineRow) => {
    flat.push(row);
    for (const child of row.children) visit(child);
  };
  for (const row of rows) visit(row);
  return flat;
}

/** Every portal row that was stopped by a cycle or the depth cap. */
export function outlineStops(rows: readonly SceneOutlineRow[]): readonly SceneOutlineRow[] {
  return flattenOutline(rows).filter(
    (row) => row.kind === "portal" && (row.cycle || row.depthCapped),
  );
}
