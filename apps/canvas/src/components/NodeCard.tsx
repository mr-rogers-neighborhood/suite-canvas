import type { Card, CardType, Connector as ConnectorModel } from "@suite/graph";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { CardMeta } from "../cards/cardMeta";
import type { PresenceUser } from "../collab/presence";
import { countRender } from "../dev/perf";
import { CardBodyEditor, CardTitleEditor } from "./CardBodyEditor";
import { Connector } from "./Connector";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { PeerNameTag } from "./PeerNameTag";
import { PresenceAvatars } from "./PresenceAvatars";

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
  /** Toggles the frontmatter area. */
  onToggleMeta?: () => void;
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
  /** Which editor this card is focused in, if any. */
  editing?: EditingField | null;
  presence?: PresenceUser[];
  draggingPeers?: PresenceUser[];
  /** Cards the dragging peer is moving, so the label can say "3 cards". */
  draggingCount?: number;
  selectingPeers?: PresenceUser[];
  /** Peers currently resizing this card. */
  resizingPeers?: PresenceUser[];
  movingConnectorPeers?: Record<string, ConnectorPeerState>;
  selectingConnectorPeers?: Record<string, PresenceUser[]>;
  onConnectorMoveStart?: (connectorId: string) => void;
  onConnectorMove?: (connectorId: string, position: { x: number; y: number }) => void;
  onConnectorMoveFinished?: () => void;
  selectedConnectorId?: string | null;
  onConnectorSelect?: (connectorId: string) => void;
  onConnectorMoveEnd?: (connectorId: string, position: { x: number; y: number }) => void;
  onConnectorContextMenu?: (event: React.MouseEvent, connectorId: string) => void;
  onStartEditing?: (field: EditingField) => void;
  onEditEnd?: () => void;
  onRemoveFromBoard?: () => void;
  /** Opens the inspector for this card. */
  onOpenInfo?: () => void;
  onTrash?: () => void;
}

export function NodeCard({
  card,
  type,
  meta,
  metaExpanded = false,
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
  editing = null,
  presence = [],
  draggingPeers = [],
  draggingCount = 1,
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
  onEditEnd,
  onRemoveFromBoard,
  onOpenInfo,
  onTrash,
}: NodeCardProps) {
  countRender("card");

  // Blur can fire transiently while the card re-renders (presence updates, CRDT
  // sync). Only leave edit mode when focus does not come back.
  const blurTimeout = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);

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
    blurTimeout.current = window.setTimeout(() => {
      blurTimeout.current = null;
      onEditEnd?.();
    }, 120);
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

  const cardClass = [
    "node-card relative flex w-56 flex-col rounded-md border border-[var(--hairline)]",
    selected && !draggingPeer && !focusedBy
      ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-500/30"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const menuItems: ContextMenuItem[] = [
    { label: "Card info", onSelect: () => onOpenInfo?.() },
    ...(hasMeta && onToggleMeta
      ? [
          {
            label: `${metaExpanded ? "Hide" : "Show"} details`,
            onSelect: onToggleMeta,
          },
        ]
      : []),
    { label: "Edit title", onSelect: () => onStartEditing?.("title") },
    { label: "Edit body", onSelect: () => onStartEditing?.("body") },
    { label: "Remove from board", onSelect: () => onRemoveFromBoard?.() },
    { label: "Delete card", danger: true, onSelect: () => onTrash?.() },
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is a canvas node; keyboard open is handled by Enter on the selected node.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the card is a canvas node; keyboard open is handled by Enter on the selected node.
    <div
      data-testid="node-card"
      data-node-id={card.id}
      data-dragging={draggingPeer ? "true" : undefined}
      data-selected-by-peer={selectingPeer ? "true" : undefined}
      data-resizing-by-peer={resizingPeer ? "true" : undefined}
      data-board-id={boardId}
      className={cardClass}
      style={{
        ...presenceStyle,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      }}
      onPointerDown={(event) => {
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        if (editing) return;
        // Multi-select owns modifier clicks; they must not open the inspector.
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        const origin = pointerOrigin.current;
        const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) : 0;
        // A drag moves the card; a click without movement opens its info.
        if (moved > 4) return;
        onOpenInfo?.();
      }}
    >
      <div className="card-header flex shrink-0 items-center gap-1.5 rounded-t-md px-2 py-2">
        {hasMeta ? (
          <button
            type="button"
            aria-label={metaExpanded ? "Hide details" : "Show details"}
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

        <button
          type="button"
          aria-label={`Card type: ${type.name}`}
          title={type.name}
          data-testid="card-type"
          className="card-type-glyph nodrag shrink-0 rounded px-0.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={(event) => {
            event.stopPropagation();
            onOpenInfo?.();
          }}
        >
          {type.glyph}
        </button>

        <div className="card-title relative min-w-0 flex-1">
          {editing === "title" ? null : (
            <button
              type="button"
              aria-label="Edit card title"
              className="absolute inset-0 z-10 cursor-text"
              onDoubleClick={(event) => {
                event.stopPropagation();
                onStartEditing?.("title");
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

        {activePeer ? (
          <PeerNameTag
            user={activePeer}
            detail={draggingPeer && draggingCount > 1 ? `${draggingCount} cards` : undefined}
          />
        ) : null}

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
      </div>

      {hasMeta && metaExpanded ? (
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

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the nested ProseMirror editor owns keyboard interaction */}
      <div
        className={`card-body-scroll min-h-0 flex-1 overflow-auto ${
          editing === "body" ? "nodrag" : ""
        }`}
        data-testid="card-body"
        onDoubleClick={(event) => {
          if (editing === "body") return;
          event.stopPropagation();
          onStartEditing?.("body");
        }}
      >
        <CardBodyEditor
          cardDoc={cardDoc}
          contentId={contentId}
          cursorStore={cursorStore}
          localUser={localUser}
          editable={editing === "body"}
          onFocus={keepFocusAlive}
          onBlur={releaseFocusSoon}
        />
      </div>

      {card.connectors.map((connector: ConnectorModel) => (
        <Connector
          key={connector.id}
          connector={connector}
          nodeId={card.id}
          color={focusedBy?.color ?? draggingPeer?.color}
          selected={selectedConnectorId === connector.id}
          onSelect={(id) => onConnectorSelect?.(id)}
          onMoveEnd={(id, position) => onConnectorMoveEnd?.(id, position)}
          movingPeers={movingConnectorPeers[connector.id]?.users ?? []}
          selectingPeers={selectingConnectorPeers[connector.id] ?? []}
          peerPosition={movingConnectorPeers[connector.id]?.position ?? null}
          onMoveStart={() => onConnectorMoveStart?.(connector.id)}
          onMove={(position) => onConnectorMove?.(connector.id, position)}
          onMoveFinished={onConnectorMoveFinished}
          onContextMenu={(event, id) => onConnectorContextMenu?.(event, id)}
        />
      ))}

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}
