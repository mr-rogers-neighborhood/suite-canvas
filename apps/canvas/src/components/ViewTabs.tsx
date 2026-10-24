import type { View } from "@suite/graph";
import { useState } from "react";

/** Peers whose active view is this one, named for the tab's tooltip. */
export interface ViewPresence {
  label: string;
  color: string;
}

export interface ViewTabsProps {
  views: View[];
  activeViewId: string | null;
  onSelect: (viewId: string) => void;
  onCreate: () => void;
  onRename: (viewId: string, name: string) => void;
  onDeleteRequest: (viewId: string) => void;
  /** Viewers and board/card shares may switch views but not add one. */
  canCreateViews?: boolean;
  /** Renaming and deleting a view belongs to the workspace surface, not a draft. */
  canManageViews?: boolean;
  /** Cross-view presence, keyed by view id; no transport of its own. */
  peersByView?: Record<string, ViewPresence>;
}

/**
 * View switcher in the app bar: one tab per camera, plus create and delete.
 *
 * A View is a camera only (ADR-0039): every Board is on every View, so a tab
 * moves the reader rather than changing what the document holds. The test ids
 * keep their historical `board-tab` prefix because the e2e suite and the visual
 * baselines select on it.
 */
export function ViewTabs({
  views,
  activeViewId,
  onSelect,
  onCreate,
  onRename,
  onDeleteRequest,
  canCreateViews = true,
  canManageViews = true,
  peersByView,
}: ViewTabsProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (renamingId) onRename(renamingId, draft);
    setRenamingId(null);
  };

  const activeView = views.find((view) => view.id === activeViewId);

  return (
    // The tablist owns the tabs and nothing else; the per-view delete and the
    // "new view" button live beside it instead of inside it.
    <div className="group flex min-w-0 items-center gap-1">
      <div className="board-tabs flex min-w-0 items-center gap-1" role="tablist" aria-label="Views">
        {views.map((view) => {
          const active = view.id === activeViewId;
          const presence = peersByView?.[view.id];
          return renamingId === view.id ? (
            <input
              key={view.id}
              // biome-ignore lint/a11y/noAutofocus: inline rename is an explicit gesture
              autoFocus
              value={draft}
              aria-label={`Rename ${view.name}`}
              className="w-28 rounded px-2 py-1 text-[12px] outline-none ring-1 ring-blue-400"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
                if (event.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`board-tab-${view.id}`}
              data-active={active ? "true" : undefined}
              title={canManageViews ? "Double-click to rename" : view.name}
              className={`inline-flex max-w-[140px] items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors ${
                active
                  ? "bg-black/[0.07] font-medium text-[var(--ink)] dark:bg-white/15"
                  : "text-[var(--ink-muted)] hover:bg-black/[0.04] dark:hover:bg-white/10"
              }`}
              onClick={() => onSelect(view.id)}
              onDoubleClick={() => {
                if (!canManageViews) return;
                setRenamingId(view.id);
                setDraft(view.name);
              }}
            >
              <span className="min-w-0 truncate">{view.name}</span>
              {presence ? (
                <span
                  data-testid="view-tab-peer-dot"
                  className="board-tab-peer-dot"
                  role="img"
                  aria-label={`${presence.label} here now`}
                  title={`${presence.label} here now`}
                  style={{ backgroundColor: presence.color }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {canManageViews && activeView ? (
        <button
          type="button"
          aria-label={`Delete ${activeView.name}`}
          className="shrink-0 rounded px-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10"
          onClick={() => onDeleteRequest(activeView.id)}
        >
          {"\u00d7"}
        </button>
      ) : null}

      {canCreateViews ? (
        <button
          type="button"
          aria-label="New view"
          data-testid="view-create"
          className="shrink-0 rounded px-2 py-1 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onCreate}
        >
          +
        </button>
      ) : null}
    </div>
  );
}
