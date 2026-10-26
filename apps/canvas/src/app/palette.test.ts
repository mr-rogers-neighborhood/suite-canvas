import { PORTAL_TYPE_ID, WorkspaceDocument } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import { readWorkspace } from "../store/workspaceSnapshotStore";
import { type ShellPaletteArgs, shellPaletteItems } from "./palette";

/**
 * The palette's portal rows.
 *
 * `portal.create` expands to one row per other board, and the registry hides
 * every one of those rows until the shell supplies `createPortalOnBoard`. The
 * rows existing is therefore the proof that the action is wired, not that the
 * command table has a definition.
 */

function workspaceWithTwoBoards(): {
  workspace: WorkspaceDocument;
  home: string;
  target: string;
} {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const home = workspace.ensureBoard();
  workspace.renameBoard(home.id, "Home");
  const target = workspace.createBoard({ name: "Research" });
  return { workspace, home: home.id, target: target.id };
}

function args(
  workspace: WorkspaceDocument,
  activeBoardId: string,
  overrides: Partial<ShellPaletteArgs> = {},
): ShellPaletteArgs {
  const noop = () => {};
  return {
    workspace,
    snapshot: readWorkspace(workspace),
    savedViews: [],
    activeBoardId,
    activeViewId: null,
    cardFocusId: null,
    inspectorNodeId: null,
    selectedNodeIds: [],
    workspaceSurface: true,
    readOnly: false,
    paletteOpen: true,
    libraryOpen: false,
    libraryTab: "cards",
    canEditContent: true,
    canEditLayout: true,
    canPublish: true,
    canCreateContent: true,
    canCreateBoards: true,
    canManageBoards: true,
    canManageSchema: true,
    canManageTrash: true,
    canManageLinks: true,
    activateBoard: noop,
    selectSection: noop,
    openCardFocus: noop,
    openInspector: noop,
    applyView: noop,
    exitView: noop,
    createCard: () => undefined,
    canvasPoint: () => ({ x: 0, y: 0 }),
    placeCard: noop,
    setLibraryOpen: noop,
    setPaletteOpen: noop,
    setLibraryTab: noop,
    openTypeSettings: noop,
    requestShare: noop,
    setThemeMode: noop,
    themeMode: "light",
    ...overrides,
  };
}

describe("shellPaletteItems portal rows", () => {
  it("names one row per other board, keyed by the command and the board", () => {
    const { workspace, home, target } = workspaceWithTwoBoards();
    const rows = shellPaletteItems(args(workspace, home)).filter(
      (item) => item.commandId === "portal.create",
    );

    expect(rows.map((row) => row.id)).toEqual([`portal.create:${target}`]);
    expect(rows[0]?.title).toContain("New portal to Research");
    // The board the reader is on cannot portal to itself.
    expect(rows.some((row) => row.id === `portal.create:${home}`)).toBe(false);
  });

  it("creates the portal on the active board when its row runs", () => {
    const { workspace, home, target } = workspaceWithTwoBoards();
    const row = shellPaletteItems(args(workspace, home)).find(
      (item) => item.id === `portal.create:${target}`,
    );
    expect(row).toBeDefined();
    row?.run();

    const portals = workspace.listCards().filter((card) => card.primaryTypeId === PORTAL_TYPE_ID);
    expect(portals).toHaveLength(1);
    const [portal] = portals;
    if (!portal) throw new Error("no portal");
    expect(workspace.listCardPlacements(portal.id).map((placement) => placement.boardId)).toEqual([
      home,
    ]);
  });

  it("offers no portal row when there is nowhere to point it", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const only = workspace.ensureBoard();
    const rows = shellPaletteItems(args(workspace, only.id)).filter(
      (item) => item.commandId === "portal.create",
    );
    expect(rows).toHaveLength(0);
  });
});

/**
 * The document rows: undo, redo, the radial arrange and the blueprint install.
 *
 * Each is listed only while `CommandActions` holds a handler, so a row existing is
 * the proof the shell wired it — the registry has carried the definitions all along.
 */

function workspaceWithOneCard(): {
  workspace: WorkspaceDocument;
  board: string;
  card: string;
} {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText(card.id, "Root");
  return { workspace, board: board.id, card: card.id };
}

describe("shellPaletteItems document rows", () => {
  it("lists undo, redo and the radial arrange once the shell supplies them", () => {
    const { workspace, board, card } = workspaceWithOneCard();
    const rows = shellPaletteItems(
      args(workspace, board, {
        selectedNodeIds: [card],
        undo: () => {},
        redo: () => {},
        arrangeRadial: () => {},
      }),
    ).map((row) => row.commandId);

    expect(rows).toContain("edit.undo");
    expect(rows).toContain("edit.redo");
    expect(rows).toContain("layout.arrangeRadial");
  });

  it("lists none of them while the shell has no handler", () => {
    const { workspace, board, card } = workspaceWithOneCard();
    const rows = shellPaletteItems(args(workspace, board, { selectedNodeIds: [card] })).map(
      (row) => row.commandId,
    );

    expect(rows).not.toContain("edit.undo");
    expect(rows).not.toContain("edit.redo");
    expect(rows).not.toContain("layout.arrangeRadial");
    expect(rows).not.toContain("type.installBlueprint");
  });

  it("runs the undo, redo and arrange the shell handed over", () => {
    const { workspace, board, card } = workspaceWithOneCard();
    const undo = vi.fn();
    const redo = vi.fn();
    const arrangeRadial = vi.fn();
    const rows = shellPaletteItems(
      args(workspace, board, { selectedNodeIds: [card], undo, redo, arrangeRadial }),
    );

    for (const commandId of ["edit.undo", "edit.redo", "layout.arrangeRadial"]) {
      rows.find((row) => row.commandId === commandId)?.run();
    }

    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(arrangeRadial).toHaveBeenCalledTimes(1);
  });

  it("opens the install panel on the card the row names", () => {
    const { workspace, board, card } = workspaceWithOneCard();
    const installBlueprint = vi.fn();
    const row = shellPaletteItems(
      args(workspace, board, { selectedNodeIds: [card], installBlueprint }),
    ).find((entry) => entry.commandId === "type.installBlueprint");

    row?.run();

    expect(installBlueprint).toHaveBeenCalledWith(card);
  });

  it("keeps undo and redo away from a read-only session", () => {
    const { workspace, board, card } = workspaceWithOneCard();
    const rows = shellPaletteItems(
      args(workspace, board, {
        selectedNodeIds: [card],
        readOnly: true,
        undo: () => {},
        redo: () => {},
      }),
    ).map((row) => row.commandId);

    expect(rows).not.toContain("edit.undo");
    expect(rows).not.toContain("edit.redo");
  });
});
