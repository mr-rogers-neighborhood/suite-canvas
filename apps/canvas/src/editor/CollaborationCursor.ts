import { Extension } from "@tiptap/react";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { Awareness } from "y-protocols/awareness";

export interface CollaborationCursorOptions {
  awareness: Awareness | null;
  /** Card owning this editor; remote carets are only drawn when the peer focuses it. */
  nodeId: string;
  /** Which editor on the card this is, so title and body carets never cross over. */
  field?: "title" | "body";
}

interface PeerState {
  focus?: { nodeId?: string; field?: "title" | "body" };
}

/**
 * Renders remote carets/selections and publishes the local selection through
 * awareness, using `@tiptap/y-tiptap`'s `yCursorPlugin`.
 *
 * Two constraints shape this:
 * - The plugin's default awareness field (`cursor`) must be kept: it writes to a
 *   configurable field but reads `cursor` when rendering, so a custom field
 *   silently disables remote carets.
 * - All node editors share one awareness, so selections must be filtered by the
 *   peer's focused node. Without the filter, a caret from one card is mapped
 *   into every other card's document and lands in the wrong place.
 */
export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
  name: "collaborationCursor",

  addOptions() {
    return {
      awareness: null,
      nodeId: "",
      field: "body",
    };
  },

  addProseMirrorPlugins() {
    const { awareness, nodeId, field } = this.options;
    if (!awareness) return [];

    return [
      yCursorPlugin(awareness, {
        awarenessStateFilter: (currentClientId, userClientId, state) => {
          const focus = (state as PeerState).focus;
          if (userClientId === currentClientId || focus?.nodeId !== nodeId) return false;
          return (focus.field ?? "body") === field;
        },
      }),
    ];
  },
});
