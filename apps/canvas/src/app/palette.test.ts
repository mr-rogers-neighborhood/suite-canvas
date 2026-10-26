import { PORTAL_TYPE_ID, WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
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

function args(workspace: WorkspaceDocument, activeBoardId: string): ShellPaletteArgs {
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
