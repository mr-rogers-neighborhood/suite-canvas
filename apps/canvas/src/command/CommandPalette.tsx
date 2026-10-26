import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useUiStore } from "../store/useUiStore";
import { type PaletteItem, paletteGroups, rankPaletteItems } from "./paletteRank";

export interface CommandPaletteProps {
  items: readonly PaletteItem[];
  onClose: () => void;
}

/**
 * The one keyboard surface that reaches the whole app: type a board, a card, a
 * view, a section or an action, press Enter. It never owns state beyond its
 * query and the highlighted row, so closing it leaves nothing behind.
 *
 * Rows come from the command registry through `paletteProviders`; ordering
 * comes from `paletteRank`, so a different matcher is a change in one file and
 * a different command is a change in the registry — never in this component.
 */
const MAX_ROWS = 40;

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panel = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const listbox = useRef<HTMLDivElement | null>(null);

  const ranked = useMemo(() => rankPaletteItems(items, query).slice(0, MAX_ROWS), [items, query]);
  const groups = useMemo(() => paletteGroups(ranked), [ranked]);

  // The palette exists to take the keyboard, so the search box owns it from the
  // first frame; the panel only catches keys when the box has lost focus.
  useEffect(() => {
    input.current?.focus();
  }, []);

  useEscapeLayer(onClose);
  useFocusTrap(panel);

  const run = (item: PaletteItem) => {
    onClose();
    // The row's work may open a dialog or move the camera; running after the
    // close keeps the palette off screen when that happens.
    item.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (ranked.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + delta + ranked.length) % ranked.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = ranked[activeIndex];
      if (item) run(item);
    }
  };

  // Keep the highlighted row in view when the selection moves past the fold.
  useEffect(() => {
    const row = listbox.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    // jsdom has no layout, so the scroll is optional rather than assumed.
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  let index = -1;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh]">
      <button
        type="button"
        aria-label="Close the command palette"
        className="absolute inset-0 cursor-default border-0 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] shadow-2xl outline-none"
      >
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-2">
          <span aria-hidden="true" className="text-[13px] text-[var(--ink-muted)]">
            {"\u2318"}
          </span>
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // A new search starts at its best match, in the same update that
              // changes the query; an effect would leave one frame where Enter
              // could run the row the reader just typed away.
              setActiveIndex(0);
            }}
            aria-label="Search boards, cards, views and actions"
            aria-controls="command-palette-list"
            aria-activedescendant={
              ranked[activeIndex] ? `palette-row-${ranked[activeIndex].id}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            data-testid="command-palette-input"
            placeholder="Go to a board, a card, a view, or run a command…"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--ink-muted)]"
          />
          <kbd className="hidden shrink-0 rounded border border-[var(--hairline)] px-1 text-[10px] text-[var(--ink-muted)] sm:inline">
            esc
          </kbd>
        </div>

        <div
          ref={listbox}
          id="command-palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto p-1"
          data-testid="command-palette-results"
        >
          {ranked.length === 0 ? (
            <p
              className="px-3 py-4 text-center text-[12px] text-[var(--ink-muted)]"
              data-testid="command-palette-empty"
            >
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.group}>
                <p className="px-3 pt-2 pb-1 text-[10px] font-medium tracking-wide text-[var(--ink-muted)] uppercase">
                  {group.group}
                </p>
                {group.items.map((item) => {
                  index += 1;
                  const rowIndex = index;
                  const active = rowIndex === activeIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      id={`palette-row-${item.id}`}
                      aria-selected={active}
                      data-index={rowIndex}
                      data-command-id={item.commandId}
                      data-testid="command-palette-row"
                      className={`flex w-full items-baseline gap-2 rounded px-3 py-1.5 text-left text-[12px] ${
                        active
                          ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
                          : "text-[var(--ink)] hover:bg-[var(--segmented-bg)]"
                      }`}
                      onPointerMove={() => setActiveIndex(rowIndex)}
                      onClick={() => run(item)}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.subtitle ? (
                        <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Mounts the palette when the store says so; the shell renders this once. */
export function CommandPaletteHost({ items }: { items: readonly PaletteItem[] }) {
  const open = useUiStore((state) => state.paletteOpen);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  if (!open) return null;
  return <CommandPalette items={items} onClose={() => setPaletteOpen(false)} />;
}
