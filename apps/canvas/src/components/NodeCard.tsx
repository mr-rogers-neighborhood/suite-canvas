import type { GraphNode } from "@suite/graph";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { PresenceUser } from "../collab/presence";
import { CollaborationCursor } from "../editor/CollaborationCursor";
import { PresenceAvatars } from "./PresenceAvatars";

export interface NodeCardProps {
  node: GraphNode;
  fragment: Y.XmlFragment;
  awareness: Awareness | null;
  selected?: boolean;
  editing?: boolean;
  presence?: PresenceUser[];
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
  onEditEnd,
}: NodeCardProps) {
  const editor = useEditor(
    {
      editable: false,
      extensions: [
        // Collaboration ships its own undo history, so StarterKit's is disabled.
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({ fragment }),
        CollaborationCursor.configure({ awareness }),
      ],
      editorProps: {
        attributes: {
          class:
            "node-card-editor min-h-[40px] w-56 px-3 py-2 text-sm text-gray-800 focus:outline-none",
        },
      },
      onBlur: () => onEditEnd?.(),
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

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editing);
    if (!editing) return;

    // Focus immediately, and again on the next frame as a fallback for the
    // editor's first mount (the ProseMirror view can attach after this effect).
    editor.commands.focus("end");
    const frame = requestAnimationFrame(() => {
      editor.commands.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, editing]);

  const cardClass = [
    "node-card relative rounded-xl border bg-white shadow-sm transition-shadow",
    selected ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-200",
    editing ? "nodrag shadow-md" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const buttonClass = (active: boolean) =>
    `rounded px-2 py-1 text-xs transition-colors ${
      active ? "bg-gray-300 font-semibold text-gray-900" : "text-gray-600 hover:bg-gray-200"
    }`;

  return (
    <div data-testid="node-card" data-node-id={node.id} className={cardClass}>
      <div className="flex items-center justify-between px-3 pt-2">
        <span className="text-[10px] font-medium uppercase text-gray-400">note</span>
        <PresenceAvatars users={presence} />
      </div>
      <EditorContent editor={editor} />
      {editor ? (
        <BubbleMenu editor={editor}>
          <div
            data-testid="editor-toolbar"
            role="toolbar"
            className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
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
