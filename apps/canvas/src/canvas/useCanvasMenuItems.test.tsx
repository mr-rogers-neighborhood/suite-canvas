import type { Board, GraphEdge, WorkspaceDocument } from "@suite/graph";
import { sectionColors } from "@suite/graph";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContextMenuItem } from "../components/ContextMenu";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import type { ContextMenuState } from "../store/useUiStore";
import { type CanvasMenuItemsInput, useCanvasMenuItems } from "./useCanvasMenuItems";

const FULL_CAPABILITIES = {
  canCreateContent: true,
  canCreateBoards: true,
  canEditContent: true,
  canEditLayout: true,
  canManageStructure: true,
  canManageTrash: true,
  canManageLinks: true,
} as const;

const NO_CAPABILITIES = {
  canCreateContent: false,
  canCreateBoards: false,
  canEditContent: false,
  canEditLayout: false,
  canManageStructure: false,
  canManageTrash: false,
  canManageLinks: false,
} as const;

const board = (id: string, name: string) => ({ id, name }) as unknown as Board;

const ACTIVE_BOARD = "board-1";
const OTHER_BOARDS = [board("board-2", "Board 2"), board("board-3", "Board 3")];

function makeSnapshot(): WorkspaceSnapshot {
  return {
    boards: [board(ACTIVE_BOARD, "Board 1"), ...OTHER_BOARDS],
    views: [],
    cards: [],
    placements: [],
    edges: [],
    types: [],
    tags: [],
    sections: [],
    references: {},
  };
}

/** A workspace recorder: the menu only calls these methods. */
function makeWorkspace(edge?: GraphEdge) {
  return {
    setSectionColor: vi.fn(),
    deleteSection: vi.fn(),
    getEdge: vi.fn(() => edge),
    setEdgeLabel: vi.fn(),
    reverseEdge: vi.fn(),
    setEdgeBidirectional: vi.fn(),
    setEdgePath: vi.fn(),
    removeEdge: vi.fn(),
    removeConnector: vi.fn(),
    addConnector: vi.fn(),
    unplaceCard: vi.fn(),
    trashCard: vi.fn(),
  } as unknown as WorkspaceDocument & Record<string, ReturnType<typeof vi.fn>>;
}

function makeInput(
  contextMenu: ContextMenuState | null,
  overrides: Partial<CanvasMenuItemsInput> = {},
): CanvasMenuItemsInput {
  return {
    contextMenu,
    workspace: makeWorkspace(),
    snapshot: makeSnapshot(),
    activeBoardId: ACTIVE_BOARD,
    selectedNodeIds: [],
    sectionMembershipMap: new Map(),
    setSelectedNodeIds: vi.fn(),
    setSelectedConnector: vi.fn(),
    selectSection: vi.fn(),
    setEditingSection: vi.fn(),
    ...FULL_CAPABILITIES,
    createNoteAt: vi.fn(),
    createWhiteboardAt: vi.fn(),
    createSectionAt: vi.fn(),
    createBoardAt: vi.fn(),
    duplicateCards: vi.fn(),
    startEdgeDescription: vi.fn(),
    clearEdgeDescription: vi.fn(),
    deleteEdge: vi.fn(),
    setEdgePath: vi.fn(),
    setEdgeBidirectional: vi.fn(),
    moveCardToBoard: vi.fn(),
    unplaceSelected: vi.fn(),
    trashSelected: vi.fn(),
    changeLayer: vi.fn(),
    changeLayerBulk: vi.fn(),
    requestShare: vi.fn(),
    syncCardSelection: vi.fn(),
    ...overrides,
  };
}

function renderMenu(input: CanvasMenuItemsInput) {
  return renderHook(() => useCanvasMenuItems(input)).result.current;
}

const labels = (items: ContextMenuItem[]) => items.map((entry) => entry.label);

/** Finds a menu item by label; submenu entries live one level down. */
function item(items: ContextMenuItem[], label: string): ContextMenuItem {
  const found = items.find((entry) => entry.label === label);
  if (!found) throw new Error(`missing menu item ${label} in ${labels(items).join(", ")}`);
  return found;
}

const canvasMenu = (flowPosition?: { x: number; y: number }): ContextMenuState => ({
  x: 10,
  y: 20,
  kind: "canvas",
  ...(flowPosition ? { flowPosition } : {}),
});

