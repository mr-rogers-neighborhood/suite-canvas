import type { Card, CardType, StyleShape } from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cardIcon as resolveCardIcon } from "../canvas/entityIcon";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/interactions/multiSelect";
import { NodeConnectors } from "../canvas/NodeConnectors";
import { paintSurface, useSurfacePaint } from "../canvas/surfaceContext";
import { isShapedSurface, shapeInset } from "../canvas/surfacePaint";
import type { PresenceUser } from "../collab/presence";
import { countRender } from "../dev/perf";
import { ContextMenu, type ContextMenuItem } from "../dialogs/ContextMenu";
import { IconGlyph } from "../icons/IconGlyph";
import { PeerNameTag } from "../presence/PeerNameTag";
import { PresenceAvatars } from "../presence/PresenceAvatars";
import type { InteractionMode } from "../store/interactionMode";
import { CardBodyEditor, CardTitleEditor } from "./CardBodyEditor";
import type { CardMeta } from "./cardMeta";

/** Everyone dragging one connector, plus where the first of them is holding it. */
export interface ConnectorPeerState {
  users: PresenceUser[];
  position: { x: number; y: number } | null;
}

export type EditingField = "title" | "body";

export interface NodeCardProps {
  card: Card;
  /** Primary type, resolved by the board; drives the glyph and its label. */
  type: CardType;
  /** Read-only property and tag chips for the card face. */
  meta: CardMeta;
  /** Whether the card's frontmatter is expanded. Local UI state only. */
  metaExpanded?: boolean;
  /**
   * Reduced to the header line. Reader state: the document is unchanged, and the
   * reference count in the header is what the fold hides.
   */
  collapsed?: boolean;
  /** Folds or unfolds the card. Absent leaves the fold off the face entirely. */
  onToggleCollapsed?: (() => void) | undefined;
  /** Toggles the frontmatter area. */
  onToggleMeta?: () => void;
  /**
   * The icon this card draws: its own, else its type's, else nothing. `null`
   * means "draw none" — the card hid it — and `undefined` with no type icon means
   * fall back to the glyph.
   */
  cardIcon?: string | null;
  /** Opens the type menu under the glyph, which is how a card changes type. */
  onOpenTypeMenu?: ((anchor: DOMRect) => void) | undefined;
  /** Card document that owns the title and body rich text. */
  cardDoc: LoroDoc;
  /** Body rich-text container. */
  contentId: ContainerID;
  /** Title rich-text container (a single paragraph). */
  titleId: ContainerID;
  /** Shared cursor presence for this workspace. */
  cursorStore: CursorEphemeralStore | null;
  /** Local user, for cursor presence. */
  localUser: { name: string; color: string } | null;
  boardId: string;
  /** Resized dimensions in flow units; omitted means the card's natural size. */
  width?: number | null;
  height?: number | null;
  selected?: boolean;
  /** Off the active lens; painted back so the view's result reads first. */
  dim?: boolean;
  /** Which editor this card is focused in, if any. */
  editing?: EditingField | null;
  presence?: PresenceUser[];
  draggingPeers?: PresenceUser[];
  /**
   * Whether the dragging peer's name tag belongs on this card. A multi-card
   * drag carries its chip on the group outline instead.
   */
  showDragLabel?: boolean;
  selectingPeers?: PresenceUser[];
  /** Peers currently resizing this card. */
  resizingPeers?: PresenceUser[];
  movingConnectorPeers?: Record<string, ConnectorPeerState>;
  selectingConnectorPeers?: Record<string, PresenceUser[]>;
  onConnectorMoveStart?: (connectorId: string) => void;
  onConnectorMove?: (connectorId: string, position: { x: number; y: number }) => void;
  onConnectorMoveFinished?: () => void;
  selectedConnectorId?: string | null;
  onConnectorSelect?: (connectorId: string, event?: React.MouseEvent) => void;
  onConnectorMoveEnd?: (connectorId: string, position: { x: number; y: number }) => void;
  onConnectorContextMenu?: (event: React.MouseEvent, connectorId: string) => void;
  onStartEditing?: (field: EditingField) => void;
  onEditEnd?: () => void;
  onRemoveFromBoard?: () => void;
  /** Mentions, property links and arrows touching this card; 0 hides the chip. */
  linkCount?: number;
  /** Opens the inspector for this card. */
  onOpenInfo?: () => void;
  /**
   * Double-clicking the card presents it, when the card is a tour — the owner
   * answers that, because only it can read the body for step blocks, and it must
   * answer at click time so a step typed a second ago counts.
   *
   * Returns true when it took the gesture; false leaves the double-click to
   * editing, which is what every non-tour card does
   * (ADR-0064 §11).
   */
  onDoubleClickPresent?: () => boolean;
  /**
   * Whether this card is a tour, asked at render time.
   *
   * A click on a card's text now starts editing, and that must not happen to a tour: its
   * click means "show me this". The click answers from this flag and leaves *playing* to
   * `onDoubleClickPresent`, which is still asked at the moment of the double-click so a
   * step typed a second ago already counts.
   */
  presentable?: boolean;
  /**
   * What a press on the card means. `inspect` opens the inspector beside the caret,
   * `quiet` only puts the caret in, `locked` makes the card inert so the canvas can be
   * dragged without moving or editing anything. The explicit doors on the card — the
   * link count, the context menu's Card info — keep their own meaning in every mode.
   */
  interactionMode?: InteractionMode;
  /** Double-clicking the card opens the full-canvas focus surface. */
  onFocusCard?: () => void;
  onTrash?: () => void;
  /** Copies the card; a session that may not create content never passes it. */
  onDuplicate?: () => void;
  /** Boards the card may move to, excluding the one it is on now. */
  moveTargets?: Array<{ id: string; name: string }>;
  /** Every type this card could become, for the "Change type" submenu. */
  typeTargets?: Array<{ id: string; name: string }>;
  onSetType?: ((typeId: string) => void) | undefined;
  onMoveToBoard?: (boardId: string) => void;
  /** Title and body editing; the card editor role owns this. */
  canEditContent?: boolean;
  /** Placement-level actions such as removing the card from the board. */
  canEditLayout?: boolean;
  /** Destructive actions such as trashing the card. */
  canManageTrash?: boolean;
  /** Shorthand for a viewer: no menu and no editing gesture at all. */
  readOnly?: boolean;
  /** A chaining mode reveals the connector dots on unselected cards too. */
  chaining?: boolean;
  armed?: boolean;
  /** The armed end of a link chain, when it is one of this card's dots. */
  armedConnectorId?: string | null;
  /** A link is being dragged, so this card's dots must show even unselected. */
  draftActive?: boolean;
}

