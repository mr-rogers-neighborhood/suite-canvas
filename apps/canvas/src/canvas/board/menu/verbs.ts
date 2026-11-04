import { portalTargetId } from "../../../cards/portal";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import type { EntityKind } from "../../../entities/kind";
import { viewsEnabled } from "../../../views/availability";
import { selectionSummary } from "../../interactions/multiSelect";
import { type MenuTarget, resolveMenuTarget } from "./target";
import type { BoardMenuContext } from "./types";

export type { MenuTarget, SelectionGroups } from "./target";
export { resolveMenuTarget } from "./target";

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
export type MenuGroup =
  | "edit"
  | "arrange"
  | "appearance"
  | "contents"
  | "create"
  | "transfer"
  | "share"
  | "danger";

/**
 * Reading order: what you do to a thing, how it looks, where it sits, what it holds, what you make,
 * where it moves, who sees it, and what removes it.
 *
 * Edit is first because Cut, Copy and Paste are the verbs a reader reaches for without looking, and
 * colour follows because it is the quickest change on the list: everything about how a thing reads
 * sits together, before the commands that move it. Creations belong to the canvas menu and so sit
 * below anything that acts on a selected thing.
 */
const GROUP_ORDER: readonly MenuGroup[] = [
  "edit",
  "appearance",
  "arrange",
  "contents",
  "create",
  "transfer",
  "share",
  "danger",
];

/**
 * One thing that can be done to something, described once.
 *
 * The table is the menu's, the palette's and the keyboard's: `render` produces the items a menu shows
 * (labels that count, a submenu, an inline strip), `verbLabel` reads the words back for a surface that is
 * not a menu, and `shortcut` is what the palette prints beside a verb a key also runs. A verb declares the
 * kinds it serves, so "cannot be done to a link" is a missing verb rather than an `if` in three places.
 */
export interface EntityVerb {
  id: string;
  group: MenuGroup;
  /** The kinds this row can serve. It shows only when it serves the whole target. */
  kinds: readonly EntityKind[];
  render: (ctx: BoardMenuContext, target: MenuTarget) => ContextMenuItem[];
  /** The keys that run it, for the palette to print. Absent for a verb with no binding. */
  shortcut?: string;
}

const at = (ctx: BoardMenuContext) => ({ x: ctx.menu.x, y: ctx.menu.y });

const colourRow: EntityVerb = {
  id: "colour",
  group: "appearance",
  kinds: ["card", "portal", "section", "edge"],
  render: (ctx, target) => {
    if (!ctx.canEditLayout) return [];
    // One strip for every kind: a section's colour is a palette id now, so the six-name list it
    // used to draw here was a second vocabulary for the same field.
    return [
      {
        label: "Colour",
        swatches: swatches(ctx, currentSwatch(ctx, target), (swatch) =>
          // The target's groups, not the store's selection: a press outside the selection
          // colours what it landed on, which is the rule every other verb follows.
          ctx.setSelectionColour(swatch, {
            nodeIds: target.idsByKind.cards,
            edgeIds: target.idsByKind.edges,
            sectionIds: target.idsByKind.sections,
          }),
        ),
      },
    ];
  },
};

/** The colour in force, read from what the press landed on so the strip can mark it. */
function currentSwatch(ctx: BoardMenuContext, target: MenuTarget): string | undefined {
  const id = target.anchor ?? target.ids[0];
  if (id === undefined) return undefined;
  if (target.kind === "edge") return ctx.workspace.getEdge(id)?.style?.swatch;
  if (target.kind === "section") return ctx.workspace.getSection(id)?.color;
  return ctx.cardsById.get(id)?.style?.swatch;
}

