/** The selection bar: what a set of picked rows can be acted on with. */
export function LibrarySelectionBar({
  selected,
  canManageTrash,
  onPlace,
  onTrash,
  onSelectAll,
  onClear,
}: {
  /** Selected row ids, in the order they appear on screen. */
  selected: readonly string[];
  canManageTrash: boolean;
  /** Put the picked rows in the reader's hand, to place one press at a time. */
  onPlace: (ids: readonly string[]) => void;
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
      {selected.length === 0 ? (
        // The bar appears with the mode, not with the first row: an empty mode
        // with nothing to act on is a mode a reader has to guess at.
        <span className="mr-1 text-[11px] text-[var(--ink-muted)]">
          Pick rows to act on them together
        </span>
      ) : null}
      <button
        type="button"
        className="library-action"
        data-testid="library-place-cards"
        disabled={selected.length === 0}
        title="Carry these cards and put them down one at a time"
        onClick={() => onPlace(selected)}
      >
        {selected.length > 0 ? `Place ${selected.length}` : "Place cards"}
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
