import { runViewQuery, type SavedView, type ViewQuery } from "@suite/graph";
import { useEffect, useMemo } from "react";
import { useSavedViews } from "../chrome/ViewsBar";
import { useProjection, useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * The projection this reader has on their board: a saved view cast over the canvas, with the cards it
 * selects outlined and everything else faded.
 *
 * The *view* is shared document data; the projection is this reader's, which is why nothing here writes.
 * A projection that names a view someone deleted is dropped rather than left pointing at nothing.
 */
export interface CanvasLens {
  /** The projected view, or null when nothing is projected. */
  view: SavedView | null;
  /** Card ids the projection selects; empty when there is nothing projected. */
  cardIds: ReadonlySet<string>;
  /** Whether everything outside the context fades. */
  fade: boolean;
  /** Whether the context is outlined. */
  outline: boolean;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function useCanvasLens(): CanvasLens {
  const workspace = useCanvasStore((state) => state.workspace);
  const projection = useProjection();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const views = useSavedViews(workspace);
  const snapshot = useWorkspaceSnapshot();

  const view =
    projection === null ? null : (views.find((entry) => entry.id === projection.viewId) ?? null);

  // A view deleted on another device takes the projection with it: a bar naming a record that is gone
  // would be the one thing in the app promising something it cannot show.
  useEffect(() => {
    if (
      projection !== null &&
      workspace !== null &&
      !views.some((e) => e.id === projection.viewId)
    ) {
      useProjectionStore.getState().forget(projection.viewId);
    }
  }, [projection, views, workspace]);

  // The query reads the document directly, so what it must depend on are the collections it reads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the collections are the invalidation signal.
  const cardIds = useMemo(() => {
    if (!view || !workspace) return NO_IDS;
    const query: ViewQuery = view.query;
    const result = runViewQuery(workspace, query, { boardId: activeBoardId });
    return new Set(result.cardIds);
  }, [
    view,
    workspace,
    activeBoardId,
    snapshot.cards,
    snapshot.placements,
    snapshot.sections,
    snapshot.types,
    snapshot.tags,
  ]);

  const fade = projection?.fade ?? true;
  const outline = projection?.outline ?? true;

  // Consumers put this in effect dependencies, so its identity must only change when the projection does.
  return useMemo(() => ({ view, cardIds, fade, outline }), [view, cardIds, fade, outline]);
}

/** Whether the projection selected a card. A card with no projection is always "on". */
export function lensSelects(lens: CanvasLens, cardId: string): boolean {
  if (!lens.view) return true;
  return lens.cardIds.has(cardId);
}

/**
 * The derived reference index is what a `backlink` or `relation` predicate reads. Repairing it is
 * idempotent but can write once on a workspace that arrived from another client, so it runs in an effect
 * and only while a projection is actually on.
 */
export function useLensReferenceRepair(active: boolean): void {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  // biome-ignore lint/correctness/useExhaustiveDependencies: new cards are what make the repair worth re-running.
  useEffect(() => {
    if (!active || !workspace) return;
    workspace.ensureReferences();
  }, [active, workspace, snapshot.cards]);
}
