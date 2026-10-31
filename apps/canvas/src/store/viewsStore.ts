import { create } from "zustand";
import type { ViewDraft } from "../views/draft";
import { emptyDraft } from "../views/draft";

/**
 * The views layer's own state: whether it is open, what it is open on, how it is being read, and whether
 * the reader is building the context by picking on the board.
 *
 * A *saved* view is not held here. The layer edits the document's record directly, through the field-level
 * setters, so two people in the same view see each other's changes as they happen. Only a *new* view has a
 * draft, because there is nothing to share until it exists; `Create` is the moment it becomes a record.
 *
 * Everything in this store is a reading position rather than a fact: the mode, the drill-down, the hidden
 * columns describe how *this* reader is looking, so none of it is written and none of it can be changed by
 * a peer.
 */
export type LayerMode = "read" | "edit";

interface ViewsState {
  /** Whether the layer is on screen. */
  open: boolean;
  /** The saved view being read, or null when the layer is on a new draft. */
  editingId: string | null;
  /** A new view, until its first Create. */
  draft: ViewDraft | null;
  /** Whether the context drawer is showing. */
  contextOpen: boolean;
  /** Read opens to data; edit opens the controls that change it. */
  mode: LayerMode;
  /** A group this reader has narrowed the surface to, by the key `groupViewResult` gave it. */
  drilldown: { readonly groupBy: string; readonly key: string } | null;
  /** Fields this reader has hidden from the table, by field id. */
  hiddenFields: readonly string[];
  /** True while the layer is out of the way and the board is being picked for pins. */
  picking: boolean;
  /** The pins as they were when picking began, so Cancel can put them back. */
  pickBase: readonly string[] | null;
  /** A view this reader just deleted, so the footer can offer it back. */
  deleted: { readonly id: string; readonly name: string } | null;
  /** The view card a new draft was opened from, linked when it is created. */
  pendingCardId: string | null;

  /** Open a saved view, or the last one if none is named. */
  openLayer: (viewId: string | null) => void;
  /** Open the layer on a view that does not exist yet. */
  openNew: (count: number, pendingCardId?: string | null) => void;
  setDraft: (patch: Partial<ViewDraft>) => void;
  setEditing: (viewId: string | null) => void;
  setMode: (mode: LayerMode) => void;
  close: () => void;
  toggleContext: (open?: boolean) => void;
  /** Narrow the surface to one group of the current grouping. */
  drillInto: (groupBy: string, key: string) => void;
  clearDrilldown: () => void;
  toggleField: (fieldId: string) => void;
  showAllFields: () => void;
  /** Begin picking: record where the pins were so Cancel is exact. */
  startPicking: (base: readonly string[]) => void;
  endPicking: () => void;
  /** Cancel a pick: the caller restores `pickBase`. */
  cancelPicking: () => readonly string[] | null;
  /** The draft became a record. */
  created: (viewId: string) => void;
  noteDeleted: (view: { id: string; name: string }) => void;
  clearDeleted: () => void;
}

export const useViewsStore = create<ViewsState>()((set, get) => ({
  open: false,
  editingId: null,
  draft: null,
  contextOpen: false,
  mode: "read",
  drilldown: null,
  hiddenFields: [],
  picking: false,
  pickBase: null,
  deleted: null,
  pendingCardId: null,

  openLayer: (viewId) =>
    set({
      open: true,
      editingId: viewId,
      draft: null,
      // A drawer left open on the last view would cover the rail the reader just asked to see.
      contextOpen: false,
      // Reading is the default: the layer opens on data, and the controls are one press away.
      mode: "read",
      drilldown: null,
      pendingCardId: null,
      deleted: null,
    }),

  openNew: (count, pendingCardId = null) =>
    set({
      open: true,
      editingId: null,
      draft: emptyDraft(count),
      contextOpen: true,
      // A draft with no context is not worth reading, so a new view opens where it can be built.
      mode: "edit",
      drilldown: null,
      pendingCardId,
      deleted: null,
    }),

  setDraft: (patch) => {
    const draft = get().draft;
    if (draft === null) return;
    set({ draft: { ...draft, ...patch } });
  },

  setEditing: (viewId) => set({ editingId: viewId, draft: null, drilldown: null }),

  setMode: (mode) =>
    set({
      mode,
      // The drawer is an authoring surface: leaving edit puts it away rather than leaving it hovering.
      ...(mode === "edit" ? {} : { contextOpen: false }),
    }),

  close: () => set({ open: false, picking: false, pickBase: null, deleted: null }),

  toggleContext: (open) => set({ contextOpen: open === undefined ? !get().contextOpen : open }),

  drillInto: (groupBy, key) => set({ drilldown: { groupBy, key } }),

  clearDrilldown: () => set({ drilldown: null }),

  toggleField: (fieldId) => {
    const hidden = get().hiddenFields;
    set({
      hiddenFields: hidden.includes(fieldId)
        ? hidden.filter((id) => id !== fieldId)
        : [...hidden, fieldId],
    });
  },

  showAllFields: () => set({ hiddenFields: [] }),

  startPicking: (base) => set({ picking: true, pickBase: [...base] }),
  endPicking: () => set({ picking: false, pickBase: null }),
  cancelPicking: () => {
    const base = get().pickBase;
    set({ picking: false, pickBase: null });
    return base;
  },

  created: (viewId) => set({ draft: null, editingId: viewId, pendingCardId: null, mode: "read" }),

  noteDeleted: (view) => set({ deleted: view, editingId: null, drilldown: null }),
  clearDeleted: () => set({ deleted: null }),
}));

/** The pins a draft or a saved view currently holds, from whichever is open. */
export function activePins(state: {
  draft: ViewDraft | null;
  editingId: string | null;
}): readonly string[] {
  return state.draft?.cardIds ?? [];
}