/**
 * The paint record as a DOM style. A custom property is only a custom property
 * with its `--` prefix, and `surfacePaintVars` names its keys without one, so
 * spreading the record raw would reach CSS as an unknown declaration.
 */
function paintStyle(paint: Record<string, string>): CSSProperties {
  return paint as CSSProperties;
}

export function NodeCard({
  card,
  type,
  meta,
  onOpenTypeMenu,
  metaExpanded = false,
  collapsed = false,
  onToggleCollapsed,
  onToggleMeta,
  cardDoc,
  contentId,
  titleId,
  cursorStore,
  localUser,
  boardId,
  width = null,
  height = null,
  selected = false,
  dim = false,
  editing = null,
  presence = [],
  draggingPeers = [],
  showDragLabel = true,
  selectingPeers = [],
  resizingPeers = [],
  movingConnectorPeers = {},
  selectingConnectorPeers = {},
  onConnectorMoveStart,
  onConnectorMove,
  onConnectorMoveFinished,
  selectedConnectorId = null,
  onConnectorSelect,
  onConnectorMoveEnd,
  onConnectorContextMenu,
  onStartEditing,
  onDoubleClickPresent,
  presentable = false,
  interactionMode = "inspect",
  onEditEnd,
  onRemoveFromBoard,
  linkCount = 0,
  onOpenInfo,
  onFocusCard,
  onTrash,
  onDuplicate,
  moveTargets = [],
  typeTargets = [],
  onSetType,
  onMoveToBoard,
  canEditContent,
  canEditLayout,
  canManageTrash,
  readOnly = false,
  chaining = false,
  armed = false,
  armedConnectorId = null,
  draftActive = false,
}: NodeCardProps) {
  // One decision, in one file: `cardIcon` walks style, then the card's own icon, then
  // the type's, and a type with no icon keeps the glyph it has always had.
  const resolved = card ? resolveCardIcon(card, type.icon) : null;
  const glyphIcon: string | null | undefined = resolved ?? undefined;
  const editContent = canEditContent ?? !readOnly;
  const editLayout = canEditLayout ?? !readOnly;
  const canTrash = canManageTrash ?? !readOnly;
  const hasMenu = Boolean(onDuplicate || onMoveToBoard) || editContent || editLayout || canTrash;
  countRender("card");

  // Blur can fire transiently while the card re-renders (presence updates, CRDT
  // sync). Only leave edit mode when focus does not come back.
  const blurTimeout = useRef<number | null>(null);
  // A second card can take editing before this card's blur timer fires. The
  // timer belongs to the field that lost focus, not to the global editing state.
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  // Stable so the menu's Escape listener is not torn down by every presence tick.
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(
    () => () => {
      if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    },
    [],
  );

  const keepFocusAlive = () => {
    if (blurTimeout.current !== null) {
      window.clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
  };

  const releaseFocusSoon = () => {
    if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    const fieldAtBlur = editingRef.current;
    blurTimeout.current = window.setTimeout(() => {
      blurTimeout.current = null;
      if (editingRef.current !== fieldAtBlur) return;
      onEditEnd?.();
    }, 120);
  };

  /**
   * A click on the text is one gesture with two halves: the caret goes where it was
   * clicked, and the inspector opens beside it. The edit used to stop the click from
   * reaching the card, so the second half stopped happening and the panel only appeared
   * from a press on the card's frame.
   */
  const locked = interactionMode === "locked";
  const editAndInspect = (field: EditingField) => {
    if (locked) return;
    onStartEditing?.(field);
    if (interactionMode === "inspect") onOpenInfo?.();
  };

  const hasMeta = meta.properties.length > 0 || meta.tags.length > 0;
  const metaCount = meta.properties.length + meta.tags.length;

  const draggingPeer = draggingPeers[0];
  const focusedBy = presence[0];
  const selectingPeer = selectingPeers[0];
  const resizingPeer = resizingPeers[0];
  const activePeer = draggingPeers[0] ?? resizingPeers[0] ?? null;

  // Peer presence takes visual priority over local selection so collaborators
  // always see where everyone else is: dragging > editing > selecting.
  const presenceStyle: CSSProperties = draggingPeer
    ? { borderColor: draggingPeer.color, boxShadow: `0 0 0 3px ${draggingPeer.color}55` }
    : focusedBy
      ? { borderColor: focusedBy.color, boxShadow: `0 0 0 2px ${focusedBy.color}33` }
      : resizingPeer
        ? { borderColor: resizingPeer.color, boxShadow: `0 0 0 2px ${resizingPeer.color}44` }
        : selectingPeer
          ? { boxShadow: `0 0 0 2px ${selectingPeer.color}66` }
          : {};

  /**
   * The card's paint: its type's style, then its own over that, then the contrast
   * floor. Those two levels are the whole ladder. A card nothing names passes
   * nothing here, so the default chrome is unchanged.
   */
  const surfacePaint = useSurfacePaint();
  const cardPaint = useMemo(
    () => paintSurface(card.style, type.style, { surface: "card" }, surfacePaint),
    [card.style, type.style, surfacePaint],
  );
  const { paint, corrections } = cardPaint;
  const painted = Object.keys(paint).length > 0;
  /**
   * The silhouette, when it is not the card's own box.
   *
   * A shaped card cannot wear the box's chrome: its border, its shadow and its selection
   * ring are all rectangles, and every one of them shows outside a diamond. The shape is
   * the frame instead, so the box goes bare and the feedback follows the paint (ADR-0051
   * §7, ADR-0060 §5).
   */
  const shape = isShapedSurface(paint["--paint-shape"] as StyleShape | undefined)
    ? (paint["--paint-shape"] as StyleShape)
    : null;
  const inset = shapeInset(shape, {
    width: width ?? DEFAULT_CARD_WIDTH,
    height: height ?? DEFAULT_CARD_HEIGHT,
  });

  const cardClass = [
    "node-card relative flex flex-col rounded-md border border-[var(--hairline)]",
    painted ? "is-painted" : "",
    selected && !draggingPeer && !focusedBy
      ? shape
        ? "is-selected border-transparent"
        : "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-500/30"
      : "",
    // A dimmed card keeps its hover and selection affordances but recedes, so
    // the lens result reads first without losing the spatial context around it.
    dim && !selected ? "is-off-lens" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const menuItems: ContextMenuItem[] = [
    { label: "Card info", onSelect: () => onOpenInfo?.() },
    ...(onSetType && typeTargets.length > 1
      ? [
          {
            label: "Change type",
            items: typeTargets.map((entry) => ({
              label: entry.name,
              onSelect: () => onSetType(entry.id),
            })),
          },
        ]
      : []),
    ...(hasMeta && onToggleMeta
      ? [
          {
            label: `${metaExpanded ? "Hide" : "Show"} details`,
            onSelect: onToggleMeta,
          },
        ]
      : []),
    ...(onDuplicate ? [{ label: "Duplicate", onSelect: () => onDuplicate() }] : []),
    ...(onMoveToBoard && moveTargets.length > 0
      ? [
          {
            label: "Move to board",
            items: moveTargets.map((board) => ({
              label: board.name,
              onSelect: () => onMoveToBoard(board.id),
            })),
          },
        ]
      : []),
    ...(onFocusCard ? [{ label: "Open in focus", onSelect: () => onFocusCard() }] : []),
    ...(editContent
      ? [
          { label: "Edit title", onSelect: () => onStartEditing?.("title") },
          { label: "Edit body", onSelect: () => onStartEditing?.("body") },
        ]
      : []),
    ...(editLayout ? [{ label: "Remove from board", onSelect: () => onRemoveFromBoard?.() }] : []),
    ...(canTrash ? [{ label: "Delete card", danger: true, onSelect: () => onTrash?.() }] : []),
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a canvas node; keyboard open is handled by Enter on the selected node.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the card is a canvas node; keyboard open is handled by Enter on the selected node.
    <div
      data-testid="node-card"
      data-connector-surface="true"
      data-node-id={card.id}
      data-dragging={draggingPeer ? "true" : undefined}
      data-selected-by-peer={selectingPeer ? "true" : undefined}
      data-resizing-by-peer={resizingPeer ? "true" : undefined}
      data-board-id={boardId}
      data-shape={shape ?? undefined}
      // A rule the floor had to correct says so on the card instead of
      // pretending the pair was legible (ADR-0046 §6).
      data-contrast-corrected={corrections.length > 0 ? "true" : undefined}
      className={cardClass}
      // The default box comes from the shared constants, so an unstored card
      // measures exactly what the canvas, the section fit and the drop offset
      // assume. A resized card overrides both from its placement.
      style={
        {
          ...presenceStyle,
          ...paintStyle(paint),
          width: width ?? DEFAULT_CARD_WIDTH,
          height: height ?? DEFAULT_CARD_HEIGHT,
          // Where the silhouette is not the box, the chrome inside it has to be pulled
          // away from corners the paint does not have. Published as variables so the
          // stylesheet owns the spacing and the numbers stay in one table.
          ...(shape
            ? {
                "--shape-inset-x": `${inset.x}px`,
                "--shape-inset-y": `${inset.y}px`,
                "--shape-title-inset-x": `${inset.titleX}px`,
              }
            : {}),
        } as CSSProperties
      }
      onPointerDown={(event) => {
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        if (editing || locked) return;
        // Multi-select owns modifier clicks; they must not open the inspector.
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        const origin = pointerOrigin.current;
        const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) : 0;
        // A drag moves the card; a click without movement opens its info, unless the
        // reader has asked the inspector to stay shut.
        if (moved > 4) return;
        if (interactionMode !== "inspect") return;
        onOpenInfo?.();
      }}
      onDoubleClick={(event) => {
        // Editing is one click now, so the double-click is free for the one gesture
        // that means "show me this": playing a tour.
        if (locked) return;
        if (onDoubleClickPresent?.() !== true) return;
        event.stopPropagation();
      }}
    >
      {/* The header takes its top corners from the card, not from a fixed radius:
          see the `.card-header` rule, which is why no `rounded-*` utility is here. */}
      <div className="card-header flex shrink-0 items-center gap-1.5 px-2 py-2">
        {onToggleCollapsed ? (
          <button
            type="button"
            aria-label={collapsed ? "Expand card" : "Collapse card"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand card" : "Collapse card"}
            data-testid="card-fold"
            className="card-meta-toggle nodrag shrink-0 rounded px-0.5 text-[10px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapsed();
            }}
          >
            <span aria-hidden="true">{collapsed ? "\u25b8" : "\u25be"}</span>
          </button>
        ) : null}

        {hasMeta && !collapsed ? (
          <button
            type="button"
            aria-label={
              metaExpanded
                ? "Hide details"
                : `Show details: ${metaCount} ${metaCount === 1 ? "property" : "properties"}`
            }
            aria-expanded={metaExpanded}
            title={metaExpanded ? "Hide properties" : `Show properties (${metaCount})`}
            data-testid="card-meta-toggle"
            className="card-meta-toggle nodrag shrink-0 rounded px-0.5 text-[10px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              onToggleMeta?.();
            }}
          >
            <span aria-hidden="true">{metaExpanded ? "\u25be" : "\u25b8"}</span>
            {metaExpanded ? null : <span className="ml-0.5">{metaCount}</span>}
          </button>
        ) : null}

        {glyphIcon === null ? null : (
          <button
            type="button"
            aria-label={`Card type: ${type.name}`}
            title={glyphIcon === undefined ? type.name : `${type.name} · change type`}
            aria-haspopup="menu"
            data-testid="card-type"
            className="card-type-glyph nodrag shrink-0 rounded px-0.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              onOpenTypeMenu?.(event.currentTarget.getBoundingClientRect());
            }}
          >
            {glyphIcon === undefined ? (
              type.glyph
            ) : (
              <IconGlyph icon={glyphIcon} size={13} className="inline-block" />
            )}
          </button>
        )}

        <div className="card-title relative min-w-0 flex-1">
          {editing === "title" || !editContent || locked ? null : (
            <button
              type="button"
              aria-label="Edit card title"
              className="absolute inset-0 z-10 cursor-text"
              // One click, pointer or keyboard. Double-click-to-edit made the common
              // action the harder one, and the click that did nothing was still
              // consuming the gesture: the card looked inert until it was pressed twice.
              onClick={(event) => {
                event.stopPropagation();
                editAndInspect("title");
              }}
            />
          )}
          <CardTitleEditor
            cardDoc={cardDoc}
            titleId={titleId}
            cursorStore={cursorStore}
            localUser={localUser}
            editable={editing === "title"}
            className={editing === "title" ? "nodrag nopan" : undefined}
            onFocus={() => {
              keepFocusAlive();
              onStartEditing?.("title");
            }}
            onBlur={releaseFocusSoon}
            onCommit={onEditEnd}
          />
        </div>

        {linkCount > 0 ? (
          <button
            type="button"
            aria-label={`${linkCount} reference${linkCount === 1 ? "" : "s"}`}
            title={`${linkCount} reference${linkCount === 1 ? "" : "s"}`}
            data-testid="card-link-count"
            className="nodrag shrink-0 rounded px-0.5 text-[10px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              onOpenInfo?.();
            }}
          >
            {"\u2194"} {linkCount}
          </button>
        ) : null}

        {presence.length > 0 || draggingPeers.length > 0 || selectingPeers.length > 0 ? (
          <PresenceAvatars
            users={
              presence.length > 0
                ? presence
                : draggingPeers.length > 0
                  ? draggingPeers
                  : selectingPeers
            }
          />
        ) : null}

        {activePeer && (activePeer !== draggingPeer || showDragLabel) ? (
          <PeerNameTag user={activePeer} />
        ) : null}

        {hasMenu ? (
          <button
            type="button"
            aria-label="Card actions"
            data-testid="card-menu"
            className="nodrag shrink-0 rounded px-1 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.right - 4, y: rect.bottom + 4 });
            }}
          >
            {"\u22ef"}
          </button>
        ) : null}
      </div>

      {hasMeta && metaExpanded && !collapsed ? (
        <div className="card-meta shrink-0 px-2.5 pb-1.5" data-testid="card-meta">
          {meta.properties.map((property) => (
            <button
              key={property.fieldId}
              type="button"
              className="card-meta-row nodrag"
              title={`${property.label}: ${property.value}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenInfo?.();
              }}
            >
              <span className="card-meta-label">{property.label}</span>
              <span className="card-meta-value">{property.value}</span>
            </button>
          ))}
          {meta.tags.length > 0 ? (
            <div className="card-meta-tags">
              {meta.tags.map((name) => (
                <span key={name} className="card-meta-tag">
                  #{name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {collapsed ? null : (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the nested ProseMirror editor owns keyboard interaction */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the title overlay and the Inspector's Edit action are the keyboard path into this editor */}
          <div
            className={`card-body-scroll min-h-0 flex-1 overflow-auto ${
              editing === "body" ? "nodrag" : ""
            }`}
            data-testid="card-body"
            onClick={(event) => {
              if (!editContent || editing === "body") return;
              // A tour's click is not an edit: the card means "show me this", and playing
              // it stays on the double-click so a stray click cannot start a presentation.
              if (presentable) return;
              // A drag out of the body moves the card, so only a press that stayed put
              // counts as "edit this". Same threshold as the card's own click handler.
              const origin = pointerOrigin.current;
              if (origin) {
                const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
                if (moved > 4) return;
              }
              event.stopPropagation();
              editAndInspect("body");
            }}
          >
            <CardBodyEditor
              cardId={card.id}
              cardDoc={cardDoc}
              contentId={contentId}
              cursorStore={cursorStore}
              localUser={localUser}
              editable={editContent && editing === "body"}
              readOnly={!editContent}
              onFocus={keepFocusAlive}
              onBlur={releaseFocusSoon}
              onOpenCardPanel={() => onOpenInfo?.()}
            />
          </div>
        </>
      )}

      <NodeConnectors
        nodeId={card.id}
        connectors={card.connectors}
        selected={selected}
        chaining={chaining}
        draftActive={draftActive}
        armed={armed}
        armedConnectorId={armedConnectorId}
        color={focusedBy?.color ?? draggingPeer?.color}
        selectedConnectorId={selectedConnectorId}
        movingConnectorPeers={movingConnectorPeers}
        selectingConnectorPeers={selectingConnectorPeers}
        // A peer's dot and name tag live in this layer, so it has to be up while
        // they are holding one — whoever is looking.
        peerActive={
          Object.keys(movingConnectorPeers).length > 0 ||
          Object.keys(selectingConnectorPeers).length > 0
        }
        onSelect={(id, event) => onConnectorSelect?.(id, event)}
        onMoveStart={(id) => onConnectorMoveStart?.(id)}
        onMove={(id, position) => onConnectorMove?.(id, position)}
        onMoveFinished={onConnectorMoveFinished}
        onMoveEnd={(id, position) => onConnectorMoveEnd?.(id, position)}
        onContextMenu={(event, id) => onConnectorContextMenu?.(event, id)}
      />

      {menu ? (
        // The menu is portalled, but React still bubbles its clicks through this
        // tree; without the guard picking an item would also "click" the card.
        // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only stops menu clicks reaching the card.
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation of a menu item is a click too.
        <div className="contents" onClick={(event) => event.stopPropagation()}>
          <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
        </div>
      ) : null}
    </div>
  );
}