const appearanceRow: EntityVerb = {
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

const canvasRows: EntityVerb[] = [
  {
    id: "new-view",
    group: "create",
    kinds: ["canvas"],
    render: (ctx) => {
      // A view is workspace configuration as well as a card, so both capabilities are required:
      // a row that made a card nobody could point at a view would be a trap. And while the views
      // surfaces are shut there is nowhere for the card to point, so the row goes too.
      if (!viewsEnabled || !ctx.canCreateContent || !ctx.canManageSchema) return [];
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "New view", onSelect: () => ctx.createViewAt(position) }];
    },
  },
  {
    id: "view-from-selection",
    group: "create",
    kinds: ["card", "canvas"],
    render: (ctx) => {
      if (!viewsEnabled || !ctx.canManageSchema) return [];
      // The selection is already a context, so this is the shortest path from "what is this?" to a view
      // that answers it: no words to type, no chips to press.
      return [
        {
          label:
            ctx.selectedNodeIds.length > 1 ? "New view of these cards" : "New view of this card",
          onSelect: () => ctx.createViewFromSelection(),
        },
      ];
    },
  },
  {
    id: "new-media",
    group: "create",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      // One picker, two targets: this row adds a block in a card at the click, and the `/` menu adds one at a
      // caret. The kind is chosen in the same table either way, so the two cannot drift.
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "New media…", onSelect: () => ctx.createMediaAt(position) }];
    },
  },
  {
    id: "new-card",
    group: "create",
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
    group: "create",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "New sketch", onSelect: () => ctx.createWhiteboardAt(position) }];
    },
  },
  {
    id: "new-section",
    group: "create",
    kinds: ["canvas"],
    render: (ctx) => {
      if (!ctx.canCreateContent) return [];
      const position = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "New section", onSelect: () => ctx.createSectionAt(position) }];
    },
  },
  {
    id: "new-portal",
    group: "create",
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

const openPortalRow: EntityVerb = {
  id: "open-portal",
  group: "contents",
  kinds: ["portal"],
  render: (ctx, target) => {
    const nodeId = target.anchor;
    const boardId = nodeId ? portalTargetId(ctx.cardsById.get(nodeId)) : null;
    if (!(nodeId && boardId)) return [];
    return [{ label: "Open portal", onSelect: () => ctx.enterPortal(nodeId, boardId) }];
  },
};

/**
 * Cut, Copy and Paste.
 *
 * The canvas suppresses the native menu, so these three had no way in at all: a reader who expected
 * the browser's menu found nothing where the verbs should be. They sit first in the menu because that
 * is where a reader looks for them, and they are the same verbs the keyboard runs.
 */
const clipboardRows: EntityVerb[] = [
  {
    id: "cut",
    group: "edit",
    kinds: ["card", "portal", "section", "edge"],
    shortcut: "\u2318X",
    render: (ctx, target) => {
      if (!ctx.canEditLayout || target.ids.length === 0) return [];
      return [{ label: "Cut", onSelect: () => ctx.cutSelection() }];
    },
  },
  {
    id: "copy",
    group: "edit",
    kinds: ["card", "portal", "section", "edge"],
    shortcut: "\u2318C",
    render: (ctx, target) => {
      if (target.ids.length === 0) return [];
      return [{ label: "Copy", onSelect: () => ctx.copySelection() }];
    },
  },
  {
    id: "paste",
    group: "edit",
    kinds: ["canvas", "card", "portal", "section", "edge"],
    shortcut: "\u2318V",
    render: (ctx) => {
      if (!ctx.canCreateContent || !ctx.clipboardReady) return [];
      const point = ctx.menu.flowPosition ?? { x: 0, y: 0 };
      return [{ label: "Paste", onSelect: () => ctx.pasteAt(point) }];
    },
  },
];

const duplicateRow: EntityVerb = {
  id: "duplicate",
  group: "edit",
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

const sectionFromRow: EntityVerb = {
  id: "section-from",
  group: "arrange",
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

const connectorRow: EntityVerb = {
  id: "add-connector",
  group: "arrange",
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

const arrangeRow: EntityVerb = {
  id: "arrange",
  group: "arrange",
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

const positionRow: EntityVerb = {
  id: "position",
  group: "arrange",
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

const moveBoardRow: EntityVerb = {
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

const alsoPlaceBoardRow: EntityVerb = {
  id: "also-place-board",
  group: "transfer",
  kinds: ["card", "portal"],
  render: (ctx, target) => {
    const nodeId = target.anchor;
    const boards = ctx.otherBoards(ctx.activeBoardId);
    if (!(ctx.canEditLayout && nodeId && boards.length > 0)) return [];
    return [
      {
        // Not a move: the card stays here and appears there too. One object, so a
        // change on either board is the same change.
        label: "Also place on board",
        items: boards.map((board) => ({
          label: board.name,
          onSelect: () => ctx.alsoPlaceCardOnBoard(nodeId, board.id),
        })),
      },
    ];
  },
};

const removeRow: EntityVerb = {
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

const sectionRows: EntityVerb[] = [
  {
    id: "rename-section",
    group: "edit",
    kinds: ["section"],
    render: (ctx, target) => {
      const sectionId = target.ids[0];
      if (!(ctx.canEditLayout && sectionId)) return [];
      return [{ label: "Rename section", onSelect: () => ctx.setEditingSection(sectionId) }];
    },
  },
  {
    id: "select-members",
    group: "contents",
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
  {
    id: "shrink-section-to-fit",
    group: "arrange",
    kinds: ["section"],
    render: (ctx, target) => {
      const sectionId = target.ids[0];
      if (!(ctx.canEditLayout && sectionId)) return [];
      const section = ctx.workspace.getSection?.(sectionId);
      const isShrinkToFit = section?.shrinkToFit !== false;
      return [
        {
          label: "Shrink to fit",
          checked: isShrinkToFit,
          onSelect: () => ctx.toggleSectionShrinkToFit(sectionId),
        },
      ];
    },
  },
];

const edgeRows: EntityVerb[] = [
  {
    id: "edge-description",
    group: "appearance",
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
    group: "arrange",
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
    group: "appearance",
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

const connectorRows: EntityVerb[] = [
  {
    id: "reposition-connector",
    group: "arrange",
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

const shareRow: EntityVerb = {
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

const deleteRow: EntityVerb = {
  id: "delete",
  group: "danger",
  shortcut: "\u232b",
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

export const ENTITY_VERBS: readonly EntityVerb[] = [
  ...clipboardRows,
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
  alsoPlaceBoardRow,
  removeRow,
  ...connectorRows,
  shareRow,
  deleteRow,
];

/**
 * What a verb says it does, for a surface that is not the menu.
 *
 * The label already depends on the target — `Duplicate 4 cards` is one row, not four — so it is read from
 * the row's own first item rather than written a second time beside it. A verb that renders nothing for a
 * target has no label, which is how a surface knows not to offer it.
 */
export function verbLabel(
  ctx: BoardMenuContext,
  target: MenuTarget,
  verb: EntityVerb,
): string | null {
  return verb.render(ctx, target)[0]?.label ?? null;
}

/**
 * The rows that serve *every* kind asked for, in group order.
 *
 * A multi-selection intersects rather than unions: offering to delete four cards and a
 * link would be offering something that cannot be done to both.
 */
export function verbsFor(kinds: readonly EntityKind[]): EntityVerb[] {
  const wanted = new Set(kinds);
  if (wanted.size === 0) return [];
  const order = (group: MenuGroup) => GROUP_ORDER.indexOf(group);
  return ENTITY_VERBS.filter((row) => [...wanted].every((kind) => row.kinds.includes(kind)))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => order(a.row.group) - order(b.row.group) || a.index - b.index)
    .map((entry) => entry.row);
}

/** The whole menu for whatever was right-clicked. */
export function buildVerbMenu(ctx: BoardMenuContext): ContextMenuItem[] {
  const target = resolveMenuTarget(ctx);
  if (!target) return [];
  const items: ContextMenuItem[] = [];
  for (const row of verbsFor([target.kind])) {
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
