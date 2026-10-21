import { Fragment, Slice } from "@tiptap/pm/model";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import type { ContainerID, LoroDoc } from "loro-crdt";
import {
  type CursorEphemeralStore,
  createNodeFromLoroObj,
  type LoroNode,
  loroSyncPluginKey,
} from "loro-prosemirror";
import { useEffect, useLayoutEffect } from "react";
import type { PresenceUser } from "../collab/presence";
import { LoroCollaboration } from "../editor/LoroCollaboration";

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  heading1: boolean;
  heading2: boolean;
  bulletList: boolean;
  orderedList: boolean;
}

export interface CardBodyEditorProps {
  /** Card document that owns the body rich text. */
  cardDoc: LoroDoc;
  /** Body rich-text container. */
  contentId: ContainerID;
  /** Shared cursor presence for this workspace. */
  cursorStore: CursorEphemeralStore | null;
  /** Local user, for cursor presence. */
  localUser: PresenceUser | null;
  /** Only one surface per card may be editable at a time. */
  editable: boolean;
  /** Extra classes for the editor wrapper (for example `nodrag nopan`). */
  className?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
}

/**
 * `loro-prosemirror` ignores a local commit in every editor except the one that
 * authored it. One client mounts the same card body in two places (the canvas
 * card and the panel), but only one is editable, so the read-only twin has to
 * re-read the shared container when the focused surface writes. The rebuild uses
 * the plugin's own mapping and tags the transaction as a non-local update, which
 * keeps the caret store untouched (unlike remounting the editor).
 */
function useLocalMirrorSync(
  cardDoc: LoroDoc,
  containerId: ContainerID,
  editable: boolean,
  editor: Editor | null,
): void {
  useEffect(() => {
    if (editable || !editor) return;
    const container = cardDoc.getContainerById(containerId);
    if (!container) return;

    let frame: number | null = null;
    const rebuild = () => {
      frame = null;
      const editorState = editor.state;
      const syncState = loroSyncPluginKey.getState(editorState);
      if (!syncState) return;

      // Rebuild from scratch: the stored mapping points at the nodes that just
      // changed, which is exactly what a full re-read must replace.
      syncState.mapping.clear();
      const node = createNodeFromLoroObj(
        editorState.schema,
        container as unknown as LoroNode,
        syncState.mapping,
      );
      const transaction = editorState.tr.replace(
        0,
        editorState.doc.content.size,
        new Slice(Fragment.from(node), 0, 0),
      );
      transaction.setMeta(loroSyncPluginKey, { type: "non-local-updates" });
      editor.view.dispatch(transaction);
    };
    const subscription = container.subscribe((event) => {
      if (event.by !== "local" || frame !== null) return;
      frame = requestAnimationFrame(rebuild);
    });

    return () => {
      subscription();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [cardDoc, containerId, editable, editor]);
}

function buttonClass(active: boolean) {
  return `rounded px-2 py-1 text-xs transition-colors ${
    active
      ? "bg-gray-300 font-semibold text-gray-900 dark:bg-white/25 dark:text-white"
      : "text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
  }`;
}

/**
 * The one body editor implementation. The canvas card and the card panel both
 * bind it to the same Loro container; only the surface that owns the keystrokes
 * renders it editable.
 */
export function CardBodyEditor({
  cardDoc,
  contentId,
  cursorStore,
  localUser,
  editable,
  className,
  onFocus,
  onBlur,
}: CardBodyEditorProps) {
  const editor = useEditor(
    {
      editable,
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
      onFocus: () => onFocus?.(),
      onBlur: () => onBlur?.(),
    },
    [cardDoc, contentId, cursorStore, localUser],
  );

  useLocalMirrorSync(cardDoc, contentId, editable, editor);

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
    editor.setEditable(editable);
    if (!editable) return;

    editor.commands.focus("end");
    const frame = requestAnimationFrame(() => {
      editor.commands.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, editable]);

  return (
    <>
      <EditorContent editor={editor} className={className} />
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
    </>
  );
}

export interface CardTitleEditorProps {
  /** Card document that owns the title rich text. */
  cardDoc: LoroDoc;
  /** Title rich-text container (a single paragraph). */
  titleId: ContainerID;
  /** Shared cursor presence for this workspace. */
  cursorStore: CursorEphemeralStore | null;
  /** Local user, for cursor presence. */
  localUser: PresenceUser | null;
  /** Only one surface per card may be editable at a time. */
  editable: boolean;
  className?: string | undefined;
  ariaLabel?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  /** Enter and blur commit a single-line title. */
  onCommit?: (() => void) | undefined;
}

/**
 * Single-paragraph collaborative title. Shared by the canvas card and the panel
 * so the Enter/blur/Escape contract has one implementation.
 */
export function CardTitleEditor({
  cardDoc,
  titleId,
  cursorStore,
  localUser,
  editable,
  className,
  ariaLabel = "Card title",
  onFocus,
  onBlur,
  onCommit,
}: CardTitleEditorProps) {
  const title = useEditor(
    {
      editable,
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
          "aria-label": ariaLabel,
        },
        // Enter commits instead of adding a line: titles stay single-line.
        handleKeyDown: (_view, event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit?.();
            return true;
          }
          return false;
        },
      },
      onFocus: () => onFocus?.(),
      onBlur: () => onBlur?.(),
    },
    [cardDoc, titleId, cursorStore, localUser],
  );

  useLocalMirrorSync(cardDoc, titleId, editable, title);

  const titleEmpty = useEditorState({
    editor: title,
    selector: ({ editor: current }) => current.isEmpty,
  });

  useLayoutEffect(() => {
    if (!title) return;
    title.setEditable(editable);
    if (!editable) return;

    title.commands.focus("end");
    const frame = requestAnimationFrame(() => {
      title.commands.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [title, editable]);

  return (
    <div className="relative min-w-0">
      <EditorContent editor={title} className={className} />
      {titleEmpty ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 text-[13px] leading-5 text-[var(--ink-muted)]/70"
        >
          Untitled
        </span>
      ) : null}
    </div>
  );
}
