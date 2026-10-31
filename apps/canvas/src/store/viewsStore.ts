import type { SavedView } from "@suite/graph";
import { create } from "zustand";
import { draftFromView, draftIsDirty, emptyDraft, type ViewDraft } from "../views/draft";
import { useUiStore } from "./useUiStore";

/**
 * The views editor's own state: the draft it is editing, whether that draft is applied, and which
 * view the presentation surface is showing.
 *
 * A draft outlives the sheet on purpose. "I want to see it work before I save it" means the preview
 * has to keep working after the reader closes the panel to look at the board, so `draft` is the
 * applied draft and `editorOpen` only says whether the sheet is in front of it. Nothing here is
 * document data: the draft becomes a view only when `WorkspaceDocument` writes it.
 */
interface ViewsState {
  /** The draft being edited or previewed, or null when there is none. */
  draft: ViewDraft | null;
  /** Whether the sheet is open on that draft. */
  editorOpen: boolean;
  /** Whether the draft is applied to the board and the presentation surface. */
  preview: boolean;
  /** The saved view the presentation surface shows, or `PREVIEW_VIEW_ID` for a draft. */
  presented: string | null;
  /** What was applied before the sheet opened, so Cancel can put it back. */
  previous: string | null;
  /** The view card a new draft was opened from, linked to the view when it saves. */
  pendingCardId: string | null;

  /** Start a brand-new view: the sheet opens on it and it previews immediately. */
  openNew: (count: number, pendingCardId?: string | null) => void;
  /** Edit a saved view. It previews as you edit, so the board answers every keystroke. */
  openView: (view: SavedView) => void;
  /** Change part of the draft. */
  patch: (patch: Partial<ViewDraft>) => void;
  /** Close the sheet and leave the draft applied (or not). */
  closeEditor: () => void;
  /** Reopen the sheet on the draft that is already applied. */
  reopenEditor: () => void;
  /** The live preview switch. Off restores whatever was applied before. */
  setPreview: (preview: boolean) => void;
  /** Which view the presentation surface is showing. */
  present: (viewId: string | null) => void;
  /** Throw the draft away, preview included. */
  discard: () => void;
  /** The draft is saved: it stops being a draft and becomes the presented view. */
  saved: (viewId: string) => void;
}

/** The view id applied on the board before a draft took over. */
function currentApplied(): string | null {
  return useUiStore.getState().activeViewId;
}

export const useViewsStore = create<ViewsState>()((set, get) => ({
  draft: null,
  editorOpen: false,
  preview: true,
  presented: null,
  previous: null,
  pendingCardId: null,

  openNew: (count, pendingCardId = null) =>
    set({
      draft: emptyDraft(count),
      editorOpen: true,
      preview: true,
      previous: currentApplied(),
      pendingCardId,
    }),
  openView: (view) =>
    set({
      draft: draftFromView(view),
      editorOpen: true,
      preview: true,
      previous: currentApplied(),
    }),
  patch: (patch) => {
    const draft = get().draft;
    if (!draft) return;
    set({ draft: { ...draft, ...patch } });
  },

  closeEditor: () => set({ editorOpen: false }),
  reopenEditor: () => set({ editorOpen: true }),

  setPreview: (preview) => set({ preview }),

  present: (viewId) => set({ presented: viewId }),

  discard: () =>
    set({ draft: null, editorOpen: false, preview: true, presented: null, pendingCardId: null }),

  saved: (viewId) =>
    set({ draft: null, editorOpen: false, preview: true, presented: viewId, pendingCardId: null }),
}));

/** The view the board and the presentation should show for a draft, or null when previewing is off. */
export function previewView(state: {
  draft: ViewDraft | null;
  preview: boolean;
}): ViewDraft | null {
  return state.preview && state.draft !== null ? state.draft : null;
}

/** Whether the open draft differs from the view it came from, for the dirty chip. */
export function draftDirty(draft: ViewDraft | null, saved: SavedView | undefined): boolean {
  return draft !== null && draftIsDirty(draft, saved);
}
