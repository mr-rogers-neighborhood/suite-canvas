import type { SavedView, WorkspaceDocument } from "@suite/graph";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useProjection } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useViewsStore } from "../store/viewsStore";

/**
 * Saved views live in their own root map, outside the snapshot sections a board
 * or card write touches, so the menu subscribes to that map alone.
 */
export function useSavedViews(workspace: WorkspaceDocument | null | undefined): SavedView[] {
  const subscribe = useCallback(
    (onChange: () => void) => (workspace ? workspace.observeViews(onChange) : () => {}),
    [workspace],
  );
  const getSnapshot = useCallback(() => workspace?.viewsRevision ?? 0, [workspace]);
  const revision = useSyncExternalStore(subscribe, getSnapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is the invalidation signal.
  return useMemo(() => (workspace ? workspace.listViews() : []), [workspace, revision]);
}

export interface ViewsBarProps {
  /** Defaults to the live document in the canvas store. */
  workspace?: WorkspaceDocument | null;
  /**
   * Kept for the shell's capability plumbing; the layer itself decides what a reader may change, so this
   * surface only needs to know whether the door exists.
   */
  canManage?: boolean;
}

/**
 * The door to the views layer, as one icon in the board's own control row.
 *
 * It used to be a labelled dropdown with a menu of its own, which made views a second little app inside the
 * title bar. The layer is the surface: it holds the rail, New view, each view's own actions and the
 * presentation. All this button does is open it — on the view the reader was projecting, so the two
 * surfaces always agree about which view is "current".
 */
export function ViewsBar({ workspace: workspaceProp = null }: ViewsBarProps) {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceProp ?? storeWorkspace;
  const views = useSavedViews(workspace);
  const projection = useProjection();
  const openLayer = useViewsStore((state) => state.openLayer);

  const active = views.find((view) => view.id === projection?.viewId) ?? views[0];

  return (
    <button
      type="button"
      data-testid="views-menu-button"
      aria-pressed={projection !== null}
      aria-label={active === undefined ? "Views" : `Views: ${active.name}`}
      title={active === undefined ? "Views" : `Views: ${active.name}`}
      className="board-nav-button gap-0.5"
      onClick={() => openLayer(active?.id ?? null)}
    >
      <span aria-hidden="true" className="text-[13px] leading-none">
        {"\u25c6"}
      </span>
      <span aria-hidden="true" className="text-[8px] leading-none opacity-70">
        {"\u25be"}
      </span>
    </button>
  );
}
