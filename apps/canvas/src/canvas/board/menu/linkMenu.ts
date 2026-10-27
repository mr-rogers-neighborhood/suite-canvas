import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import { MODE_NAMES, nextMode } from "../../links/linkGesture";
import { appearanceBranch } from "./appearanceMenu";
import type { BoardMenuContext } from "./types";

export function edgeMenuBranch(ctx: BoardMenuContext): ContextMenuItem[] | null {
  const { workspace, canEditLayout, startEdgeDescription } = ctx;
  const menu = ctx.menu;
  const edgeId = menu.edgeId;
  if (!(menu.kind === "edge" && edgeId)) return null;
  if (!canEditLayout) return [];
  const edge = workspace.getEdge(edgeId);
  return [
    ...appearanceBranch({
      palette: ctx.palette,
      style: edge?.style,
      at: { x: menu.x, y: menu.y },
      canEdit: canEditLayout,
      target: { kind: "edge", id: edgeId },
      onSetSwatch: (swatch) =>
        workspace.setEdgeStyle(edgeId, {
          ...(edge?.style ?? {}),
          ...(swatch === null ? { swatch: undefined } : { swatch }),
        }),
      onOpenPanel: ctx.openAppearance,
    }),
    {
      label: edge?.label ? "Edit description…" : "Add description…",
      onSelect: () => startEdgeDescription(edgeId, { x: menu.x, y: menu.y }),
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
        {
          // Routes around the cards and sections the line would cross. A link
          // with bends keeps them: the router is only asked when there is no
          // route drawn by hand (ADR-0052 §6).
          label: edge?.path === "avoid" ? "Avoid obstacles ✓" : "Avoid obstacles",
          onSelect: () => workspace.setEdgePath(edgeId, "avoid"),
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

export function connectorMenuBranch(ctx: BoardMenuContext): ContextMenuItem[] | null {
  const {
    workspace,
    mode,
    setMode,
    canManageStructure,
    setSelectedConnector,
    setSelectedSectionConnector,
  } = ctx;
  const menu = ctx.menu;
  const nodeId = menu.nodeId;
  if (!(menu.kind === "connector")) return null;
  if (!canManageStructure) return [];
  // The same toggle as the widget bar, where the user is already looking when
  // they right-click the dot they mean to start from.
  const switched = nextMode(mode);
  const modeItem = {
    label: `Switch to ${MODE_NAMES[switched]} mode`,
    onSelect: () => setMode(switched),
  };
  // Section connectors address a section, card connectors address a node.
  if (menu.sectionId && menu.connectorId) {
    const { sectionId, connectorId } = menu;
    return [
      modeItem,
      {
        label: "Reposition Connector",
        onSelect: () => setSelectedSectionConnector({ sectionId, connectorId }),
      },
      {
        label: "Delete connector",
        danger: true,
        onSelect: () => {
          workspace.removeSectionConnector(sectionId, connectorId);
          setSelectedSectionConnector(null);
        },
      },
    ];
  }
  return [
    modeItem,
    {
      label: "Reposition Connector",
      onSelect: () => {
        if (nodeId && menu.connectorId) {
          setSelectedConnector({ nodeId, connectorId: menu.connectorId });
        }
      },
    },
    {
      label: "Delete connector",
      danger: true,
      onSelect: () => {
        if (nodeId && menu.connectorId) {
          workspace.removeConnector(nodeId, menu.connectorId);
          setSelectedConnector(null);
        }
      },
    },
  ];
}
