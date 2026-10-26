import { runViewQuery, type SavedView, type ViewQuery } from "@suite/graph";
import { useEffect, useMemo } from "react";
import { useSavedViews } from "../chrome/ViewsBar";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * The canvas lens: when a saved view is applied, the board keeps every card but
 * dims the ones the view did not select, so the result reads first without
 * losing the spatial context around it.
 *
 * The match set comes from the same `runViewQuery` the library and the Views
 * menu use, so a view cannot mean one thing in the drawer and another on the
 * canvas. Nothing here is written to the document: a lens is UI state.
 */
export interface CanvasLens {
  /** The applied view, or null when no view is active. */
  view: SavedView | null;
  /** Card ids the view selected; empty when there is no lens. */
  cardIds: ReadonlySet<string>;
}

const NO_IDS: ReadonlySet<string> = new Set();

export function useCanvasLens(): CanvasLens {
  const workspace = useCanvasStore((state) => state.workspace);
  const activeViewId = useUiStore((state) => state.activeViewId);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const views = useSavedViews(workspace);
  const snapshot = useWorkspaceSnapshot();

  const view = activeViewId === null ? null : (views.find((v) => v.id === activeViewId) ?? null);

  // The query reads the document directly, so what it must depend on are the
  // collections it reads. Depending on the whole snapshot would rebuild the set
  // whenever the snapshot object changed identity, and every consumer of the
  // lens would repaint for no visible reason.
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

  // Consumers put this in effect dependencies, so its identity must only change
  // when the lens actually changes. A fresh object per render would re-run the
  // node and edge projections forever.
  return useMemo(() => ({ view, cardIds }), [view, cardIds]);
}

/** Whether the lens selected a card. A card with no lens is always "on". */
export function lensSelects(lens: CanvasLens, cardId: string): boolean {
  if (!lens.view) return true;
  return lens.cardIds.has(cardId);
}

/**
 * The derived reference index is what a `backlink` or `relation` predicate
 * reads. Repairing it is idempotent but can write once on a workspace that
 * arrived from another client, so it runs in an effect — never during the read
 * above — and only while a lens is actually on.
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
