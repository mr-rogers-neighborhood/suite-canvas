import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type Editor, Extension } from "@tiptap/react";
import { imageAltFromSrc, imageLinkProblem, imageLinkSrc } from "./imageLinkNode";
import { MEDIA_NODE_NAME } from "./mediaNode";

/**
 * The URL being asked for, anchored at the start of the block the caret is in.
 * `error` carries the last refused answer, so the hint can say *why*.
 */
interface PromptState {
  pos: number;
  error: string | null;
}

interface PromptMeta {
  open?: boolean;
  pos?: number;
  error?: string;
}

export const imageUrlPromptKey = new PluginKey<PromptState | null>("imageUrlPrompt");

const IDLE = "Paste an image URL, then press Enter · Esc to cancel";

/**
 * The hint a reader sees while the prompt is open. It is a widget inside the
 * paragraph — not a popover and not a dialog — because this app ends an
 * editing session as soon as the body loses focus: anything that took focus
 * would destroy the editor under the answer. Living in the document keeps the
 * caret, the undo stack and the editing session intact, and the URL itself is
 * typed (or pasted) exactly where it will be used.
 */
function hintDom(error: string | null): HTMLElement {
  const hint = document.createElement("span");
  hint.className = error === null ? "image-url-hint" : "image-url-hint is-error";
  hint.contentEditable = "false";
  hint.dataset.testid = "image-url-hint";
  hint.setAttribute("role", "status");
  hint.textContent = error === null ? `🖼 ${IDLE}` : `🖼 ${error}`;
  return hint;
}

/** The prompt paragraph's text, trimmed; what Enter will read. */
function promptText(view: EditorView, pos: number): string {
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  return view.state.doc.textBetween($pos.start(), $pos.end(), "\n", "\n").trim();
}

function closePrompt(view: EditorView): void {
  if (!imageUrlPromptKey.getState(view.state)) return;
  // Whatever was typed stays as ordinary text: cancelling a prompt must not
  // silently discard a URL the user may want to keep.
  view.dispatch(view.state.tr.setMeta(imageUrlPromptKey, { open: false } satisfies PromptMeta));
}

/** Takes the typed URL and turns it into the node, or reports why it cannot. */
function commitPrompt(view: EditorView): boolean {
  const value = imageUrlPromptKey.getState(view.state);
  if (!value) return false;
  const text = promptText(view, value.pos);
  const issue = imageLinkProblem(text);
  const src = imageLinkSrc(text);
  if (issue !== null || src === null) {
    view.dispatch(
      view.state.tr.setMeta(imageUrlPromptKey, { error: issue ?? "Enter an image URL." }),
    );
    return true;
  }

  const type = view.state.schema.nodes[MEDIA_NODE_NAME];
  const paragraph = view.state.schema.nodes.paragraph;
  if (!type) return false;
  const $pos = view.state.doc.resolve(Math.min(value.pos, view.state.doc.content.size));
  if ($pos.depth === 0) return false;
  const node = type.create({ kind: "image", src, alt: imageAltFromSrc(src) });
  let transaction = view.state.tr
    .setMeta(imageUrlPromptKey, { open: false } satisfies PromptMeta)
    .replaceWith($pos.before(), $pos.after(), node);
  if (paragraph) {
    const next = paragraph.createAndFill();
    if (next) {
      const after = $pos.before() + node.nodeSize;
      transaction = transaction.insert(after, next);
      // The caret continues in the paragraph under the picture, which is where
      // a writer expects it after committing a block.
      transaction = transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
    }
  }
  view.dispatch(transaction.scrollIntoView());
  return true;
}

/**
 * The `/` menu's image row asks here: the caret stays in the editor, the hint
 * marks the spot, and Enter (or a pasted image URL) completes the node.
 */
export const ImageUrlPrompt = Extension.create({
  name: "imageUrlPrompt",

  addProseMirrorPlugins() {
    return [
      new Plugin<PromptState | null>({
        key: imageUrlPromptKey,
        state: {
          init: () => null,
          apply(transaction, value) {
            const meta = transaction.getMeta(imageUrlPromptKey) as PromptMeta | undefined;
            if (meta?.open === false) return null;
            if (meta?.open === true && typeof meta.pos === "number") {
              return { pos: meta.pos, error: null };
            }
            if (value === null) return null;
            if (typeof meta?.error === "string") return { ...value, error: meta.error };
            const pos = transaction.mapping.map(value.pos);
            if (pos > transaction.doc.content.size) return null;
            // Moving to another block abandons the prompt; its text, if any,
            // stays as ordinary text the user typed.
            const block = transaction.doc.resolve(pos).parent;
            const caret = transaction.doc.resolve(transaction.selection.from).parent;
            if (block !== caret) return null;
            return { pos, error: value.error };
          },
        },
        props: {
          decorations(state) {
            const value = imageUrlPromptKey.getState(state);
            if (!value) return null;
            const pos = Math.min(value.pos, state.doc.content.size);
            return DecorationSet.create(state.doc, [
              Decoration.widget(pos, () => hintDom(value.error), {
                side: -1,
                // The error is part of the widget, so a new error is a new key;
                // otherwise the reused DOM would keep the previous sentence.
                key: `image-url-prompt:${value.error ?? ""}`,
                stopEvent: () => true,
              }),
            ]);
          },
          handleKeyDown(view, event) {
            if (!imageUrlPromptKey.getState(view.state)) return false;
            if (event.key === "Escape") {
              closePrompt(view);
              return true;
            }
            if (event.key === "Enter") {
              return commitPrompt(view);
            }
            return false;
          },
          handleDOMEvents: {
            blur(view) {
              // Clicking away ends the session; keep whatever was typed.
              closePrompt(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** Opens the prompt at the caret. A no-op on an editor without the plugin. */
export function openImageUrlPrompt(editor: Editor): void {
  if (editor.isDestroyed) return;
  // The URL needs a line of its own: text already in the block would be read
  // as part of the answer. The split happens where the caret is, which is
  // where the `/` query just was.
  if (editor.state.selection.$from.parent.content.size > 0) {
    editor.chain().splitBlock().run();
  }
  const $from = editor.state.selection.$from;
  editor.view.dispatch(
    editor.state.tr.setMeta(imageUrlPromptKey, {
      open: true,
      pos: $from.start(),
    } satisfies PromptMeta),
  );
  editor.view.focus();
}

/** Closes an open prompt; used when a paste places an image on its own. */
export function closeImageUrlPrompt(view: EditorView): void {
  closePrompt(view);
}
