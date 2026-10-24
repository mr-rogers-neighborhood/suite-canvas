/**
 * The Board tree, as the desk compares it.
 *
 * A Board is drawn as a mat, and a mat is a container: ICE compiles an inside
 * frame for it once, at spawn, so it cannot be reconciled the way a card is
 * (delete + spawn the entity). The answer is a *structural key* — one flat
 * string holding exactly the document facts a mat is drawn from: which View is
 * framed, and each Board's id, parent, name, colour and rect. Compare it once
 * per workspace snapshot; when it changed the desk rebuilds its Board/card
 * projection, and when it did not the cheap reconcile stands.
 *
 * Cards are deliberately absent. A card is reconciled in place, and a key that
 * included them would rebuild the whole desk on every keystroke, on every drag
 * and on every link edit — the three things that must stay cheap.
 *
 * Nothing here writes, and nothing here reads React: the key is a pure function
 * of the document, so "does this change re-seed?" is a unit test.
 */

import { type Board, boardRootId, type View, type WorkspaceDocument } from "@suite/graph";

/** The two facts the key needs, kept structural so a test can pass either. */
export interface BoardTreeShape {
  /** The View the desk frames; `undefined` while the document has none. */
  readonly view: Pick<View, "id" | "name"> | undefined;
  /** Every Board in the workspace; the View's own subtree is taken from these. */
  readonly boards: readonly Board[];
}

/**
 * One Board's part of the key. Name and colour are in it because both are drawn
 * on the mat (the label and the vinyl), so a rename or a recolour is a
 * structural change like a move is.
 */
function boardPart(board: Board): string {
  const { x, y, width, height } = board.rect;
  return [
    board.id,
    board.parentBoardId ?? "",
    board.name,
    board.color ?? "",
    x,
    y,
    width,
    height,
  ].join("\u001f");
}

/**
 * The structural key: the View, then every Board under it. A Board on another
 * View is not in this desk's tree and changing it must not rebuild this one —
 * `boardRootId` is the same walk the projection does when it follows children.
 *
 * The parts are sorted so the key cannot change merely because two Boards
 * swapped paint order: `z` is not drawn into the mat, and a z-only change is not
 * worth a rebuild on a desk the reader is mid-gesture on.
 */
export function boardStructureKey(shape: BoardTreeShape): string {
  const { view, boards } = shape;
  if (view === undefined) return "";
  const parts = [`${view.id}\u001f${view.name}`];
  for (const board of boards) {
    if (boardRootId(boards, board.id) !== view.id) continue;
    parts.push(boardPart(board));
  }
  // The first part is the View; only the Boards are reordered.
  const [head, ...rest] = parts;
  return [head, ...rest.sort()].join("\n");
}

/**
 * The key of the tree a live workspace's desk is showing, or `null` for a desk
 * that is not framing a document (a demo). Both the boot, which records the key
 * it seeded from, and the projection, which compares the document against it,
 * read the tree through here so there is one definition of "the same tree".
 */
export function workspaceStructureKey(
  workspace: Pick<WorkspaceDocument, "getView" | "listBoards"> | null,
  viewId: string | null,
): string | null {
  if (workspace === null || viewId === null) return null;
  return boardStructureKey({ view: workspace.getView(viewId), boards: workspace.listBoards() });
}

/**
 * The part of an entered path that still exists, outermost first.
 *
 * A path is `[rootBoardId, …entered Boards]` and each level is a mat the reader
 * double-clicked into. A re-seed cannot enter a Board a peer deleted — there is
 * no mat to open — so the walk stops at the first missing Board and the reader
 * lands in the deepest ancestor that survived, which is the frame they came
 * from on the way down. A path of `[]` is the View's own plane.
 */
export function survivingEnteredPath(
  boards: readonly Board[],
  path: readonly string[],
): readonly string[] {
  const surviving: string[] = [];
  for (const id of path) {
    if (!boards.some((board) => board.id === id)) break;
    surviving.push(id);
  }
  return surviving;
}
