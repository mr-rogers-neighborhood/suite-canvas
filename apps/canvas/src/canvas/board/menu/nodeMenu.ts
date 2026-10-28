import { portalTargetId } from "../../../cards/portal";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import { selectionSummary } from "../../interactions/multiSelect";
import { appearanceBranch } from "./appearanceMenu";
import type { BoardMenuContext } from "./types";

export function selectionMenuBranch(ctx: BoardMenuContext): ContextMenuItem[] | null {
  const {
    canCreateContent,
    canEditLayout,
    canManageTrash,
    canManageLinks,
    requestShare,
    createSectionAt,
    duplicateCards,
    changeLayerBulk,
    arrangeSelection,
    unplaceSelected,
    trashSelected,
    openAppearance,
    selectedNodeIds,
  } = ctx;
  const menu = ctx.menu;
  const selection = selectionSummary(selectedNodeIds);
  if (!(menu.nodeId && selection.multiple && selection.ids.includes(menu.nodeId))) return null;
  const anchor = menu.flowPosition ?? { x: 0, y: 0 };
  const at = { x: menu.x, y: menu.y };
  return [
    ...(canCreateContent
      ? [
          {
            label: `Duplicate ${selection.noun}`,
            onSelect: () => duplicateCards(selection.ids),
          },
        ]
      : []),
    ...(canCreateContent
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
            label: "Arrange",
            items: [
              {
                label: "Align left",
                onSelect: () => arrangeSelection("align", "left"),
              },
              {
                label: "Align centre",
                onSelect: () => arrangeSelection("align", "centerHorizontal"),
              },
              {
                label: "Align right",
                onSelect: () => arrangeSelection("align", "right"),
              },
              {
                label: "Align top",
                onSelect: () => arrangeSelection("align", "top"),
              },
              {
                label: "Align middle",
                onSelect: () => arrangeSelection("align", "middle"),
              },
              {
                label: "Align bottom",
                onSelect: () => arrangeSelection("align", "bottom"),
              },
              {
                label: "Distribute horizontally",
                onSelect: () => arrangeSelection("distribute", "horizontal"),
              },
              {
                label: "Distribute vertically",
                onSelect: () => arrangeSelection("distribute", "vertical"),
              },
            ],
          },
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
          {
            // One panel for the whole selection, Mixed where they disagree: the same
            // editor a single card and the inspector use, so nothing can drift.
            label: `Appearance\u2026`,
            onSelect: () => {
              if (!menu.nodeId) return;
              openAppearance({ kind: "card", id: menu.nodeId, ids: selection.ids, at });
            },
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

export function nodeMenuBranch(ctx: BoardMenuContext): ContextMenuItem[] | null {
  const {
    workspace,
    activeBoardId,
    canCreateContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    duplicateCards,
    moveCardToBoard,
    otherBoards,
    changeLayer,
    enterPortal,
    cardsById,
    setSelectedNodeIds,
    setSelectedConnector,
  } = ctx;
  const menu = ctx.menu;
  const nodeId = menu.nodeId;
  const moveTargets = otherBoards(activeBoardId);
  const portalTarget = nodeId ? portalTargetId(cardsById.get(nodeId)) : null;
  const card = nodeId ? cardsById.get(nodeId) : undefined;
  return [
    ...(nodeId
      ? appearanceBranch({
          palette: ctx.palette,
          style: card?.style,
          at: { x: menu.x, y: menu.y },
          canEdit: canEditLayout,
          target: { kind: "card", id: nodeId },
          onSetSwatch: (swatch) =>
            workspace.setCardStyle(nodeId, {
              ...(card?.style ?? {}),
              ...(swatch === null ? { swatch: undefined } : { swatch }),
            }),
          onOpenPanel: ctx.openAppearance,
        })
      : []),
    ...(nodeId && portalTarget
      ? [
          {
            label: "Open portal",
            onSelect: () => enterPortal(nodeId, portalTarget),
          },
        ]
      : []),
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
    ...(canManageStructure
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
