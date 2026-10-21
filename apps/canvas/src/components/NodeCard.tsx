import type { Card, CardType, Connector as ConnectorModel } from "@suite/graph";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CardMeta } from "../cards/cardMeta";
import type { PresenceUser } from "../collab/presence";
import { countRender } from "../dev/perf";
import { LoroCollaboration } from "../editor/LoroCollaboration";
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

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading1: boolean;
  heading2: boolean;
  bulletList: boolean;
  orderedList: boolean;
}

export function NodeCard({
  card,
  type,
  meta,
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

  const editor = useEditor(
    {
      editable: editing === "body",
      extensions: [
        // Collaboration ships its own undo history, so StarterKit's is disabled.
        StarterKit.configure({ undoRedo: false }),
        LoroCollaboration.configure({
          doc: cardDoc,
          containerId: contentId,
          cursorStore,
          user: localUser,
          commitOrigin: "text:body",
          excludeOriginPrefixes: ["text:title"],
        }),
      ],
      editorProps: {
        attributes: {
          class:
            "node-card-editor min-h-[52px] w-full px-3 pt-2.5 pb-2 text-sm text-[var(--ink)] focus:outline-none",
        },
      },
      onFocus: keepFocusAlive,
      onBlur: releaseFocusSoon,
    },
    [cardDoc, contentId, cursorStore, localUser, card.id],
  );

  const title = useEditor(
    {
      editable: editing === "title",
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        LoroCollaboration.configure({
          doc: cardDoc,
          containerId: titleId,
          cursorStore,
          user: localUser,
          commitOrigin: "text:title",
          excludeOriginPrefixes: ["text:body"],
        }),
      ],
      editorProps: {
        attributes: {
          class:
            "card-title-editor w-full truncate text-[13px] font-semibold leading-5 text-[var(--ink)] focus:outline-none",
          "aria-label": "Card title",
        },
        // Enter commits instead of adding a line: titles stay single-line.
        handleKeyDown: (_view, event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onEditEnd?.();
            return true;
          }
          return false;
        },
      },
      onFocus: () => {
        keepFocusAlive();
        onStartEditing?.("title");
      },
      onBlur: releaseFocusSoon,
    },
    [cardDoc, titleId, cursorStore, localUser, card.id],
  );

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }): ToolbarState => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
    }),
  });

  const titleEmpty = useEditorState({
    editor: title,
    selector: ({ editor: current }) => current.isEmpty,
  });

  // Layout effect so the editor is editable and focused before the browser
  // paints; otherwise the first keystroke of a brand-new note can be dropped.
  useLayoutEffect(() => {
    if (!editor) return;
    editor.setEditable(editing === "body");
    if (editing !== "body") return;

    editor.commands.focus("end");
    const frame = requestAnimationFrame(() => {
      editor.commands.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, editing]);

  useLayoutEffect(() => {
    if (!title) return;
    title.setEditable(editing === "title");
    if (editing !== "title") return;

    title.commands.focus("end");
    const frame = requestAnimationFrame(() => {
      title.commands.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [title, editing]);

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

  const buttonClass = (active: boolean) =>
    `rounded px-2 py-1 text-xs transition-colors ${
      active
        ? "bg-gray-300 font-semibold text-gray-900 dark:bg-white/25 dark:text-white"
        : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
    }`;

  const menuItems: ContextMenuItem[] = [
    { label: "Card info", onSelect: () => onOpenInfo?.() },
    { label: "Edit title", onSelect: () => onStartEditing?.("title") },
    { label: "Edit body", onSelect: () => onStartEditing?.("body") },
    { label: "Remove from board", onSelect: () => onRemoveFromBoard?.() },
    { label: "Delete card", danger: true, onSelect: () => onTrash?.() },
  ];

  return (
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
    >
      <div className="card-header flex shrink-0 items-center gap-1.5 rounded-t-md px-2 py-2">
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
              onClick={(event) => {
                // Keyboard activation has no pointer movement to compare.
                if (event.detail > 0) {
                  const origin = pointerOrigin.current;
                  const moved = origin
                    ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y)
                    : 0;
                  // A drag is not a click, and the first click only selects.
                  if (moved > 4 || !selected) return;
                }
                onStartEditing?.("title");
              }}
            />
          )}
          <EditorContent
            editor={title}
            className={editing === "title" ? "nodrag nopan" : undefined}
          />
          {titleEmpty ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 text-[13px] leading-5 text-[var(--ink-muted)]/70"
            >
              Untitled
            </span>
          ) : null}
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

        {activePeer ? <PeerNameTag user={activePeer} /> : null}

        <button
          type="button"
          aria-label="Card actions"
          data-testid="card-menu"
          className="nodrag shrink-0 rounded px-1 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.right - 4, y: rect.bottom + 4 });
          }}
        >
          {"\u22ef"}
        </button>
      </div>

      {meta.properties.length > 0 || meta.tags.length > 0 ? (
        <div
          className="card-meta flex shrink-0 flex-wrap items-center gap-1 px-2.5 pb-1"
          data-testid="card-meta"
        >
          {meta.properties.map((property) => (
            <span key={property.fieldId} className="card-meta-chip" title={property.label}>
              <span className="card-meta-label">{property.label}</span>
              {property.value !== property.label ? <span>{property.value}</span> : null}
            </span>
          ))}
          {meta.tags.map((name) => (
            <span key={name} className="card-meta-tag">
              #{name}
            </span>
          ))}
        </div>
      ) : null}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the nested ProseMirror editor owns keyboard interaction */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: clicking the body focuses the nested editor */}
      <div
        className={`card-body-scroll min-h-0 flex-1 overflow-auto ${
          editing === "body" ? "nodrag" : ""
        }`}
        data-testid="card-body"
        onClick={(event) => {
          if (editing === "body") return;
          const origin = pointerOrigin.current;
          const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) : 0;
          // A drag moves the card; a click without movement enters the text.
          if (moved <= 4) onStartEditing?.("body");
        }}
      >
        <EditorContent editor={editor} />
      </div>

      {toolbar ? (
        <BubbleMenu editor={editor} data-testid="format-toolbar">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-lg">
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={buttonClass(toolbar.bold)}
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`${buttonClass(toolbar.italic)} italic`}
            >
              I
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleStrike().run()}
              className={`${buttonClass(toolbar.strike)} line-through`}
            >
              S
            </button>
            <span className="mx-1 h-4 w-px bg-[var(--hairline)]" />
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
              className={buttonClass(toolbar.heading1)}
            >
              H1
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              className={buttonClass(toolbar.heading2)}
            >
              H2
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={buttonClass(toolbar.bulletList)}
            >
              {"\u2022"}
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              className={buttonClass(toolbar.orderedList)}
            >
              1.
            </button>
          </div>
        </BubbleMenu>
      ) : null}

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
