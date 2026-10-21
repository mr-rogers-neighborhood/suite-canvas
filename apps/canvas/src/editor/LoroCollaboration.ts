import { Extension } from "@tiptap/react";
import { type ContainerID, type LoroDoc, UndoManager } from "loro-crdt";
import {
  type CursorEphemeralStore,
  type LoroDocType,
  LoroEphemeralCursorPlugin,
  LoroSyncPlugin,
  LoroUndoPlugin,
  redo,
  undo,
} from "loro-prosemirror";

export interface LoroCollaborationOptions {
  doc: LoroDoc | null;
  containerId: ContainerID | null;
  cursorStore: CursorEphemeralStore | null;
  user: { name: string; color: string } | null;
  commitOrigin: string;
  excludeOriginPrefixes?: string[];
}

/**
 * Binds one Tiptap editor to one Loro container. Title and body each get their
 * own extension instance and container id; structural edits use the `struct:`
 * origin prefix so they stay out of the editor's undo stack.
 */
export const LoroCollaboration = Extension.create<LoroCollaborationOptions>({
  name: "loroCollaboration",

  addOptions() {
    return {
      doc: null,
      containerId: null,
      cursorStore: null,
      user: null,
      commitOrigin: "text:body",
      excludeOriginPrefixes: [],
    };
  },

  addProseMirrorPlugins() {
    const { doc, containerId, cursorStore, user, commitOrigin, excludeOriginPrefixes } =
      this.options;
    if (!doc || !containerId) return [];

    const plugins = [
      LoroSyncPlugin({
        doc: doc as LoroDocType,
        containerId,
        commitOrigin,
      }),
      LoroUndoPlugin({
        doc,
        undoManager: new UndoManager(doc, {
          mergeInterval: 1000,
          maxUndoSteps: 100,
          excludeOriginPrefixes: ["struct:", "sys:init", ...(excludeOriginPrefixes ?? [])],
        }),
      }),
    ];

    if (cursorStore) {
      plugins.push(
        LoroEphemeralCursorPlugin(cursorStore, {
          ...(user ? { user } : {}),
        }),
      );
    }

    return plugins;
  },

  addKeyboardShortcuts() {
    return {
      "Mod-z": () => undo(this.editor.view.state, this.editor.view.dispatch),
      "Mod-y": () => redo(this.editor.view.state, this.editor.view.dispatch),
      "Mod-Shift-z": () => redo(this.editor.view.state, this.editor.view.dispatch),
    };
  },
});
