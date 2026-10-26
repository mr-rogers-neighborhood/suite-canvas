import { sectionColors } from "@suite/graph";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import type { BoardMenuContext } from "./types";

export function canvasMenuBranch(ctx: BoardMenuContext): ContextMenuItem[] | null {
  const {
    activeBoardId,
    canCreateContent,
    canCreateBoards,
    createNoteAt,
    createWhiteboardAt,
    createSectionAt,
    createPortalAt,
    createPortalToNewBoard,
    selectedNodeIds,
    boards,
  } = ctx;
  const menu = ctx.menu;
  if (!(menu.kind === "canvas")) return null;
  if (!canCreateContent) return [];
  const flowPosition = menu.flowPosition ?? { x: 0, y: 0 };
  // Every board is a possible target; creating one requires the board
  // capability, so a board share without it only sees existing boards.
  const portalItems: ContextMenuItem[] = [
    ...boards
      .filter((board) => board.id !== activeBoardId)
      .map((board) => ({
        label: board.name,
        onSelect: () => createPortalAt(flowPosition, board.id),
      })),
    ...(canCreateBoards
      ? [
          {
            // The label says both because it does both: the board is created
            // and this board opens it through a new portal card.
            label: "New board and portal",
            onSelect: () => createPortalToNewBoard(flowPosition),
          },
        ]
      : []),
  ];
  return [
    {
      label: "New card",
      onSelect: () => {
        if (menu.flowPosition) createNoteAt(menu.flowPosition);
      },
    },
    {
      label: "New sketch",
      onSelect: () => createWhiteboardAt(flowPosition),
    },
    {
      label: "New section",
      onSelect: () => createSectionAt(flowPosition),
    },
    ...(portalItems.length > 0
      ? [
          {
            label: "New portal",
            items: portalItems,
          },
        ]
      : []),
    ...(selectedNodeIds.length > 0
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

export function sectionMenuBranch(ctx: BoardMenuContext): ContextMenuItem[] | null {
  const {
    workspace,
    store,
    canEditLayout,
    canManageStructure,
    sectionMembershipMap,
    setSelectedNodeIds,
    setSelectedSectionConnector,
    setEditingSection,
    selectSection,
  } = ctx;
  const menu = ctx.menu;
  if (!(menu.kind === "section" && menu.sectionId)) return null;
  if (!canEditLayout) return [];
  const sectionId = menu.sectionId;
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
        store.getState().addSelectedNodes(memberIds);
        selectSection(null);
      },
    },
    ...(canManageStructure
      ? [
          {
            label: "Add connector",
            onSelect: () => {
              workspace.addSectionConnector(sectionId);
            },
          },
          {
            label: "Delete section",
            danger: true,
            onSelect: () => {
              workspace.deleteSection(sectionId);
              selectSection(null);
              setSelectedSectionConnector(null);
            },
          },
        ]
      : []),
  ];
}
