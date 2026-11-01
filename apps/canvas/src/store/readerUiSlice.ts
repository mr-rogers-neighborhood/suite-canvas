/**
 * The UI state of the reading surface: the focus card, the kinds dialog, and the two requests a surface makes of the
 * book reader.
 *
 * Split out of `useUiStore` for the reason the shape rule exists: that file is the whole shell's state and it reached
 * the file-length limit, so the cohesive slice leaves rather than the file growing. Zustand keeps one store; this module
 * owns its own fields, its own actions and their prose, and the store spreads the result.
 */
export interface ReaderUiSlice {
  /** Card shown on the full-canvas focus surface, if any. */
  cardFocusId: string | null;
  /**
   * The kinds of highlight there are, and what each one becomes.
   *
   * A shell surface rather than a drawer panel: it is opened from the library, from the raise surface in a book and from
   * the card panel, so it cannot belong to any of them — a dialog led by the drawer's state could be unmounted by
   * closing the drawer it was opened from.
   */
  annotationKindsOpen: boolean;
  /**
   * A highlight a surface asked the reader to open, by id.
   *
   * A highlight lives in a record, not in a card, so "open this passage" is two facts: the book's card for the focus
   * surface, and this for the passage inside it. The reader consumes it on arrival and clears it, which is why it is a
   * request rather than a selection.
   */
  focusedAnnotationId: string | null;
  /**
   * A panel the book reader should open when it next appears.
   *
   * "Place more annotations" is the same surface as reading, opened at the list you were working through, and the panel
   * is the reader's own state. A request rather than a selection, spent on arrival, so nothing has to be un-set.
   */
  bookPanelRequest: "contents" | "highlights" | null;
  openAnnotationKinds: () => void;
  closeAnnotationKinds: () => void;
  /** Ask the book reader to open one highlight. The caller opens the book's card; the reader raises the passage. */
  openAnnotation: (annotationId: string) => void;
  clearFocusedAnnotation: () => void;
  requestBookPanel: (panel: "contents" | "highlights") => void;
  clearBookPanelRequest: () => void;
}

/** The fields this slice starts with. */
export const readerUiInitial = {
  cardFocusId: null,
  annotationKindsOpen: false,
  focusedAnnotationId: null,
  bookPanelRequest: null,
} satisfies Pick<
  ReaderUiSlice,
  "cardFocusId" | "annotationKindsOpen" | "focusedAnnotationId" | "bookPanelRequest"
>;

/**
 * The slice's actions: the ones that touch nothing outside it.
 *
 * `openCardFocus` and `closeCardFocus` stay on the store, because opening the focus surface also closes the inspector and
 * closing it ends a focus editing session. Moving a simplified copy here would be two versions of one action, and the
 * simpler one would win by being imported first.
 */
export function readerUiActions(
  set: (patch: Partial<ReaderUiSlice>) => void,
): Pick<
  ReaderUiSlice,
  | "openAnnotationKinds"
  | "closeAnnotationKinds"
  | "openAnnotation"
  | "clearFocusedAnnotation"
  | "requestBookPanel"
  | "clearBookPanelRequest"
> {
  return {
    openAnnotationKinds: () => set({ annotationKindsOpen: true }),
    closeAnnotationKinds: () => set({ annotationKindsOpen: false }),
    openAnnotation: (focusedAnnotationId) => set({ focusedAnnotationId }),
    clearFocusedAnnotation: () => set({ focusedAnnotationId: null }),
    requestBookPanel: (bookPanelRequest) => set({ bookPanelRequest }),
    clearBookPanelRequest: () => set({ bookPanelRequest: null }),
  };
}
