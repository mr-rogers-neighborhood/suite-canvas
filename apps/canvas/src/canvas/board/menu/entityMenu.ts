import { sectionColors } from "@suite/graph";
import { portalTargetId } from "../../../cards/portal";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import type { EntityKind } from "../../../entities/kind";
import { selectionSummary } from "../../interactions/multiSelect";
import type { BoardMenuContext } from "./types";

/**
 * One menu, described as rows.
 *
 * Every entity answers the same question — "what can be done to me?" — by declaring the
 * kinds a row serves. A right-click resolves what it landed on, keeps the rows that
 * serve it, and draws them in group order, so the shape of the menu is the same
 * everywhere and a thing that cannot be coloured, deleted or shared simply has no row
 * for it. A press inside a multi-selection resolves to every selected card, which is
 * why a verb can count: `Duplicate 4 cards` is one row, not a second menu.
 *
 * A row renders its own items because the label and the target of a verb depend on what
 * it is acting on; the table still owns the order and the grouping.
 */
export type MenuGroup = "appearance" | "structure" | "layout" | "transfer" | "share" | "danger";

const GROUP_ORDER: readonly MenuGroup[] = [
  "appearance",
  "structure",
  "layout",
  "transfer",
  "share",
  "danger",
];

export interface MenuTarget {
  kind: EntityKind;
  /** What the menu acts on: one thing, or the whole selection a press landed in. */
  ids: readonly string[];
  /** The pressed thing, when there is one. */
  anchor?: string | undefined;
  /** A section connector's section; card connectors name their card instead. */
  sectionId?: string | undefined;
}

export interface EntityMenuRow {
  id: string;
  group: MenuGroup;
  /** The kinds this row can serve. It shows only when it serves the whole target. */
  kinds: readonly EntityKind[];
  render: (ctx: BoardMenuContext, target: MenuTarget) => ContextMenuItem[];
}

const at = (ctx: BoardMenuContext) => ({ x: ctx.menu.x, y: ctx.menu.y });

const colourRow: EntityMenuRow = {
  id: "colour",
  group: "appearance",
  kinds: ["card", "portal", "section", "edge"],
  render: (ctx, target) => {
    if (!ctx.canEditLayout) return [];
    // A section's palette is its own six names; a card and a link wear a theme swatch.
    if (target.kind === "section") {
      const sectionId = target.ids[0];
      if (!sectionId) return [];
      return [
        {
          label: "Colour",
          items: sectionColors.map((color) => ({
            label: color.charAt(0).toUpperCase() + color.slice(1),
            onSelect: () => ctx.workspace.setSectionColor(sectionId, color),
          })),
        },
      ];
    }
    if (target.kind === "edge") {
      const edgeId = target.ids[0];
      if (!edgeId) return [];
      const style = ctx.workspace.getEdge(edgeId)?.style;
      return [
        {
          label: "Colour",
          items: swatches(ctx, style?.swatch, (swatch) =>
            ctx.workspace.setEdgeStyle(edgeId, {
              ...(style ?? {}),
              ...(swatch === null ? { swatch: undefined } : { swatch }),
            }),
          ),
        },
      ];
    }
    const first = target.ids[0];
    if (!first) return [];
    const style = ctx.cardsById.get(first)?.style;
    return [
      {
        label: "Colour",
        items: swatches(ctx, style?.swatch, (swatch) => ctx.setSwatches(target.ids, swatch)),
      },
    ];
  },
};

const appearanceRow: EntityMenuRow = {
  id: "appearance",
  group: "appearance",
  kinds: ["card", "portal", "edge"],
  render: (ctx, target) => {
    if (!ctx.canEditLayout) return [];
    const id = target.ids[0];
    if (!id) return [];
    const kind = target.kind === "edge" ? "edge" : "card";
    return [
      {
        // One panel for the whole target: the same editor the Style tab uses, so a
        // quick-pick here and a slider there cannot drift apart.
        label: "Appearance\u2026",
        onSelect: () =>
          ctx.openAppearance({
            kind,
            id,
            ...(target.ids.length > 1 ? { ids: [...target.ids] } : {}),
            at: at(ctx),
          }),
      },
    ];
  },
};

