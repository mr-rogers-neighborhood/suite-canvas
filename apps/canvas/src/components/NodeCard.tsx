import type { Connector as ConnectorModel, GraphNode } from "@suite/graph";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { type CSSProperties, useEffect, useLayoutEffect, useRef } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { PresenceUser } from "../collab/presence";
import { CollaborationCursor } from "../editor/CollaborationCursor";
import { Connector } from "./Connector";
import { PresenceAvatars } from "./PresenceAvatars";

/** Everyone dragging one connector, plus where the first of them is holding it. */
export interface ConnectorPeerState {
  users: PresenceUser[];
  position: { x: number; y: number } | null;
}

export interface NodeCardProps {
  node: GraphNode;
  fragment: Y.XmlFragment;
  awareness: Awareness | null;
  selected?: boolean;
  editing?: boolean;
  /** Peers focused on this node. */
  presence?: PresenceUser[];
  /** Peers currently dragging this node. */
  draggingPeers?: PresenceUser[];
  /** Peers that have this node selected. */
  selectingPeers?: PresenceUser[];
  /** Peers dragging a connector on this node, keyed by connector id. */
  movingConnectorPeers?: Record<string, ConnectorPeerState>;
  onConnectorMoveStart?: (connectorId: string) => void;
  /** Live connector position while this client drags, throttled by the connector. */
  onConnectorMove?: (connectorId: string, position: { x: number; y: number }) => void;
  onConnectorMoveFinished?: () => void;
  selectedConnectorId?: string | null;
  onConnectorSelect?: (connectorId: string) => void;
  onConnectorMoveEnd?: (connectorId: string, position: { x: number; y: number }) => void;
  onConnectorContextMenu?: (event: React.MouseEvent, connectorId: string) => void;
  onEditEnd?: () => void;
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
  node,
  fragment,
  awareness,
  selected = false,
  editing = false,
  presence = [],
  draggingPeers = [],
  selectingPeers = [],
  movingConnectorPeers = {},
  onConnectorMoveStart,
  onConnectorMove,
  onConnectorMoveFinished,
  selectedConnectorId = null,
  onConnectorSelect,
  onConnectorMoveEnd,
  onConnectorContextMenu,
  onEditEnd,
}: NodeCardProps) {
  // Blur can fire transiently while the card re-renders (presence updates,
  // CRDT sync). Only leave edit mode when focus does not come back.
  const blurTimeout = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    },
    [],
  );

  const editor = useEditor(
    {
      editable: false,
      extensions: [
        // Collaboration ships its own undo history, so StarterKit's is disabled.
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment }),
        CollaborationCursor.configure({ awareness, nodeId: node.id }),
      ],
      editorProps: {
        attributes: {
          class:
            "node-card-editor min-h-[52px] w-full px-3 pt-2.5 pb-2 text-sm text-[var(--ink)] focus:outline-none",
        },
      },
      onFocus: () => {
        if (blurTimeout.current !== null) {
          window.clearTimeout(blurTimeout.current);
          blurTimeout.current = null;
        }
      },
      onBlur: () => {
        if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
        blurTimeout.current = window.setTimeout(() => {
          blurTimeout.current = null;
          onEditEnd?.();
        }, 120);
      },
    },
    [fragment, awareness, node.id],
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

  // Layout effect so the editor is editable and focused before the browser
  // paints; otherwise the first keystroke of a brand-new note can be dropped.
  useLayoutEffect(() => {
    if (!editor) return;
    editor.setEditable(editing);
    if (!editing) return;

    editor.commands.focus("end");
    // The ProseMirror view can attach after mount; re-focus on the next frame.
    const frame = requestAnimationFrame(() => {
      editor.commands.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, editing]);

  const draggingPeer = draggingPeers[0];
  const focusedBy = presence[0];
  const selectingPeer = selectingPeers[0];

  // Peer presence takes visual priority over local selection so collaborators
  // always see where everyone else is: dragging > editing > selecting.
  const presenceStyle: CSSProperties = draggingPeer
    ? { borderColor: draggingPeer.color, boxShadow: `0 0 0 3px ${draggingPeer.color}55` }
    : focusedBy
      ? { borderColor: focusedBy.color, boxShadow: `0 0 0 2px ${focusedBy.color}33` }
      : selectingPeer
        ? { boxShadow: `0 0 0 2px ${selectingPeer.color}66` }
        : {};

  const cardClass = [
    "node-card relative w-56 min-h-[72px] rounded-md border border-[var(--hairline)]",
    selected && !draggingPeer && !focusedBy
      ? "border-blue-500 ring-2 ring-blue-200 dark:ring-blue-500/30"
      : "",
    editing ? "nodrag" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const buttonClass = (active: boolean) =>
    `rounded px-2 py-1 text-xs transition-colors ${
      active
        ? "bg-gray-300 font-semibold text-gray-900 dark:bg-white/25 dark:text-white"
        : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
    }`;

  return (
    <div
      data-testid="node-card"
      data-node-id={node.id}
      data-dragging={draggingPeer ? "true" : undefined}
      data-selected-by-peer={selectingPeer ? "true" : undefined}
      className={cardClass}
      style={presenceStyle}
    >
      {presence.length > 0 || draggingPeers.length > 0 || selectingPeers.length > 0 ? (
        <div className="pointer-events-none absolute -top-6 right-0">
          <PresenceAvatars
            users={
              presence.length > 0
                ? presence
                : draggingPeers.length > 0
                  ? draggingPeers
                  : selectingPeers
            }
          />
        </div>
      ) : null}

      <EditorContent editor={editor} />

      {node.connectors.map((connector: ConnectorModel) => (
        <Connector
          key={connector.id}
          connector={connector}
          nodeId={node.id}
          color={focusedBy?.color ?? draggingPeer?.color}
          selected={selectedConnectorId === connector.id}
          onSelect={(id) => onConnectorSelect?.(id)}
          onMoveEnd={(id, position) => onConnectorMoveEnd?.(id, position)}
          movingPeers={movingConnectorPeers[connector.id]?.users ?? []}
          peerPosition={movingConnectorPeers[connector.id]?.position ?? null}
          onMoveStart={() => onConnectorMoveStart?.(connector.id)}
          onMove={(position) => onConnectorMove?.(connector.id, position)}
          onMoveFinished={onConnectorMoveFinished}
          onContextMenu={(event, id) => onConnectorContextMenu?.(event, id)}
        />
      ))}
      {editor ? (
        <BubbleMenu editor={editor}>
          <div
            data-testid="editor-toolbar"
            role="toolbar"
            className="flex flex-wrap gap-1 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-lg"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className={buttonClass(toolbar?.bold ?? false)}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              B
            </button>
            <button
              type="button"
              className={buttonClass(toolbar?.italic ?? false)}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              I
            </button>
            <button
              type="button"
              className={buttonClass(toolbar?.strike ?? false)}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            >
              S
            </button>
            <button
              type="button"
              className={buttonClass(toolbar?.heading1 ?? false)}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              H1
            </button>
            <button
              type="button"
              className={buttonClass(toolbar?.heading2 ?? false)}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              H2
            </button>
            <button
              type="button"
              className={buttonClass(toolbar?.bulletList ?? false)}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              {"\u2022"} List
            </button>
            <button
              type="button"
              className={buttonClass(toolbar?.orderedList ?? false)}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              1. List
            </button>
          </div>
        </BubbleMenu>
      ) : null}
    </div>
  );
}
