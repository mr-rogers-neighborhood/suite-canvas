import type { WorkspaceDocument } from "@suite/graph";
import { boardNameForFolder } from "./files.js";
import type { ImportReport } from "./report.js";

/**
 * Owns which board an imported note lands on, and where on it: the home board for
 * the vault root, one board per folder that holds a note, and a grid because a
 * Markdown note carries no geometry.
 */

/** A card is 288 wide; the pitch leaves room for a region drawn around it. */
export const NOTE_GRID = {
  columns: 3,
  columnWidth: 288,
  columnPitch: 336,
  rowPitch: 264,
} as const;

/** The position of the nth note on a board, in reading order. */
export function gridPosition(index: number): { x: number; y: number } {
  const column = index % NOTE_GRID.columns;
  const row = Math.floor(index / NOTE_GRID.columns);
  return { x: column * NOTE_GRID.columnPitch, y: row * NOTE_GRID.rowPitch };
}

export interface BoardPlan {
  /** The board notes outside any folder land on. */
  homeBoardId: string;
  /** Folder path (`""` for the root) to board id. */
  byFolder: Map<string, string>;
}

export interface PrepareBoardsOptions {
  /** Name for the vault root's board, usually the dropped folder's name. */
  homeBoardName?: string | undefined;
  /** One line per board, so a report can say what it made. */
  report?: ImportReport | undefined;
}

function recordBoard(report: ImportReport | undefined, board: { id: string; name: string }): void {
  if (!report) return;
  report.boards.push({ id: board.id, name: board.name });
  report.records.boards += 1;
}

/**
 * Creates the boards the vault needs. The home board is the workspace's first
 * board rather than a new one, so an empty workspace does not end up with a board
 * nobody uses beside the one it starts on.
 */
export function prepareBoards(
  workspace: WorkspaceDocument,
  folders: readonly string[],
  options: PrepareBoardsOptions = {},
): BoardPlan {
  const home = workspace.ensureBoard();
  const wantedName = options.homeBoardName?.trim();
  if (wantedName && wantedName.length > 0 && workspace.listCards().length === 0) {
    const taken = workspace
      .listBoards()
      .some((board) => board.id !== home.id && board.name === wantedName);
    if (!taken && home.name !== wantedName) workspace.renameBoard(home.id, wantedName);
  }
  recordBoard(options.report, workspace.getBoard(home.id) ?? home);

  const byFolder = new Map<string, string>([["", home.id]]);
  for (const folder of [...folders].sort()) {
    if (folder.length === 0 || byFolder.has(folder)) continue;
    const name = boardNameForFolder(folder);
    const created = workspace.createBoard({ name });
    byFolder.set(folder, created.id);
    recordBoard(options.report, created);
  }
  return { homeBoardId: home.id, byFolder };
}

/** The board a path lands on: its folder's, or the home board for the root. */
export function boardForPath(plan: BoardPlan, folder: string): string {
  return plan.byFolder.get(folder) ?? plan.homeBoardId;
}