const canvasRows: EntityMenuRow[] = [
  {
    id: "new-card",
    group: "structure",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      const position = ctx.menu.flowPosition;
      return [
        {
          label: "New card",
          onSelect: () => {
            if (position) ctx.createNoteAt(position);
          },
        },
      ];
    },
  },
  {
    id: "new-sketch",
    group: "structure",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "New sketch", onSelect: () => ctx.createWhiteboardAt(position) }];
    },
  },
  {
    id: "new-section",
    group: "structure",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "New section", onSelect: () => ctx.createSectionAt(position) }];
    },
  },
  {
    id: "new-portal",
    group: "structure",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      // Every board is a possible target; making one needs the board capability, so a
      // share without it only sees the boards that exist.
      const items: ContextMenuItem[] = [
        ...ctx.boards
          .filter((board) => board.id !== ctx.activeBoardId)
          .map((board) => ({
            label: board.name,
            onSelect: () => ctx.createPortalAt(position, board.id),
          })),
        ...(ctx.canCreateBoards
          ? [{ label: "New board", onSelect: () => ctx.createPortalToNewBoard(position) }]
          : []),
      ];
      return items.length > 0 ? [{ label: "New portal", items }] : [];
    },
  },
];

const openPortalRow: EntityMenuRow = {
  id: "open-portal",
  group: "structure",
  kinds: ["portal"],
  render: (ctx, target) => {
    const nodeId = target.anchor;
    const boardId = nodeId ? portalTargetId(ctx.cardsById.get(nodeId)) : null;
    if (!(nodeId && boardId)) return [];
    return [{ label: "Open portal", onSelect: () => ctx.enterPortal(nodeId, boardId) }];
  },
};

const duplicateRow: EntityMenuRow = {
  id: "duplicate",
  group: "structure",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    if (!ctx.canCreateContent) return [];
    const { ids, multiple, noun } = selectionSummary(target.ids);
    return [
      {
        label: multiple ? `Duplicate ${noun}` : "Duplicate",
        onSelect: () => ctx.duplicateCards(ids),
      },
    ];
  },
};

const sectionFromRow: EntityMenuRow = {
  id: "section-from",
  group: "structure",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    if (!ctx.canCreateContent) return [];
    const { ids, noun } = selectionSummary(target.ids);
    const anchor = ctx.menu.flowPosition ?? { x: 0, y: 0 };
    // With a selection the section is made around it; a single card is placed in one.
    return [
      {
        label: `New section from ${noun}`,
        onSelect: () => {
          if (ids.length > 1) ctx.createSectionAt(anchor, true);
          else ctx.createSectionAt(anchor, false);
        },
      },
    ];
  },
};

const connectorRow: EntityMenuRow = {
  id: "add-connector",
  group: "structure",
  kinds: ["card", "portal", "section"],
  render: (ctx, target) => {
    if (!ctx.canManageStructure) return [];
    const id = target.ids[0];
    if (!id) return [];
    return [
      {
        label: "Add connector",
        onSelect: () => {
          if (target.kind === "section") ctx.workspace.addSectionConnector(id);
          else ctx.workspace.addConnector(id);
        },
      },
    ];
  },
};

const arrangeRow: EntityMenuRow = {
  id: "arrange",
  group: "layout",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    const { multiple } = selectionSummary(target.ids);
    if (!(ctx.canEditLayout && multiple)) return [];
    return [
      {
        label: "Arrange",
        items: [
          { label: "Align left", onSelect: () => ctx.arrangeSelection("align", "left") },
          {
            label: "Align centre",
            onSelect: () => ctx.arrangeSelection("align", "centerHorizontal"),
          },
          { label: "Align right", onSelect: () => ctx.arrangeSelection("align", "right") },
          { label: "Align top", onSelect: () => ctx.arrangeSelection("align", "top") },
          { label: "Align middle", onSelect: () => ctx.arrangeSelection("align", "middle") },
          { label: "Align bottom", onSelect: () => ctx.arrangeSelection("align", "bottom") },
          {
            label: "Distribute horizontally",
            onSelect: () => ctx.arrangeSelection("distribute", "horizontal"),
          },
          {
            label: "Distribute vertically",
            onSelect: () => ctx.arrangeSelection("distribute", "vertical"),
          },
        ],
      },
    ];
  },
};

