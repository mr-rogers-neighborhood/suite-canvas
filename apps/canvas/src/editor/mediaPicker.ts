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
/**
 * Where an answer lands.
 *
 * Two places can ask for media, and they are different surfaces with the same question: the `/` menu and the
 * toolbar add a block *at a caret*, and the board's right-click adds a block *in a card at a point*. The picker
 * decides which kind; the target decides where, so a kind is defined once and works in both.
 */
export type MediaTarget =
  | { readonly kind: "editor"; readonly editor: Editor }
  | {
      readonly kind: "board";
      readonly boardId: string;
      readonly position: { readonly x: number; readonly y: number };
    };

export interface MediaPickerState {
  /** Where the answer lands; null when the picker is closed. */
  target: MediaTarget | null;
  open: boolean;
  openPicker: (target: MediaTarget) => void;
  closePicker: () => void;
}

export const useMediaPicker = create<MediaPickerState>((set) => ({
  target: null,
  open: false,
  openPicker: (target) => set({ target, open: true }),
  closePicker: () => set({ target: null, open: false }),
}));

/** Asks which kind of media to add, at the caret of `editor`. */
export function openMediaPicker(editor: Editor): void {
  useMediaPicker.getState().openPicker({ kind: "editor", editor });
}

/** Asks which kind of media to add, for a card made where the reader right-clicked. */
export function openMediaPickerOnBoard(boardId: string, position: { x: number; y: number }): void {
  useMediaPicker.getState().openPicker({ kind: "board", boardId, position });
}
