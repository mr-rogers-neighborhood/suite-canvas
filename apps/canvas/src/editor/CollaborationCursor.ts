import { Extension } from "@tiptap/react";
import { yCursorPlugin } from "@tiptap/y-tiptap";
import type { Awareness } from "y-protocols/awareness";

export interface CollaborationCursorOptions {
  awareness: Awareness | null;
}

/**
 * Renders remote carets/selections and publishes the local selection through
 * awareness, using `@tiptap/y-tiptap`'s `yCursorPlugin`.
 *
 * The plugin's default awareness field (`cursor`) must be kept: it writes to a
 * configurable field but reads `cursor` when rendering, so a custom field
 * silently disables remote carets in this version. Sharing one field across
 * node editors is safe because only the focused editor publishes a selection.
 */
export const CollaborationCursor = Extension.create<CollaborationCursorOptions>({
  name: "collaborationCursor",

  addOptions() {
    return {
      awareness: null,
    };
  },

  addProseMirrorPlugins() {
    const { awareness } = this.options;
    if (!awareness) return [];
    return [yCursorPlugin(awareness)];
  },
});