const positionRow: EntityMenuRow = {
  id: "position",
  group: "layout",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    if (!ctx.canEditLayout) return [];
    const { ids, multiple } = selectionSummary(target.ids);
    const act = (action: "forward" | "front" | "backward" | "back") => {
      if (multiple) ctx.changeLayerBulk(ids, action);
      else if (ids[0]) ctx.changeLayer(ids[0], action);
    };
    return [
      {
        label: "Position",
        items: [
          { label: "Bring Forward", onSelect: () => act("forward") },
          { label: "Bring to Front", onSelect: () => act("front") },
          { label: "Send Back", onSelect: () => act("backward") },
          { label: "Send to Back", onSelect: () => act("back") },
        ],
      },
    ];
  },
};

const moveBoardRow: EntityMenuRow = {
  id: "move-board",
  group: "transfer",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    const nodeId = target.anchor;
    const boards = ctx.otherBoards(ctx.activeBoardId);
    if (!(ctx.canEditLayout && nodeId && boards.length > 0)) return [];
    return [
      {
        label: "Move to board",
        items: boards.map((board) => ({
          label: board.name,
          onSelect: () => ctx.moveCardToBoard(nodeId, board.id),
        })),
      },
    ];
  },
};

const removeRow: EntityMenuRow = {
  id: "remove",
  group: "transfer",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    if (!ctx.canEditLayout) return [];
    return [
      {
        label: "Remove from board",
        onSelect: () => {
          if (target.ids.length > 1) {
            ctx.unplaceSelected();
            return;
          }
          if (target.anchor && ctx.activeBoardId) {
            ctx.workspace.unplaceCard(ctx.activeBoardId, target.anchor);
            ctx.setSelectedNodeIds([]);
            ctx.setSelectedConnector(null);
          }
        },
      },
    ];
  },
};

const sectionRows: EntityMenuRow[] = [
  {
    id: "rename-section",
    group: "structure",
    kinds: ["section"],
    render: (ctx, target) => {
      const sectionId = target.ids[0];
      if (!(ctx.canEditLayout && sectionId)) return [];
      return [{ label: "Rename section", onSelect: () => ctx.setEditingSection(sectionId) }];
    },
  },
  {
    id: "select-members",
    group: "structure",
    kinds: ["section"],
    render: (ctx, target) => {
      const sectionId = target.ids[0];
      if (!sectionId) return [];
      const members = [...ctx.sectionMembershipMap]
        .filter(([, id]) => id === sectionId)
        .map(([cardId]) => cardId);
      return [
        {
          label: `Select ${members.length} card${members.length === 1 ? "" : "s"}`,
          onSelect: () => {
            ctx.setSelectedNodeIds(members);
            ctx.store.getState().addSelectedNodes(members);
            ctx.selectSection(null);
          },
        },
      ];
    },
  },
];

