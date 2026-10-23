import { useEffect, useRef, useState } from "react";
import type { TypeTableRow } from "../ice/useTypeTable";
import { useUiStore } from "../store/useUiStore";

export interface TypeTableProps {
  /** Rows from `useTypeTable` / `typeTableRows`; the panel renders, never counts. */
  rows: readonly TypeTableRow[];
  /**
   * Board the rows were counted from. The row action scopes the library to it;
   * with no board the scope stays "all", matching `useTypeTable`.
   */
  boardId?: string | null;
  /** Camera action owned by the surface: fly to this type's instances. */
  onFrameType: (typeId: string) => void;
  /** Selection is UI state, so this is offered without a capability check. */
  onSelectAll?: (typeId: string) => void;
  /** Document actions; the host owns the write, the panel only asks for it. */
  onPlaceOnView?: (typeId: string) => void;
  onDuplicate?: (typeId: string) => void;
  /** A share viewer gets the same rows and no actions at all. */
  readOnly?: boolean;
  canEditContent?: boolean;
  canEditLayout?: boolean;
}

interface MenuActionProps {
  label: string;
  testId: string;
  disabled?: boolean;
  onSelect: () => void;
}

function MenuAction({ label, testId, disabled = false, onSelect }: MenuActionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      disabled={disabled}
      className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10"
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/**
 * *Types in view*: the inspector's one row per type on the current board. A row
 * is a scoped library (type + board) and a camera target; the per-row menu is
 * where the actions live. Nothing here writes to the document — the two write
 * actions are callbacks the host gates and performs.
 */
export function TypeTable({
  rows,
  boardId = null,
  onFrameType,
  onSelectAll,
  onPlaceOnView,
  onDuplicate,
  readOnly = false,
  canEditContent,
  canEditLayout,
}: TypeTableProps) {
  const typeFilter = useUiStore((state) => state.libraryTypeFilter);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const container = useRef<HTMLElement | null>(null);

  const canCreate = (canEditContent ?? !readOnly) && (canEditLayout ?? !readOnly);
  const hasActions =
    onSelectAll !== undefined || onPlaceOnView !== undefined || onDuplicate !== undefined;

  useEffect(() => {
    if (menuFor === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (container.current?.contains(event.target as Node)) return;
      setMenuFor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuFor(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  /**
   * One type, one board — the facet controls the library already has, so there
   * is no second filtering model. The tab moves to Cards, because that is the
   * only list the type facet scopes: opening Inbox or Trash with a filter that
   * cannot apply would look like the click did nothing.
   */
  const scopeToType = (typeId: string) => {
    setMenuFor(null);
    const ui = useUiStore.getState();
    ui.clearLibraryFilters();
    ui.toggleLibraryType(typeId);
    ui.setLibraryScope(boardId === null ? "all" : "board");
    ui.setLibraryTab("cards");
    ui.setLibraryOpen(true);
    onFrameType(typeId);
  };

  const act = (action: ((typeId: string) => void) | undefined, typeId: string) => {
    setMenuFor(null);
    action?.(typeId);
  };

  return (
    <section
      ref={container}
      className="space-y-2 border-t border-[var(--hairline)] px-3 py-3 first:border-t-0"
      data-testid="type-table"
      aria-label="Types in view"
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Types in view
      </h2>

      {rows.length === 0 ? (
        <p className="text-[11px] text-[var(--ink-muted)]" data-testid="type-table-empty">
          No cards on this view yet.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => {
            const percent = Math.round(row.share * 100);
            const active = typeFilter.length === 1 && typeFilter[0] === row.typeId;
            return (
              <li
                key={row.typeId}
                className="relative"
                data-testid={`type-table-item-${row.typeId}`}
              >
                <div
                  className={`flex items-center gap-1 rounded-lg pr-1 ${
                    active ? "bg-black/5 dark:bg-white/10" : ""
                  }`}
                >
                  <button
                    type="button"
                    data-testid={`type-table-row-${row.typeId}`}
                    aria-pressed={active}
                    className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => scopeToType(row.typeId)}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="w-4 shrink-0 text-center text-[13px] leading-none"
                        style={row.color === undefined ? undefined : { color: row.color }}
                      >
                        {row.glyph}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)]">
                        {row.name}
                      </span>
                      <span
                        className="text-[11px] tabular-nums text-[var(--ink-muted)]"
                        data-testid={`type-table-count-${row.typeId}`}
                      >
                        {row.count}
                      </span>
                    </span>
                    <span
                      className="mt-1 flex h-[3px] w-full overflow-hidden rounded-full bg-[var(--hairline)]"
                      aria-hidden="true"
                      data-testid={`type-table-share-${row.typeId}`}
                      data-share={row.share}
                    >
                      <span
                        className="h-full rounded-full bg-[var(--ink-muted)]"
                        style={{ width: `${row.share * 100}%` }}
                      />
                    </span>
                    <span className="sr-only">{`${percent}% of the cards on this view`}</span>
                  </button>

                  {readOnly || !hasActions ? null : (
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={menuFor === row.typeId}
                      aria-label={`Actions for ${row.name}`}
                      data-testid={`type-table-actions-${row.typeId}`}
                      className="rounded px-1.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() =>
                        setMenuFor((open) => (open === row.typeId ? null : row.typeId))
                      }
                    >
                      {"\u22ef"}
                    </button>
                  )}
                </div>

                {menuFor === row.typeId ? (
                  <div
                    role="menu"
                    aria-label={`Actions for ${row.name}`}
                    data-testid={`type-table-menu-${row.typeId}`}
                    className="absolute right-1 top-full z-10 w-44 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
                  >
                    {onSelectAll === undefined ? null : (
                      <MenuAction
                        label="Select all in type"
                        testId={`type-table-select-${row.typeId}`}
                        onSelect={() => act(onSelectAll, row.typeId)}
                      />
                    )}
                    {onPlaceOnView === undefined ? null : (
                      <MenuAction
                        label="Place on this view"
                        testId={`type-table-place-${row.typeId}`}
                        disabled={!canCreate}
                        onSelect={() => act(onPlaceOnView, row.typeId)}
                      />
                    )}
                    {onDuplicate === undefined ? null : (
                      <MenuAction
                        label="Duplicate"
                        testId={`type-table-duplicate-${row.typeId}`}
                        disabled={!canCreate}
                        onSelect={() => act(onDuplicate, row.typeId)}
                      />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