describe("useCanvasMenuItems canvas menu", () => {
  it("renders nothing without a context menu or the content capability", () => {
    expect(renderMenu(makeInput(null))).toEqual([]);

    const noContent = makeInput(canvasMenu(), { canCreateContent: false });
    expect(renderMenu(noContent)).toEqual([]);
  });

  it("offers note, whiteboard, section and the fractal layout when allowed", () => {
    const flowPosition = { x: 40, y: 60 };
    const input = makeInput(canvasMenu(flowPosition));
    const items = renderMenu(input);

    expect(labels(items)).toEqual([
      "New note",
      "New whiteboard",
      "New section",
      "Arrange fractally",
      "New board",
    ]);

    item(items, "New note").onSelect?.();
    expect(input.createNoteAt).toHaveBeenCalledWith(flowPosition);

    item(items, "New whiteboard").onSelect?.();
    expect(input.createWhiteboardAt).toHaveBeenCalledWith(flowPosition);

    item(items, "New section").onSelect?.();
    expect(input.createSectionAt).toHaveBeenCalledWith(flowPosition);

    const patterns = item(items, "Arrange fractally").items ?? [];
    expect(patterns.every((pattern) => typeof pattern.onSelect === "function")).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("declines the section entries on a surface with no section layer", () => {
    const items = renderMenu(makeInput(canvasMenu({ x: 1, y: 2 }), { supportsSections: false }));
    expect(labels(items)).toEqual(["New note", "New whiteboard", "Arrange fractally", "New board"]);

    // A selection on a sectionless surface offers no "new section from …" either.
    const selected = renderMenu(
      makeInput(
        { ...canvasMenu({ x: 1, y: 2 }), kind: "node", nodeId: "card-1" },
        { selectedNodeIds: ["card-1"], supportsSections: false, supportsConnectors: false },
      ),
    );
    expect(labels(selected)).not.toContain("Add connector");
  });

  it("offers sections and connectors by default, so the scene surface is unchanged", () => {
    const canvasItems = renderMenu(makeInput(canvasMenu({ x: 1, y: 2 })));
    expect(labels(canvasItems)).toContain("New section");

    const nodeItems = renderMenu(
      makeInput({ ...canvasMenu({ x: 1, y: 2 }), kind: "node", nodeId: "card-1" }),
    );
    expect(labels(nodeItems)).toContain("Add connector");
  });

  it("drops the fractal layout for a capability without layout rights", () => {
    const items = renderMenu(makeInput(canvasMenu(), { canEditLayout: false }));
    expect(labels(items)).not.toContain("Arrange fractally");
  });

  it("plants a board at the clicked point", () => {
    const flowPosition = { x: 12, y: 34 };
    const input = makeInput(canvasMenu(flowPosition));

    item(renderMenu(input), "New board").onSelect?.();

    expect(input.createBoardAt).toHaveBeenCalledWith(flowPosition);
  });

  it("hides the new-board entry without the board capability", () => {
    const items = renderMenu(makeInput(canvasMenu(), { canCreateBoards: false }));
    expect(labels(items)).not.toContain("New board");
  });

  it("wraps the current selection in a new section", () => {
    const flowPosition = { x: 4, y: 8 };
    const input = makeInput(canvasMenu(flowPosition), { selectedNodeIds: ["card-1", "card-2"] });
    const items = renderMenu(input);

    item(items, "New section from 2 cards").onSelect?.();
    expect(input.createSectionAt).toHaveBeenCalledWith(flowPosition, true);
  });
});

describe("useCanvasMenuItems section menu", () => {
  const sectionMenu: ContextMenuState = { x: 0, y: 0, kind: "section", sectionId: "section-1" };

  it("renames, recolors, selects members and deletes the section", () => {
    const workspace = makeWorkspace();
    const input = makeInput(sectionMenu, {
      workspace,
      sectionMembershipMap: new Map([
        ["card-1", "section-1"],
        ["card-2", "section-1"],
        ["card-3", "section-2"],
      ]),
    });

    const items = renderMenu(input);
    expect(labels(items)).toEqual(["Rename section", "Color", "Select 2 cards", "Delete section"]);

    item(items, "Rename section").onSelect?.();
    expect(input.setEditingSection).toHaveBeenCalledWith("section-1");

    const colors = item(items, "Color").items ?? [];
    expect(colors).toHaveLength(sectionColors.length);
    const [firstColor] = colors;
    firstColor?.onSelect?.();
    expect(workspace.setSectionColor).toHaveBeenCalledWith("section-1", sectionColors[0]);

    item(items, "Select 2 cards").onSelect?.();
    expect(input.setSelectedNodeIds).toHaveBeenCalledWith(["card-1", "card-2"]);
    expect(input.syncCardSelection).toHaveBeenCalledWith(["card-1", "card-2"]);
    expect(input.selectSection).toHaveBeenCalledWith(null);

    item(items, "Delete section").onSelect?.();
    expect(workspace.deleteSection).toHaveBeenCalledWith("section-1");
    expect(input.selectSection).toHaveBeenCalledWith(null);
  });

  it("keeps the destructive entry behind the structure capability", () => {
    const items = renderMenu(makeInput(sectionMenu, { canManageStructure: false }));
    expect(labels(items)).not.toContain("Delete section");
  });

  it("renders nothing without layout rights", () => {
    expect(renderMenu(makeInput(sectionMenu, { canEditLayout: false }))).toEqual([]);
  });
});

describe("useCanvasMenuItems edge menu", () => {
  const edge = {
    id: "edge-1",
    label: "supports",
    bidirectional: false,
    path: "bezier",
  } as unknown as GraphEdge;
  const edgeMenu: ContextMenuState = { x: 5, y: 6, kind: "edge", edgeId: "edge-1" };

  it("offers exactly the rows the surface can keep", () => {
    const items = renderMenu(makeInput(edgeMenu, { workspace: makeWorkspace(edge) }));

    // Every row here has a projection behind it. "Reverse direction" is absent:
    // swapping a link's ends is not a prop the drawn link can take.
    expect(labels(items)).toEqual([
      "Edit description…",
      "Remove description",
      "Make bidirectional",
      "Path",
      "Delete link",
    ]);
    expect(labels(item(items, "Path").items ?? [])).toEqual([
      "Curved ✓",
      "Straight",
      "Step",
      "Smooth step",
    ]);
  });

  it("re-projects direction and routing through the surface, not the document alone", () => {
    const input = makeInput(edgeMenu, { workspace: makeWorkspace(edge) });
    const items = renderMenu(input);

    item(items, "Make bidirectional").onSelect?.();
    expect(input.setEdgeBidirectional).toHaveBeenCalledWith("edge-1", true);

    const straight = (item(items, "Path").items ?? []).find((entry) => entry.label === "Straight");
    straight?.onSelect?.();
    expect(input.setEdgePath).toHaveBeenCalledWith("edge-1", "straight");
  });

  it("opens the description editor and deletes through the planner callbacks", () => {
    const input = makeInput(edgeMenu, { workspace: makeWorkspace(edge) });
    const items = renderMenu(input);

    item(items, "Edit description…").onSelect?.();
    expect(input.startEdgeDescription).toHaveBeenCalledWith("edge-1", { x: 5, y: 6 });

    item(items, "Remove description").onSelect?.();
    expect(input.clearEdgeDescription).toHaveBeenCalledWith("edge-1");

    item(items, "Delete link").onSelect?.();
    expect(input.deleteEdge).toHaveBeenCalledWith("edge-1");
  });

  it("offers a plain description action for an unlabeled edge", () => {
    const unlabeled = { ...edge, label: undefined } as unknown as GraphEdge;
    const items = renderMenu(makeInput(edgeMenu, { workspace: makeWorkspace(unlabeled) }));

    expect(labels(items)).toContain("Add description…");
    expect(labels(items)).not.toContain("Remove description");
  });

  it("renders nothing without layout rights", () => {
    expect(renderMenu(makeInput(edgeMenu, { canEditLayout: false }))).toEqual([]);
  });
});

describe("useCanvasMenuItems connector menu", () => {
  const connectorMenu: ContextMenuState = {
    x: 0,
    y: 0,
    kind: "connector",
    nodeId: "card-1",
    connectorId: "connector-1",
  };

  it("repositions and deletes the connector", () => {
    const workspace = makeWorkspace();
    const input = makeInput(connectorMenu, { workspace });
    const items = renderMenu(input);

    expect(labels(items)).toEqual(["Reposition Connector", "Delete connector"]);

    item(items, "Reposition Connector").onSelect?.();
    expect(input.setSelectedConnector).toHaveBeenCalledWith({
      nodeId: "card-1",
      connectorId: "connector-1",
    });

    item(items, "Delete connector").onSelect?.();
    expect(workspace.removeConnector).toHaveBeenCalledWith("card-1", "connector-1");
    expect(input.setSelectedConnector).toHaveBeenCalledWith(null);
  });

  it("renders nothing without structure rights", () => {
    expect(renderMenu(makeInput(connectorMenu, { canManageStructure: false }))).toEqual([]);
  });
});

describe("useCanvasMenuItems card menus", () => {
  const cardMenu: ContextMenuState = {
    x: 0,
    y: 0,
    kind: "node",
    nodeId: "card-1",
    flowPosition: { x: 7, y: 9 },
  };

  it("acts on the whole multi-selection", () => {
    const workspace = makeWorkspace();
    const input = makeInput(cardMenu, { workspace, selectedNodeIds: ["card-1", "card-2"] });
    const items = renderMenu(input);

    expect(labels(items)).toEqual([
      "Duplicate 2 cards",
      "New section from 2 cards",
      "Position",
      "Remove from board",
      "Share 2 cards…",
      "Delete cards",
    ]);

    item(items, "Duplicate 2 cards").onSelect?.();
    expect(input.duplicateCards).toHaveBeenCalledWith(["card-1", "card-2"]);

    item(items, "New section from 2 cards").onSelect?.();
    expect(input.createSectionAt).toHaveBeenCalledWith({ x: 7, y: 9 }, true);

    const positions = item(items, "Position").items ?? [];
    const front = positions.find((entry) => entry.label === "Bring to Front");
    front?.onSelect?.();
    expect(input.changeLayerBulk).toHaveBeenCalledWith(["card-1", "card-2"], "front");

    item(items, "Remove from board").onSelect?.();
    expect(input.unplaceSelected).toHaveBeenCalledTimes(1);

    item(items, "Share 2 cards…").onSelect?.();
    expect(input.requestShare).toHaveBeenCalledWith("selection");

    item(items, "Delete cards").onSelect?.();
    expect(input.trashSelected).toHaveBeenCalledTimes(1);
  });

  it("keeps the single-card menu for a lone card", () => {
    const workspace = makeWorkspace();
    const input = makeInput(cardMenu, { workspace, selectedNodeIds: ["card-1"] });
    const items = renderMenu(input);

    expect(labels(items)).toEqual([
      "Duplicate",
      "Move to board",
      "Add connector",
      "Position",
      "Remove from board",
      "Delete card",
    ]);

    item(items, "Duplicate").onSelect?.();
    expect(input.duplicateCards).toHaveBeenCalledWith(["card-1"]);

    const targets = item(items, "Move to board").items ?? [];
    expect(labels(targets)).toEqual(["Board 2", "Board 3"]);
    targets.find((entry) => entry.label === "Board 2")?.onSelect?.();
    expect(input.moveCardToBoard).toHaveBeenCalledWith("card-1", "board-2");

    item(items, "Add connector").onSelect?.();
    expect(workspace.addConnector).toHaveBeenCalledWith("card-1");

    const positions = item(items, "Position").items ?? [];
    const back = positions.find((entry) => entry.label === "Send to Back");
    back?.onSelect?.();
    expect(input.changeLayer).toHaveBeenCalledWith("card-1", "back");

    item(items, "Remove from board").onSelect?.();
    expect(workspace.unplaceCard).toHaveBeenCalledWith(ACTIVE_BOARD, "card-1");
    expect(input.setSelectedNodeIds).toHaveBeenCalledWith([]);
    expect(input.setSelectedConnector).toHaveBeenCalledWith(null);

    item(items, "Delete card").onSelect?.();
    expect(workspace.trashCard).toHaveBeenCalledWith("card-1");
    expect(input.setSelectedNodeIds).toHaveBeenCalledWith([]);
    expect(input.setSelectedConnector).toHaveBeenCalledWith(null);
  });

  it("drops destructive and share entries a viewer could not complete", () => {
    const items = renderMenu(
      makeInput(cardMenu, {
        selectedNodeIds: ["card-1"],
        canManageTrash: false,
        canManageStructure: false,
      }),
    );

    expect(labels(items)).toEqual(["Duplicate", "Move to board", "Position", "Remove from board"]);
  });
});

describe("useCanvasMenuItems viewer", () => {
  const menus: ContextMenuState[] = [
    { x: 0, y: 0, kind: "canvas", flowPosition: { x: 1, y: 2 } },
    { x: 0, y: 0, kind: "section", sectionId: "section-1" },
    { x: 0, y: 0, kind: "edge", edgeId: "edge-1" },
    { x: 0, y: 0, kind: "connector", nodeId: "card-1", connectorId: "connector-1" },
    { x: 0, y: 0, kind: "node", nodeId: "card-1" },
  ];

  it("gets no menu on any surface", () => {
    for (const contextMenu of menus) {
      expect(renderMenu(makeInput(contextMenu, { ...NO_CAPABILITIES }))).toEqual([]);
    }
  });

  it("gets no menu for a multi-card selection either", () => {
    const items = renderMenu(
      makeInput(
        { x: 0, y: 0, kind: "node", nodeId: "card-1" },
        { ...NO_CAPABILITIES, selectedNodeIds: ["card-1", "card-2"] },
      ),
    );
    expect(items).toEqual([]);
  });
});