const edgeRows: EntityMenuRow[] = [
  {
    id: "edge-description",
    group: "structure",
    kinds: ["edge"],
    render: (ctx, target) => {
      const edgeId = target.ids[0];
      if (!(ctx.canEditLayout && edgeId)) return [];
      const edge = ctx.workspace.getEdge(edgeId);
      return [
        {
          label: edge?.label ? "Edit description…" : "Add description…",
          onSelect: () => ctx.startEdgeDescription(edgeId, at(ctx)),
        },
        ...(edge?.label
          ? [
              {
                label: "Remove description",
                danger: true,
                onSelect: () => ctx.workspace.setEdgeLabel(edgeId, null),
              },
            ]
          : []),
      ];
    },
  },
  {
    id: "edge-direction",
    group: "structure",
    kinds: ["edge"],
    render: (ctx, target) => {
      const edgeId = target.ids[0];
      if (!(ctx.canEditLayout && edgeId)) return [];
      const edge = ctx.workspace.getEdge(edgeId);
      return [
        { label: "Reverse direction", onSelect: () => ctx.workspace.reverseEdge(edgeId) },
        {
          label: edge?.bidirectional ? "Make one-way" : "Make bidirectional",
          onSelect: () =>
            ctx.workspace.setEdgeBidirectional(edgeId, !(edge?.bidirectional ?? false)),
        },
      ];
    },
  },
  {
    id: "edge-path",
    group: "layout",
    kinds: ["edge"],
    render: (ctx, target) => {
      const edgeId = target.ids[0];
      if (!(ctx.canEditLayout && edgeId)) return [];
      const path = ctx.workspace.getEdge(edgeId)?.path;
      const entries: { value: typeof path; label: string }[] = [
        { value: "bezier", label: "Curved" },
        { value: "straight", label: "Straight" },
        { value: "step", label: "Step" },
        { value: "smoothstep", label: "Smooth step" },
        // Routes around the cards and sections the line would cross. A link with bends
        // keeps them: the router is only asked when there is no route drawn by hand.
        { value: "avoid", label: "Avoid obstacles" },
      ];
      return [
        {
          label: "Path",
          items: entries.map((entry) => ({
            label: path === entry.value ? `${entry.label} ✓` : entry.label,
            onSelect: () => {
              if (entry.value) ctx.workspace.setEdgePath(edgeId, entry.value);
            },
          })),
        },
      ];
    },
  },
];

const connectorRows: EntityMenuRow[] = [
  {
    id: "reposition-connector",
    group: "structure",
    kinds: ["connector"],
    render: (ctx, target) => {
      if (!ctx.canManageStructure) return [];
      if (target.sectionId) {
        const sectionId = target.sectionId;
        const connectorId = target.anchor ?? "";
        return [
          {
            label: "Reposition Connector",
            onSelect: () => ctx.setSelectedSectionConnector({ sectionId, connectorId }),
          },
        ];
      }
      const nodeId = target.anchor;
      const connectorId = target.ids[0];
      if (!(nodeId && connectorId)) return [];
      return [
        {
          label: "Reposition Connector",
          onSelect: () => ctx.setSelectedConnector({ nodeId, connectorId }),
        },
      ];
    },
  },
];

const shareRow: EntityMenuRow = {
  id: "share",
  group: "share",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    if (!ctx.canManageLinks) return [];
    const { multiple, noun } = selectionSummary(target.ids);
    // Sharing is a link owner's right, and only a subset with two or more cards is
    // worth a link; the dialog opens on the selection scope.
    return [
      {
        label: multiple ? `Share ${noun}\u2026` : "Share\u2026",
        onSelect: () => ctx.requestShare(multiple ? "selection" : "card"),
      },
    ];
  },
};

const deleteRow: EntityMenuRow = {
  id: "delete",
  group: "danger",
  kinds: ["card", "portal", "section", "edge", "connector"],
  render: (ctx, target) => {
    if (target.kind === "section") {
      const sectionId = target.ids[0];
      if (!(ctx.canManageStructure && sectionId)) return [];
      return [
        {
          label: "Delete section",
          danger: true,
          onSelect: () => {
            ctx.workspace.deleteSection(sectionId);
            ctx.selectSection(null);
            ctx.setSelectedSectionConnector(null);
          },
        },
      ];
    }
    if (target.kind === "edge") {
      const edgeId = target.ids[0];
      if (!(ctx.canEditLayout && edgeId)) return [];
      return [
        {
          label: "Delete link",
          danger: true,
          onSelect: () => ctx.workspace.removeEdge(edgeId),
        },
      ];
    }
    if (target.kind === "connector") {
      if (!ctx.canManageStructure) return [];
      const { sectionId, anchor } = target;
      const connectorId = target.ids[0];
      if (!connectorId) return [];
      return [
        {
          label: "Delete connector",
          danger: true,
          onSelect: () => {
            if (sectionId) {
              ctx.workspace.removeSectionConnector(sectionId, connectorId);
              ctx.setSelectedSectionConnector(null);
              return;
            }
            if (!anchor) return;
            ctx.workspace.removeConnector(anchor, connectorId);
            ctx.setSelectedConnector(null);
          },
        },
      ];
    }
    if (!ctx.canManageTrash) return [];
    const { ids, multiple } = selectionSummary(target.ids);
    return [
      {
        // Destructive entries stay last.
        label: multiple ? "Delete cards" : target.kind === "card" ? "Delete card" : "Delete",
        danger: true,
        onSelect: () => {
          if (multiple) {
            ctx.trashSelected();
            return;
          }
          for (const id of ids) ctx.workspace.trashCard(id);
          ctx.setSelectedNodeIds([]);
          ctx.setSelectedConnector(null);
        },
      },
    ];
  },
};

