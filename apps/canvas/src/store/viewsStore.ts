import { create } from "zustand";
import type { ViewDraft } from "../views/draft";
import { emptyDraft } from "../views/draft";

/**
 * The views layer's own state: whether it is open, what it is open on, and whether the reader is picking
 * cards for it.
 *
 * A *saved* view is not held here. The layer edits the document's record directly, through the field-level
 * setters, so two people in the same view see each other's changes as they happen. Only a *new* view has a
 * draft, because there is nothing to share until it exists; `Create` is the moment it becomes a record.
 */
interface ViewsState {
  /** Whether the layer is on screen. */
  open: boolean;
  /** The saved view being read, or null when the layer is on a new draft. */
  editingId: string | null;
  /** A new view, until its first Create. */
  draft: ViewDraft | null;
  /** Whether the context drawer is showing. */
  contextOpen: boolean;
  /** True while the layer is out of the way and the board is being picked for pins. */
  picking: boolean;
  /** The pins as they were when picking began, so Cancel can put them back. */
  pickBase: readonly string[] | null;

  /** Open a saved view, or the last one if none is named. */
  openLayer: (viewId: string | null) => void;
  /** Open the layer on a view that does not exist yet. */
  openNew: (count: number, pendingCardId?: string | null) => void;
  /** The view card a new draft was opened from, linked when it is created. */
  pendingCardId: string | null;
  setDraft: (patch: Partial<ViewDraft>) => void;
  setEditing: (viewId: string | null) => void;
  close: () => void;
  toggleContext: (open?: boolean) => void;
  /** Begin picking: record where the pins were so Cancel is exact. */
  startPicking: (base: readonly string[]) => void;
  endPicking: () => void;
  /** Cancel a pick: the caller restores `pickBase`. */
  cancelPicking: () => readonly string[] | null;
  /** The draft became a record. */
  created: (viewId: string) => void;
}

export const useViewsStore = create<ViewsState>()((set, get) => ({
  open: false,
  editingId: null,
  draft: null,
  contextOpen: false,
  picking: false,
  pickBase: null,
  pendingCardId: null,

  openLayer: (viewId) =>
    set({
      open: true,
      editingId: viewId,
      draft: null,
      // A drawer left open on the last view would cover the rail the reader just asked to see.
      contextOpen: false,
      pendingCardId: null,
    }),

  openNew: (count, pendingCardId = null) =>
    set({
      open: true,
      editingId: null,
      draft: emptyDraft(count),
      contextOpen: true,
      pendingCardId,
    }),

  setDraft: (patch) => {
    const draft = get().draft;
    if (draft === null) return;
    set({ draft: { ...draft, ...patch } });
  },

  setEditing: (viewId) => set({ editingId: viewId, draft: null }),

  close: () => set({ open: false, picking: false, pickBase: null }),

  toggleContext: (open) => set({ contextOpen: open === undefined ? !get().contextOpen : open }),

  startPicking: (base) => set({ picking: true, pickBase: [...base] }),
  endPicking: () => set({ picking: false, pickBase: null }),
  cancelPicking: () => {
    const base = get().pickBase;
    set({ picking: false, pickBase: null });
    return base;
  },

  created: (viewId) => set({ draft: null, editingId: viewId, pendingCardId: null }),
}));

/** The pins a draft or a saved view currently holds, from whichever is open. */
export function activePins(state: {
  draft: ViewDraft | null;
  editingId: string | null;
}): readonly string[] {
  return state.draft?.cardIds ?? [];
}
