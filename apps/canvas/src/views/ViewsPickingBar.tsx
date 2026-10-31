import type { SavedView, ViewKind, WorkspaceDocument } from "@suite/graph";
import { viewKindOf } from "@suite/graph";
import { useViewsStore } from "../store/viewsStore";
import { draftToView } from "./draft";

/**
 * The bar that replaces the layer while cards are being picked.
 *
 * A reader asked to add cards to a view, so the layer gets out of the way and the board becomes the
 * surface. The bar says what is being picked for, how many are in, and offers the two exits: Done keeps
 * them, Cancel puts back exactly what was there when picking began.
 */
export function ViewsPickingBar({
  view,
  workspace,
}: {
  view: SavedView | null;
  workspace: WorkspaceDocument | null;
}) {
  const saved = view;
  const draft = useViewsStore((state) => state.draft);
  const endPicking = useViewsStore((state) => state.endPicking);
  const cancelPicking = useViewsStore((state) => state.cancelPicking);
  const setDraft = useViewsStore((state) => state.setDraft);
  const openLayer = useViewsStore((state) => state.openLayer);

  const name = saved?.name ?? draft?.name ?? "this view";
  const count = saved?.context?.cardIds.length ?? draft?.cardIds.length ?? 0;

  const done = () => {
    endPicking();
    if (saved) openLayer(saved.id);
  };

  const cancel = () => {
    const base = cancelPicking();
    if (saved && workspace !== null) {
      workspace.clearViewPins(saved.id);
      for (const cardId of base ?? []) workspace.addViewPin(saved.id, cardId);
    } else if (draft !== null) {
      setDraft({ cardIds: [...(base ?? [])] });
    }
    if (saved) openLayer(saved.id);
  };

  return (
    <div
      data-testid="views-picking-bar"
      role="dialog"
      aria-label={`Picking cards for ${name}`}
      className="pointer-events-auto fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 text-[12px] shadow-2xl"
    >
      <span aria-hidden="true" className="text-[var(--accent)]">
        {"\u25c8"}
      </span>
      <span>
        Picking for <span className="font-medium">{name}</span>
      </span>
      <span className="tabular-nums text-[var(--ink-muted)]" data-testid="views-picking-count">
        {count} pinned
      </span>
      <button
        type="button"
        data-testid="views-picking-done"
        className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)]"
        onClick={done}
      >
        Done
      </button>
      <button
        type="button"
        data-testid="views-picking-cancel"
        className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={cancel}
      >
        Cancel
      </button>
    </div>
  );
}

/** The kind a view is shown as, for a caller that only has an id. */
export function kindOf(view: SavedView | null): ViewKind {
  return view === null ? "collection" : viewKindOf(view);
}

/** A draft expressed as a view, for the picking bar and the projection preview. */
export function previewOf(
  draft: ReturnType<typeof useViewsStore.getState>["draft"],
): SavedView | null {
  return draft === null ? null : draftToView(draft);
}