export const ENTITY_MENU_ROWS: readonly EntityMenuRow[] = [
  colourRow,
  appearanceRow,
  ...canvasRows,
  openPortalRow,
  duplicateRow,
  sectionFromRow,
  connectorRow,
  ...sectionRows,
  ...edgeRows,
  arrangeRow,
  positionRow,
  moveBoardRow,
  removeRow,
  ...connectorRows,
  shareRow,
  deleteRow,
];

/**
 * The rows that serve *every* kind asked for, in group order.
 *
 * A multi-selection intersects rather than unions: offering to delete four cards and a
 * link would be offering something that cannot be done to both.
 */
export function menuRowsFor(kinds: readonly EntityKind[]): EntityMenuRow[] {
  const wanted = new Set(kinds);
  if (wanted.size === 0) return [];
  const order = (group: MenuGroup) => GROUP_ORDER.indexOf(group);
  return ENTITY_MENU_ROWS.filter((row) => [...wanted].every((kind) => row.kinds.includes(kind)))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => order(a.row.group) - order(b.row.group) || a.index - b.index)
    .map((entry) => entry.row);
}

/** What a right-click landed on, or null when it landed on nothing an entity owns. */
export function resolveMenuTarget(ctx: BoardMenuContext): MenuTarget | null {
  const menu = ctx.menu;
  if (menu.kind === "canvas") return { kind: "canvas", ids: [] };
  if (menu.kind === "section") {
    return menu.sectionId ? { kind: "section", ids: [menu.sectionId] } : null;
  }
  if (menu.kind === "edge") {
    return menu.edgeId ? { kind: "edge", ids: [menu.edgeId] } : null;
  }
  if (menu.kind === "connector") {
    if (!menu.connectorId) return null;
    if (menu.sectionId) {
      return {
        kind: "connector",
        ids: [menu.connectorId],
        anchor: menu.connectorId,
        sectionId: menu.sectionId,
      };
    }
    if (!menu.nodeId) return null;
    return { kind: "connector", ids: [menu.connectorId], anchor: menu.nodeId };
  }
  const nodeId = menu.nodeId;
  if (!nodeId) return null;
  const summary = selectionSummary(ctx.selectedNodeIds);
  const inSelection = summary.multiple && summary.ids.includes(nodeId);
  return {
    kind: portalTargetId(ctx.cardsById.get(nodeId)) ? "portal" : "card",
    ids: inSelection ? summary.ids : [nodeId],
    anchor: nodeId,
  };
}

/** The whole menu for whatever was right-clicked. */
export function buildEntityMenu(ctx: BoardMenuContext): ContextMenuItem[] {
  const target = resolveMenuTarget(ctx);
  if (!target) return [];
  const items: ContextMenuItem[] = [];
  for (const row of menuRowsFor([target.kind])) {
    items.push(...row.render(ctx, target));
  }
  return items;
}

/** The palette quick-picks, with the swatch the target already wears marked. */
function swatches(
  ctx: BoardMenuContext,
  current: string | undefined,
  onPick: (swatch: string | null) => void,
): ContextMenuItem[] {
  return [
    {
      label: "Default",
      swatchSelected: current === undefined,
      onSelect: () => onPick(null),
    },
    ...ctx.palette.map((swatch) => ({
      label: swatch.name,
      swatch: { light: swatch.light, dark: swatch.dark },
      swatchSelected: current === swatch.id,
      onSelect: () => onPick(swatch.id),
    })),
  ];
}
