import { Fragment, Slice } from "@tiptap/pm/model";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { SuggestionPluginKey } from "@tiptap/suggestion";
import type { ContainerID, LoroDoc } from "loro-crdt";
import {
  type CursorEphemeralStore,
  createNodeFromLoroObj,
  type LoroNode,
  loroSyncPluginKey,
} from "loro-prosemirror";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { PresenceUser } from "../collab/presence";
import { cardBodySchemaExtensions } from "../editor/cardEditorExtensions";
import { LoroCollaboration } from "../editor/LoroCollaboration";
import { Mention } from "../editor/Mention";
import { EditorToolbar, type ToolbarState } from "./EditorToolbar";

/** Empty-body copy, shared by the canvas card and the inspector. */
export const BODY_PLACEHOLDER = "Begin writing, or type / for commands.";

export interface CardBodyEditorProps {
  /** Card that owns this body; property blocks resolve fields and values from it. */
  cardId: string;
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
  /**
   * A share viewer never writes, and an empty body must not advertise a
   * placeholder it cannot act on.
   */
  readOnly?: boolean | undefined;
  /** Copy for the empty state; `null` turns it off. */
  placeholder?: string | null | undefined;
  /** Accessible name for the ProseMirror surface; every surface gets one. */
  ariaLabel?: string | undefined;
  /** Extra classes for the editor wrapper (for example `nodrag nopan`). */
  className?: string | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  /** Opens the card panel from a read-only property block. */
  onOpenCardPanel?: ((cardId: string) => void) | undefined;
  /**
   * Where the formatting controls go.
   *
   * `bubble` rides the selection, which suits a wide canvas card. `inline` puts one row
   * above the text, which is what a narrow column needs: the floating row is wider than
   * the inspector and its buttons ended up off the edge, unreachable.
   */
  toolbarPlacement?: "bubble" | "inline" | "none" | undefined;
}

/**
 * `loro-prosemirror` ignores a local commit in every editor except the one that
 * authored it. One client mounts the same card body in two places (the canvas
 * card and the panel), so the twin has to re-read the shared container when the
 * other surface — or a workspace call such as `appendPropertyBlock` — writes.
 *
 * The rebuild uses the plugin's own mapping and tags the transaction as a
 * non-local update, which keeps the caret store untouched (unlike remounting).
 * An event this editor authored is skipped: the document already matches Loro,
 * so dispatching would only collapse the caret mid-keystroke.
 */
function useLocalMirrorSync(
  cardDoc: LoroDoc,
  containerId: ContainerID,
  editor: Editor | null,
): void {
  useEffect(() => {
    if (!editor) return;
    const container = cardDoc.getContainerById(containerId);
    if (!container) return;

    let frame: number | null = null;
    const rebuild = () => {
      frame = null;
      const editorState = editor.state;
      const syncState = loroSyncPluginKey.getState(editorState);
      if (!syncState) return;

      const fresh = createNodeFromLoroObj(
        editorState.schema,
        container as unknown as LoroNode,
        new Map(),
      );
      if (fresh === null || Array.isArray(fresh) || fresh.eq(editorState.doc)) return;

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
      // Own edits are written from this editor's transaction; the frame check
      // coalesces a burst of keystrokes into one comparison.
      if (event.by !== "local" || event.origin === "undo" || frame !== null) return;
      frame = requestAnimationFrame(rebuild);
    });

    return () => {
      subscription();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [cardDoc, containerId, editor]);
}

/**
 * The one body editor implementation. The canvas card and the card panel both
 * bind it to the same Loro container; only the surface that owns the keystrokes
 * renders it editable.
 */
export function CardBodyEditor({
  cardId,
  cardDoc,
  contentId,
  cursorStore,
  localUser,
  editable,
  readOnly = false,
  placeholder,
  ariaLabel = "Card body",
  className,
  onFocus,
  onBlur,
  onOpenCardPanel,
  toolbarPlacement = "bubble",
}: CardBodyEditorProps) {
  const placeholderText = placeholder === undefined ? BODY_PLACEHOLDER : placeholder;
  // The editor outlives renders, so the callback is read through a ref instead
  // of being captured by the extension options at creation time.
  const openPanelRef = useRef(onOpenCardPanel);
  useEffect(() => {
    openPanelRef.current = onOpenCardPanel;
  }, [onOpenCardPanel]);

  const editor = useEditor(
    {
      editable,
      extensions: [
        ...cardBodySchemaExtensions({
          cardId,
          placeholder: readOnly ? null : placeholderText,
          openPanel: (id: string) => openPanelRef.current?.(id),
        }),
        // Not part of the schema: plugins, cursors and its own undo stack.
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
          "aria-label": ariaLabel,
        },
      },
      onFocus: () => onFocus?.(),
      onBlur: () => onBlur?.(),
    },
    [cardId, cardDoc, contentId, cursorStore, localUser, placeholderText, readOnly, ariaLabel],
  );

  useLocalMirrorSync(cardDoc, contentId, editor);

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }): ToolbarState => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
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

  if (toolbarPlacement === "inline") {
    return (
      <>
        {/* Above the text, in the column's own flow: a floating row cannot fit here. */}
        {toolbar ? (
          <div className="mb-1.5">
            <EditorToolbar editor={editor} state={toolbar} />
          </div>
        ) : null}
        <EditorContent editor={editor} className={className} />
      </>
    );
  }

  return (
    <>
      <EditorContent editor={editor} className={className} />
      {toolbar && toolbarPlacement === "bubble" ? (
        <BubbleMenu editor={editor} data-testid="format-menu">
          <EditorToolbar editor={editor} state={toolbar} />
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
        // Titles can reference cards too, with the same picker as the body.
        Mention,
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
        // The `@` picker gets the key first while it is open, so choosing a
        // mention does not commit the title and drop the suggestion.
        handleKeyDown: (view, event) => {
          if (event.key !== "Enter") return false;
          if (SuggestionPluginKey.getState(view.state)?.active) return false;
          event.preventDefault();
          onCommit?.();
          return true;
        },
      },
      onFocus: () => onFocus?.(),
      onBlur: () => onBlur?.(),
    },
    [cardDoc, titleId, cursorStore, localUser],
  );

  useLocalMirrorSync(cardDoc, titleId, title);

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
          className="pointer-events-none absolute inset-0 text-[13px] leading-5 text-[var(--ink-muted)]"
        >
          Untitled
        </span>
      ) : null}
    </div>
  );
}
