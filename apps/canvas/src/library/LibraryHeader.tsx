import { useState } from "react";
import { Dialog } from "../dialogs/Dialog";
import { tabKeyDown } from "../dialogs/tabKeys";
import type { LibraryTab } from "../store/useUiStore";

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "cards", label: "Cards" },
  { id: "media", label: "Media" },
  { id: "trash", label: "Trash" },
];

/**
 * What a press has to land on to *not* dismiss the drawer: the drawer, the button
 * that toggles it, and the menu and dialogs it portals out of its own tree. A row
 * menu's backdrop is deliberately absent — pressing off the menu closes the menu,
 * and the library with it.

/** The drawer header: section tabs, the active view, scope, and the actions. */
export function LibraryHeader({
  tab,
  counts,
  canManageTrash,
  onTab,
  activeViewName,
  onExitView,
  scope,
  onScope,
  activeBoardId,
  activeBoardName,
  full,
  onFull,
  selectableCount,
  selecting,
  onToggleSelecting,
  onCreateInInbox,
  trashCount,
  onEmptyTrash,
  onClose,
}: {
  tab: LibraryTab;
  counts: Partial<Record<LibraryTab, number>>;
  canManageTrash: boolean;
  onTab: (tab: LibraryTab) => void;
  activeViewName: string | null;
  onExitView: () => void;
  scope: "all" | "board";
  onScope: (scope: "all" | "board") => void;
  activeBoardId: string | null;
  activeBoardName: string | null;
  full: boolean;
  onFull: (full: boolean) => void;
  /** Rows a selection could hold; zero hides the Select button. */
  selectableCount: number;
  selecting: boolean;
  onToggleSelecting: () => void;
  onCreateInInbox: () => void;
  trashCount: number;
  onEmptyTrash: () => void;
  onClose: () => void;
}) {
  const [confirmingEmptyTrash, setConfirmingEmptyTrash] = useState(false);
  const trashNoun = trashCount === 1 ? "card" : "cards";
  const tabs = TABS.filter((entry) => canManageTrash || entry.id !== "trash");

  return (
    <div className="library-header flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5">
      <div
        role="tablist"
        aria-label="Library sections"
        className="flex items-center gap-1"
        // One tab stop for the strip, arrows inside it: the role promises it,
        // and three tabs in the tab order made the drawer a maze.
        onKeyDown={(event) =>
          tabKeyDown(
            event,
            tabs.findIndex((entry) => entry.id === tab),
            tabs.length,
            (index) => {
              const next = tabs[index];
              if (next === undefined) return;
              onTab(next.id);
              document.getElementById(`library-tab-${next.id}`)?.focus();
            },
          )
        }
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`library-tab-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            aria-selected={tab === entry.id}
            data-testid={`library-tab-${entry.id}`}
            className="library-tab"
            data-active={tab === entry.id ? "true" : undefined}
            onClick={() => onTab(entry.id)}
          >
            {entry.label}
            <span className="tabular-nums text-[var(--ink-muted)]">{counts[entry.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {activeViewName !== null ? (
        <span
          className="library-tab"
          data-active="true"
          data-testid="library-active-view"
          title="This list is filtered by a saved view"
        >
          <span aria-hidden="true" className="opacity-70">
            {"\u25c7"}
          </span>
          <span className="max-w-[10rem] truncate">{activeViewName}</span>
          <button
            type="button"
            aria-label={`Exit view ${activeViewName}`}
            data-testid="library-exit-view"
            className="-mr-1 ml-0.5 rounded px-0.5 hover:bg-black/10 dark:hover:bg-white/15"
            onClick={onExitView}
          >
            {"\u00d7"}
          </button>
        </span>
      ) : null}

      {tab === "cards" ? (
        <div className="library-scope" data-testid="library-scope">
          <button
            type="button"
            data-testid="library-scope-all"
            className="library-tab"
            data-active={scope === "all" ? "true" : undefined}
            aria-pressed={scope === "all"}
            onClick={() => onScope("all")}
          >
            All
          </button>
          <button
            type="button"
            data-testid="library-scope-board"
            className="library-tab max-w-[10rem]"
            data-active={scope === "board" ? "true" : undefined}
            aria-pressed={scope === "board"}
            disabled={!activeBoardId}
            title={activeBoardName ?? "Active board"}
            onClick={() => onScope("board")}
          >
            <span className="truncate">{activeBoardName ?? "Board"}</span>
          </button>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        {/* The drawer floats so a row can be dragged onto the board beside it; a
            library with six sections is also a browser, and browsing wants the
            window. Both are the same component and the same rows, and this is
            one button in the header's action group rather than a second mode. */}
        <button
          type="button"
          aria-pressed={full}
          aria-label={full ? "Restore the library drawer" : "Expand the library"}
          title={full ? "Restore the library drawer" : "Expand the library"}
          data-testid="library-expand"
          className="library-action"
          onClick={() => onFull(!full)}
        >
          {/* Bidirectional arrows rather than a box or a cross: a cross next to
              the drawer's own close button would read as a second close. */}
          {full ? "\u2921" : "\u2922"}
        </button>
        {selectableCount > 0 || selecting ? (
          <button
            type="button"
            aria-pressed={selecting}
            data-testid="library-select-toggle"
            className="library-action"
            data-active={selecting ? "true" : undefined}
            title={selecting ? "Leave selection" : "Select rows to act on them together"}
            onClick={onToggleSelecting}
          >
            Select
          </button>
        ) : null}
        {tab === "inbox" ? (
          <button
            type="button"
            data-testid="library-new-card"
            className="library-action"
            onClick={onCreateInInbox}
          >
            New
          </button>
        ) : null}
        {tab === "trash" && canManageTrash && trashCount > 0 ? (
          <button
            type="button"
            data-testid="library-empty-trash"
            className="library-action text-red-600"
            onClick={() => setConfirmingEmptyTrash(true)}
          >
            Empty trash
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Close library"
          data-testid="library-close"
          className="library-action library-close"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </div>
      {/* Emptying the trash is permanent: one press used to delete every card
          in it with nothing to undo. The dialog says the number it will take. */}
      {confirmingEmptyTrash ? (
        <Dialog
          title="Empty trash?"
          description={`${trashCount} ${trashNoun} will be deleted for good, with everything written on them. This cannot be undone.`}
          onClose={() => setConfirmingEmptyTrash(false)}
          actions={[
            { label: "Cancel", onSelect: () => {} },
            { label: "Empty trash", danger: true, onSelect: onEmptyTrash },
          ]}
        />
      ) : null}
    </div>
  );
}
