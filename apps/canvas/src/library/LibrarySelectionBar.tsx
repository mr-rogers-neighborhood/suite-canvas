import type { CanvasMode } from "../canvas/links/linkGesture";

/** The verb a run's shape is called when it applies to a set of rows. */
const VERB_LABELS: Record<CanvasMode, string> = {
  place: "Place",
  thread: "Thread",
  fan: "Fan",
};

/** The selection bar: the four run verbs, one at a time, and clear/all. */
export function LibrarySelectionBar({
  selected,
  /** The selected rows a run can place: a board is a row, but there is nothing to place. */
  runnable,
  canManageTrash,
  onRun,
  onRunLoop,
  onTrash,
  onSelectAll,
  onClear,
}: {
  /** Selected row ids, in the order they appear on screen. */
  selected: readonly string[];
  /** The selected ids a run can place, in the same order. */
  runnable: readonly string[];
  canManageTrash: boolean;
  onRun: (mode: CanvasMode) => void;
  onRunLoop: (ids: readonly string[]) => void;
  onTrash: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="library-selection flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5"
      data-testid="library-selection"
    >
      <span
        className="mr-1 text-[11px] font-medium text-[var(--ink)]"
        data-testid="library-selection-count"
      >
        {`${selected.length} selected`}
      </span>
      {selected.length > runnable.length ? (
        // A board in the selection is not a card in the hand, and the count says so
        // rather than leaving the reader to wonder where two rows went.
        <span
          className="mr-1 text-[11px] text-[var(--ink-muted)]"
          data-testid="library-selection-skip"
        >
          {`· ${runnable.length} can be placed`}
        </span>
      ) : null}
      {selected.length === 0 ? (
        // The bar appears with the mode, not with the first row: an empty mode
        // with no visible verbs is a mode a reader has to guess at.
        <span className="mr-1 text-[11px] text-[var(--ink-muted)]">
          Pick rows to act on them together
        </span>
      ) : null}
      {(["place", "thread", "fan"] as const).map((verb) => (
        <button
          key={verb}
          type="button"
          className="library-action"
          data-testid={`library-run-${verb}`}
          // The same values the widget bar and the connector menu use, so
          // "fan is blue" holds here too (ADR-0064 fifth amendment).
          data-mode={verb}
          // A selection of boards is a selection with nothing to place; the verb says so
          // instead of starting a run that would immediately end.
          disabled={runnable.length === 0}
          // The verb is the mode: "Thread cards" is thread mode plus a queue.
          onClick={() => onRun(verb)}
        >
          {runnable.length === selected.length
            ? `${VERB_LABELS[verb]} cards`
            : `${VERB_LABELS[verb]} ${runnable.length}`}
        </button>
      ))}
      <button
        type="button"
        className="library-action"
        data-testid="library-run-loop"
        disabled={runnable.length === 0}
        title="Place these one at a time, coming back here for the next"
        onClick={() => {
          // The loop places one and stays live, so the next pick joins the same
          // sequence instead of starting another (ADR-0063 §6).
          if (runnable.length === 0) return;
          onRunLoop(runnable);
        }}
      >
        One at a time
      </button>
      {canManageTrash ? (
        <button
          type="button"
          className="library-action text-red-600"
          data-testid="library-selection-trash"
          disabled={selected.length === 0}
          onClick={() => {
            for (const id of selected) onTrash(id);
            onClear();
          }}
        >
          Trash
        </button>
      ) : null}
      <button
        type="button"
        className="ml-auto library-action"
        data-testid="library-selection-all"
        onClick={onSelectAll}
      >
        All
      </button>
      <button
        type="button"
        className="library-action"
        data-testid="library-selection-clear"
        onClick={onClear}
      >
        Clear
      </button>
    </div>
  );
}
