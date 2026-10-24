import { type LayerAction, sectionColors, type WorkspaceDocument } from "@suite/graph";
import { DEFAULT_FRACTAL_RECIPE, LAYOUT_PATTERNS, type LayoutPattern } from "@suite/scene";
import { useMemo } from "react";
import type { ContextMenuItem } from "../components/ContextMenu";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { applyBoardFractal } from "../scene/layoutCommand";
import type { ShareScope } from "../session/shares";
import type { ContextMenuState, SelectedConnector } from "../store/useUiStore";
import { selectionSummary } from "./multiSelect";

/** A flow-space point; the same shape React Flow's `flowPosition` uses. */
export type MenuPoint = { x: number; y: number };

export interface CanvasMenuItemsInput {
  contextMenu: ContextMenuState | null;
  workspace: WorkspaceDocument;
  snapshot: WorkspaceSnapshot;
  activeBoardId: string | null;
  selectedNodeIds: readonly string[];
  /** Card id → section id on the active board. */
  sectionMembershipMap: ReadonlyMap<string, string>;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedConnector: (connector: SelectedConnector | null) => void;
  selectSection: (id: string | null) => void;
  setEditingSection: (id: string | null) => void;
  canCreateContent: boolean;
  canCreateBoards: boolean;
  /**
   * Accepted for parity with the session capability matrix callers spread in;
   * the menu itself gates on the specific flags below.
   */
  canEditContent: boolean;
  canEditLayout: boolean;
  canManageStructure: boolean;
  canManageTrash: boolean;
  canManageLinks: boolean;
  createNoteAt: (position: MenuPoint) => void;
  createWhiteboardAt: (position: MenuPoint) => void;
  createSectionAt: (position: MenuPoint, wrapSelection?: boolean) => void;
  /** Plants an empty Board on the plane at `position` (ADR-0039). */
  createBoardAt: (position: MenuPoint) => void;
  duplicateCards: (ids: string[]) => void;
  startEdgeDescription: (edgeId: string, point: MenuPoint) => void;
  moveCardToBoard: (cardId: string, boardId: string) => void;
  unplaceSelected: () => void;
  trashSelected: () => void;
  changeLayer: (nodeId: string, action: LayerAction) => void;
  changeLayerBulk: (ids: string[], action: LayerAction) => void;
  requestShare: (scope: ShareScope) => void;
  /**
   * Mirrors a selection into the engine's own selection model. React Flow needs
   * it to keep node highlighting in step; a scene surface without one omits it.
   */
  syncCardSelection?: ((ids: string[]) => void) | undefined;
  /**
   * Whether this surface draws sections. The ICE canvas has no section layer
   * yet, so it declines the entries rather than offering actions whose result
   * it cannot show. Absent means yes, which is the scene surface's answer.
   */
  supportsSections?: boolean | undefined;
  /**
   * Whether this surface draws connectors. Same rule as `supportsSections`: a
   * surface that cannot show a connector must not offer to add one.
   */
  supportsConnectors?: boolean | undefined;
}

/**
 * The context menu for the canvas surface, built from the session's
 * capabilities so a share never renders an action its publish would reject.
 * Pure: every action is a callback the caller supplies.
 */
