import type { Editor } from "@tiptap/react";
import { create } from "zustand";

/**
 * The `/media` picker, as UI state.
 *
 * The `/` menu and the toolbar both insert media, and both need the same four
 * choices, so the question is asked in one place and the answer runs against the
 * editor that asked it. The editor is held here rather than in React state
 * because the surfaces that open this are a ProseMirror plugin and a toolbar
 * button, neither of which owns a React tree that could hold it.
 */
export interface MediaPickerState {
  /** The editor the answer applies to; null when the picker is closed. */
  editor: Editor | null;
  open: boolean;
  openPicker: (editor: Editor) => void;
  closePicker: () => void;
}

export const useMediaPicker = create<MediaPickerState>((set) => ({
  editor: null,
  open: false,
  openPicker: (editor) => set({ editor, open: true }),
  closePicker: () => set({ editor: null, open: false }),
}));

/** Asks which kind of media to add, at the caret of `editor`. */
export function openMediaPicker(editor: Editor): void {
  useMediaPicker.getState().openPicker(editor);
}
