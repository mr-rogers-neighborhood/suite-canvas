import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

/** The pending completion shown after the caret, and where it belongs. */
export interface MentionGhostState {
  pos: number;
  text: string;
}

export const mentionGhostKey = new PluginKey<MentionGhostState | null>("mentionGhost");

/**
 * Shadow text for the suggestion list: the completion a reader would get by
 * pressing Enter, drawn as a decoration so it is never part of the document.
 *
 * Writing the completion into the text instead would make arrowing through the
 * list an edit — it would land in the undo stack, it could not express a title
 * with a space (the suggestion query stops at whitespace), and a key arriving
 * mid-update could type into the card. A widget has none of those failure modes:
 * it is not text, so nothing is inserted by accident, and any change to the
 * document or the selection clears it.
 */
export const MentionGhost = Extension.create({
  name: "mentionGhost",

  addProseMirrorPlugins() {
    return [
      new Plugin<MentionGhostState | null>({
        key: mentionGhostKey,
        state: {
          init: () => null,
          apply: (transaction, value) => {
            const meta = transaction.getMeta(mentionGhostKey) as
              | MentionGhostState
              | null
              | undefined;
            if (meta !== undefined) return meta;
            // Anything the reader does invalidates a shadow of a stale list.
            if (transaction.docChanged || transaction.selectionSet) return null;
            return value;
          },
        },
        props: {
          decorations(state) {
            const ghost = mentionGhostKey.getState(state);
            if (!ghost?.text) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(ghost.pos, () => {
                const span = document.createElement("span");
                span.className = "mention-ghost";
                span.setAttribute("aria-hidden", "true");
                span.textContent = ghost.text;
                return span;
              }),
            ]);
          },
        },
      }),
    ];
  },
});