export function buildCanvasMenuItems(input: CanvasMenuItemsInput): ContextMenuItem[] {
  const {
    contextMenu,
    workspace,
    snapshot,
    activeBoardId,
    selectedNodeIds,
    sectionMembershipMap,
    setSelectedNodeIds,
    setSelectedConnector,
    selectSection,
    setEditingSection,
    canCreateContent,
    canCreateBoards,
    canEditLayout,
    canManageStructure,
    supportsSections = true,
    supportsConnectors = true,
    canManageTrash,
    canManageLinks,
    createNoteAt,
    createWhiteboardAt,
    createSectionAt,
    createBoardAt,
    duplicateCards,
    startEdgeDescription,
    moveCardToBoard,
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    requestShare,
    syncCardSelection,
  } = input;

  /**
   * The fractal layout command. Planning reads the same snapshot the canvas
   * draws, and the write is one undoable batch; a failed plan must not take the
   * menu down with it.
   */
  const arrangeFractal = (pattern: LayoutPattern) => {
    if (!canEditLayout || !activeBoardId) return;
    try {
      applyBoardFractal(workspace, {
        snapshot,
        rootBoardId: activeBoardId,
        recipe: { ...DEFAULT_FRACTAL_RECIPE, pattern },
      });
    } catch (error) {
      console.warn("[layout] could not apply fractal layout", error);
    }
  };

  // A viewer gets no menu at all.
  if (!contextMenu) return [];

  if (contextMenu.kind === "canvas") {
    if (!canCreateContent) return [];
    const flowPosition = contextMenu.flowPosition ?? { x: 0, y: 0 };
    return [
      {
        label: "New note",
        onSelect: () => {
          if (contextMenu.flowPosition) createNoteAt(contextMenu.flowPosition);
        },
      },
      {
        label: "New whiteboard",
        onSelect: () => createWhiteboardAt(flowPosition),
      },
      ...(supportsSections
        ? [
            {
              label: "New section",
              onSelect: () => createSectionAt(flowPosition),
            },
          ]
        : []),
      ...(canEditLayout
        ? [
            {
              label: "Arrange fractally",
              items: LAYOUT_PATTERNS.map((pattern) => ({
                label: pattern.charAt(0).toUpperCase() + pattern.slice(1),
                onSelect: () => arrangeFractal(pattern),
              })),
            },
          ]
        : []),
      ...(canCreateBoards
        ? [
            {
              label: "New board",
              onSelect: () => createBoardAt(flowPosition),
            },
          ]
        : []),
      ...(supportsSections && selectedNodeIds.length > 0
        ? [
            {
              label: `New section from ${selectedNodeIds.length} card${
                selectedNodeIds.length === 1 ? "" : "s"
              }`,
              onSelect: () => createSectionAt(flowPosition, true),
            },
          ]
        : []),
    ];
  }

  if (contextMenu.kind === "section" && contextMenu.sectionId) {
    if (!canEditLayout) return [];
    const sectionId = contextMenu.sectionId;
    const memberIds = [...sectionMembershipMap]
      .filter(([, id]) => id === sectionId)
      .map(([cardId]) => cardId);
    return [
      {
        label: "Rename section",
        onSelect: () => setEditingSection(sectionId),
      },
      {
        label: "Color",
        items: sectionColors.map((color) => ({
          label: color.charAt(0).toUpperCase() + color.slice(1),
          onSelect: () => workspace.setSectionColor(sectionId, color),
        })),
      },
      {
        label: `Select ${memberIds.length} card${memberIds.length === 1 ? "" : "s"}`,
        onSelect: () => {
          setSelectedNodeIds(memberIds);
          syncCardSelection?.(memberIds);
          selectSection(null);
        },
      },
      ...(canManageStructure
        ? [
            {
              label: "Delete section",
              danger: true,
              onSelect: () => {
                workspace.deleteSection(sectionId);
                selectSection(null);
              },
            },
          ]
        : []),
    ];
  }

  const nodeId = contextMenu.nodeId;
  const edgeId = contextMenu.edgeId;

  if (contextMenu.kind === "edge" && edgeId) {
    if (!canEditLayout) return [];
    const edge = workspace.getEdge(edgeId);
    return [
      {
        label: edge?.label ? "Edit description…" : "Add description…",
        onSelect: () => startEdgeDescription(edgeId, { x: contextMenu.x, y: contextMenu.y }),
      },
      ...(edge?.label
        ? [
            {
              label: "Remove description",
              danger: true,
              onSelect: () => workspace.setEdgeLabel(edgeId, null),
            },
          ]
        : []),
      {
        label: "Reverse direction",
        onSelect: () => workspace.reverseEdge(edgeId),
      },
      {
        label: edge?.bidirectional ? "Make one-way" : "Make bidirectional",
        onSelect: () => workspace.setEdgeBidirectional(edgeId, !edge?.bidirectional),
      },
      {
        label: "Path",
        items: [
          {
            label: edge?.path === "bezier" ? "Curved ✓" : "Curved",
            onSelect: () => workspace.setEdgePath(edgeId, "bezier"),
          },
          {
            label: edge?.path === "straight" ? "Straight ✓" : "Straight",
            onSelect: () => workspace.setEdgePath(edgeId, "straight"),
          },
          {
            label: edge?.path === "step" ? "Step ✓" : "Step",
            onSelect: () => workspace.setEdgePath(edgeId, "step"),
          },
          {
            label: edge?.path === "smoothstep" ? "Smooth step ✓" : "Smooth step",
            onSelect: () => workspace.setEdgePath(edgeId, "smoothstep"),
          },
        ],
      },
      {
        label: "Delete link",
        danger: true,
        onSelect: () => workspace.removeEdge(edgeId),
      },
    ];
  }

  if (contextMenu.kind === "connector") {
    if (!canManageStructure) return [];
    return [
      {
        label: "Reposition Connector",
        onSelect: () => {
          if (nodeId && contextMenu.connectorId) {
            setSelectedConnector({ nodeId, connectorId: contextMenu.connectorId });
          }
        },
      },
      {
        label: "Delete connector",
        danger: true,
        onSelect: () => {
          if (nodeId && contextMenu.connectorId) {
            workspace.removeConnector(nodeId, contextMenu.connectorId);
            setSelectedConnector(null);
          }
        },
      },
    ];
  }

  // Right-clicking a card that is part of a multi-selection acts on the whole
  // selection; a lone card keeps the single-card menu.
  const selection = selectionSummary(selectedNodeIds);
  if (nodeId && selection.multiple && selection.ids.includes(nodeId)) {
    const anchor = contextMenu.flowPosition ?? { x: 0, y: 0 };
    return [
      ...(canCreateContent
        ? [
            {
              label: `Duplicate ${selection.noun}`,
              onSelect: () => duplicateCards(selection.ids),
            },
          ]
        : []),
      ...(canCreateContent && supportsSections
        ? [
            {
              label: `New section from ${selection.noun}`,
              onSelect: () => createSectionAt(anchor, true),
            },
          ]
        : []),
      ...(canEditLayout
        ? [
            {
              label: "Position",
              items: [
                {
                  label: "Bring Forward",
                  onSelect: () => changeLayerBulk(selection.ids, "forward"),
                },
                {
                  label: "Bring to Front",
                  onSelect: () => changeLayerBulk(selection.ids, "front"),
                },
                {
                  label: "Send Back",
                  onSelect: () => changeLayerBulk(selection.ids, "backward"),
                },
                {
                  label: "Send to Back",
                  onSelect: () => changeLayerBulk(selection.ids, "back"),
                },
              ],
            },
            {
              label: "Remove from board",
              onSelect: () => unplaceSelected(),
            },
          ]
        : []),
      // Sharing is a link owner's right, and only a subset with two or more
      // cards is worth a link; the dialog opens on the selection scope.
      ...(canManageLinks
        ? [
            {
              label: `Share ${selection.noun}\u2026`,
              onSelect: () => requestShare("selection"),
            },
          ]
        : []),
      // Destructive entries stay last.
      ...(canManageTrash
        ? [
            {
              label: "Delete cards",
              danger: true,
              onSelect: () => trashSelected(),
            },
          ]
        : []),
    ];
  }

  const moveTargets = snapshot.boards
    .filter((board) => board.id !== activeBoardId)
    .map((board) => ({ id: board.id, name: board.name }));
  return [
    ...(canCreateContent
      ? [
          {
            label: "Duplicate",
            onSelect: () => {
              if (nodeId) duplicateCards([nodeId]);
            },
          },
        ]
      : []),
    ...(canEditLayout && moveTargets.length > 0
      ? [
          {
            label: "Move to board",
            items: moveTargets.map((board) => ({
              label: board.name,
              onSelect: () => {
                if (nodeId) moveCardToBoard(nodeId, board.id);
              },
            })),
          },
        ]
      : []),
    ...(canManageStructure && supportsConnectors
      ? [
          {
            label: "Add connector",
            onSelect: () => {
              if (nodeId) workspace.addConnector(nodeId);
            },
          },
        ]
      : []),
    ...(canEditLayout
      ? [
          {
            label: "Position",
            items: [
              {
                label: "Bring Forward",
                onSelect: () => nodeId && changeLayer(nodeId, "forward"),
              },
              {
                label: "Bring to Front",
                onSelect: () => nodeId && changeLayer(nodeId, "front"),
              },
              {
                label: "Send Back",
                onSelect: () => nodeId && changeLayer(nodeId, "backward"),
              },
              {
                label: "Send to Back",
                onSelect: () => nodeId && changeLayer(nodeId, "back"),
              },
            ],
          },
          {
            label: "Remove from board",
            onSelect: () => {
              if (nodeId && activeBoardId) {
                workspace.unplaceCard(activeBoardId, nodeId);
                setSelectedNodeIds([]);
                setSelectedConnector(null);
              }
            },
          },
        ]
      : []),
    ...(canManageTrash
      ? [
          {
            label: "Delete card",
            danger: true,
            onSelect: () => {
              if (nodeId) {
                workspace.trashCard(nodeId);
                setSelectedNodeIds([]);
                setSelectedConnector(null);
              }
            },
          },
        ]
      : []),
  ];
}

