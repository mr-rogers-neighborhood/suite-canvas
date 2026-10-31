import { useCanvasStore } from "../store/useCanvasStore";
import { useViewsStore } from "../store/viewsStore";

/**
 * One press while picking: the card joins the view being picked for, or leaves it.
 *
 * A draft holds its pins in the layer's own state and a saved view holds them in the document, so the one
 * place that knows which is which is here rather than in the board's node-click handler.
 */
export function pickCard(cardId: string): void {
  const store = useViewsStore.getState();
  const workspace = useCanvasStore.getState().workspace;
  const draft = store.draft;
  if (draft !== null) {
    store.setDraft({
      cardIds: draft.cardIds.includes(cardId)
        ? draft.cardIds.filter((id) => id !== cardId)
        : [...draft.cardIds, cardId],
    });
    return;
  }
  const id = store.editingId;
  if (id === null || workspace === null) return;
  const view = workspace.getView(id);
  if (view === undefined) return;
  if ((view.context?.cardIds ?? []).includes(cardId)) workspace.removeViewPin(id, cardId);
  else workspace.addViewPin(id, cardId);
}