/** Memoised binding of {@link buildCanvasMenuItems} for a component. */
export function useCanvasMenuItems(input: CanvasMenuItemsInput): ContextMenuItem[] {
  const {
    contextMenu,
    workspace,
    snapshot,
    activeBoardId,
    selectedNodeIds,
    sectionMembershipMap,
    setSelectedNodeIds,
    setSelectedConnector,
    selectSection,
    setEditingSection,
    canCreateContent,
    canCreateBoards,
    canEditContent,
    canEditLayout,
    canManageStructure,
    canManageTrash,
    canManageLinks,
    createNoteAt,
    createWhiteboardAt,
    createSectionAt,
    createBoardAt,
    duplicateCards,
    startEdgeDescription,
    moveCardToBoard,
    unplaceSelected,
    trashSelected,
    changeLayer,
    changeLayerBulk,
    requestShare,
    syncCardSelection,
    supportsSections,
    supportsConnectors,
  } = input;

  return useMemo(
    () =>
      buildCanvasMenuItems({
        contextMenu,
        workspace,
        snapshot,
        activeBoardId,
        selectedNodeIds,
        sectionMembershipMap,
        setSelectedNodeIds,
        setSelectedConnector,
        selectSection,
        setEditingSection,
        canCreateContent,
        canCreateBoards,
        canEditContent,
        canEditLayout,
        canManageStructure,
        canManageTrash,
        canManageLinks,
        supportsSections,
        supportsConnectors,
        createNoteAt,
        createWhiteboardAt,
        createSectionAt,
        createBoardAt,
        duplicateCards,
        startEdgeDescription,
        moveCardToBoard,
        unplaceSelected,
        trashSelected,
        changeLayer,
        changeLayerBulk,
        requestShare,
        syncCardSelection,
      }),
    [
      contextMenu,
      workspace,
      snapshot,
      activeBoardId,
      selectedNodeIds,
      sectionMembershipMap,
      setSelectedNodeIds,
      setSelectedConnector,
      selectSection,
      setEditingSection,
      canCreateContent,
      canCreateBoards,
      canEditContent,
      canEditLayout,
      canManageStructure,
      canManageTrash,
      canManageLinks,
      supportsSections,
      supportsConnectors,
      createNoteAt,
      createWhiteboardAt,
      createSectionAt,
      createBoardAt,
      duplicateCards,
      startEdgeDescription,
      moveCardToBoard,
      unplaceSelected,
      trashSelected,
      changeLayer,
      changeLayerBulk,
      requestShare,
      syncCardSelection,
    ],
  );
}
