import type { PluginKey } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { type CSSProperties, createElement, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SlashItem, SlashLevel } from "./SlashCommands";

export interface SlashMenuProps {
  items: SlashItem[];
  query: string;
  activeIndex: number;
  /** Caret rect in viewport coordinates; the menu is placed just under it. */
  rect: DOMRect | null;
  /**
   * True while the highlighted Heading row is showing its levels.
   *
   * The levels open *in place* rather than as a flyout. A second panel would be a second
   * listbox with no focus of its own — the suggestion plugin keeps focus in the editor — so
   * its rows could be seen but not announced. Expanding under the row keeps one list, one
   * `aria-selected`, and the arrow keys the role promises.
   */
  levelsOpen: boolean;
  /** Which level is highlighted while `levelsOpen`, as an index into the row's `levels`. */
  levelIndex: number;
  onHover: (index: number) => void;
  onSelect: (item: SlashItem) => void;
  onHoverLevel: (index: number) => void;
  onSelectLevel: (level: SlashLevel) => void;
}

const MENU_WIDTH = 260;
const MENU_ESTIMATED_HEIGHT = 300;
const GAP = 6;
const EDGE = 8;

/**
 * Anchors the menu to the caret and keeps it on screen, picking above the caret when
 * there is no room below. Mirrors the mention picker, without Floating UI.
 *
 * The menu is fixed to the viewport, so its width has to give way on a narrow screen: a
 * card in a two-column board can be 200px wide and the window not much wider, and a fixed
 * 260px menu would run off the edge with its hints cut in half.
 */
function menuStyle(rect: DOMRect | null): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? MENU_WIDTH : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const width = Math.max(180, Math.min(MENU_WIDTH, viewportWidth - EDGE * 2));
  const height = Math.min(MENU_ESTIMATED_HEIGHT, Math.round(viewportHeight * 0.6));
  const left = rect ? Math.max(EDGE, Math.min(rect.left, viewportWidth - width - EDGE)) : EDGE;
  const base: CSSProperties = { position: "fixed", left, width };
  if (!rect) return { ...base, top: EDGE };
  const below = rect.bottom + GAP;
  if (below + height > viewportHeight && rect.top > height) {
    return { ...base, bottom: viewportHeight - rect.top + GAP };
  }
  return { ...base, top: below };
}

function optionClass(active: boolean): string {
  return `flex w-full items-start gap-2 rounded px-2 py-1 text-left transition-colors ${
    active
      ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
      : "text-[var(--ink-muted)] hover:bg-[var(--segmented-bg)]"
  }`;
}

/**
 * The `/` menu. Presentational: keyboard state lives in the renderer the
 * suggestion plugin drives, so the list can be mounted outside the React tree.
 */
export function SlashMenu({
  items,
  query,
  activeIndex,
  rect,
  levelsOpen,
  levelIndex,
  onHover,
  onSelect,
  onHoverLevel,
  onSelectLevel,
}: SlashMenuProps) {
  const list = useRef<HTMLDivElement | null>(null);

  // Keyboard navigation is driven outside React, so the active row must be
  // brought into view here; otherwise the highlight walks past the scrollport
  // and the list looks like it stopped responding.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the level index is what moves the highlight inside an open row, so it must re-run the scroll.
  useEffect(() => {
    if (activeIndex < 0 || items.length === 0) return;
    // With the levels open the highlighted row is a level, not an item: scrolling the
    // parent option into view would leave the chosen level below the fold.
    const option = list.current?.querySelector<HTMLElement>(
      levelsOpen
        ? '[role="option"][data-level][aria-selected="true"]'
        : '[role="option"][data-command-id][aria-selected="true"]',
    );
    const menu = list.current;
    if (!option || !menu) return;
    const optionRect = option.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (optionRect.top < menuRect.top) {
      menu.scrollTop -= menuRect.top - optionRect.top;
    } else if (optionRect.bottom > menuRect.bottom) {
      menu.scrollTop += optionRect.bottom - menuRect.bottom;
    }
  }, [activeIndex, items, levelsOpen, levelIndex]);

  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Insert block"
      data-testid="slash-menu"
      className="slash-menu"
      style={menuStyle(rect)}
      // Keep the editor's selection while clicking: the menu is a tool, not a focus target.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length > 0 ? (
        items.map((item, index) => {
          const expanded = levelsOpen && index === activeIndex && item.levels !== undefined;
          return (
            <div key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-testid="slash-option"
                data-command-id={item.id}
                className={optionClass(index === activeIndex)}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(item)}
              >
                <span aria-hidden="true" className="slash-option-glyph">
                  {item.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">{item.title}</span>
                  <span className="block truncate text-[11px] text-[var(--ink-muted)]">
                    {item.hint}
                  </span>
                </span>
                {item.levels === undefined ? null : (
                  <span aria-hidden="true" className="text-[9px] opacity-70">
                    {expanded ? "\u25be" : "\u25b8"}
                  </span>
                )}
              </button>
              {expanded
                ? item.levels?.map((level, levelAt) => (
                    <button
                      key={`${item.id}-${String(level.level)}`}
                      type="button"
                      role="option"
                      aria-selected={levelAt === levelIndex}
                      data-testid="slash-level"
                      data-level={level.level}
                      className={`${optionClass(levelAt === levelIndex)} pl-7`}
                      onMouseEnter={() => onHoverLevel(levelAt)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onSelectLevel(level)}
                    >
                      <span aria-hidden="true" className="slash-option-glyph">
                        {level.glyph}
                      </span>
                      <span className="min-w-0 truncate text-[12px]">{level.title}</span>
                    </button>
                  ))
                : null}
            </div>
          );
        })
      ) : (
        <p className="px-2 py-1 text-[12px] text-[var(--ink-muted)]" data-testid="slash-empty">
          {query.trim() ? "Nothing matches" : "No blocks"}
        </p>
      )}
    </div>
  );
}

interface MenuState {
  items: SlashItem[];
  query: string;
  active: number;
  rect: DOMRect | null;
  /** True while the highlighted Heading row shows its levels. */
  levelsOpen: boolean;
  /** Which level is highlighted, as an index into `levels` (0 is body text). */
  level: number;
}

/**
 * The level a query names, if it names one. `/h3` asks for a heading and says which; `/text`
 * asks to go back to body text. Anything else leaves the choice to the list.
 */
function namedLevel(query: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  if (["p", "paragraph", "text", "body", "plain"].includes(needle)) return 0;
  const match = /^h([1-6])$/.exec(needle);
  return match ? Number(match[1]) : null;
}

/**
 * A level as the one thing the suggestion plugin can command.
 *
 * `run` goes through `props.command`, which is what deletes the typed `/query` and exits the
 * suggestion; applying the level directly would leave both behind.
 */
function levelItem(level: SlashLevel): SlashItem {
  return {
    id: `heading-${String(level.level)}`,
    title: level.title,
    hint: "",
    glyph: level.glyph,
    keywords: [],
    run: level.apply,
  };
}

/**
 * Drives the menu for one suggestion plugin. `pluginKey` is what lets Escape,
 * blur and outside clicks exit only this suggestion, not the mention picker.
 */
export function createSlashRenderer(pluginKey: PluginKey) {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let editorDom: HTMLElement | null = null;
  let blurListener: (() => void) | null = null;
  let state: MenuState = {
    items: [],
    query: "",
    active: 0,
    rect: null,
    levelsOpen: false,
    level: 2,
  };
  let run: ((item: SlashItem) => void) | null = null;
  let picked = false;

  const paint = () => {
    if (!root) return;
    root.render(
      createElement(SlashMenu, {
        items: state.items,
        query: state.query,
        activeIndex: state.active,
        rect: state.rect,
        levelsOpen: state.levelsOpen,
        levelIndex: state.level,
        onHover: (index: number) => {
          if (index === state.active) return;
          // A different row means a different question; the levels belong to one row.
          state = { ...state, active: index, levelsOpen: false };
          paint();
        },
        onSelect: (item: SlashItem) => {
          if (item.levels === undefined) {
            picked = true;
            run?.(item);
            return;
          }
          const named = namedLevel(state.query);
          if (named !== null) {
            const level = item.levels[named];
            if (level) {
              picked = true;
              run?.(levelItem(level));
            }
            return;
          }
          state = { ...state, levelsOpen: true, level: 2 };
          paint();
        },
        onHoverLevel: (index: number) => {
          if (index === state.level) return;
          state = { ...state, level: index };
          paint();
        },
        onSelectLevel: (level: SlashLevel) => {
          picked = true;
          run?.(levelItem(level));
        },
      }),
    );
  };

  const setFromProps = (props: SuggestionProps<SlashItem, SlashItem>) => {
    run = (item) => props.command(item);
    const queryChanged = props.query !== state.query;
    state = {
      items: props.items,
      query: props.query,
      // A new query starts from the best match, not wherever the cursor was.
      active: queryChanged ? 0 : Math.min(state.active, Math.max(0, props.items.length - 1)),
      rect: props.clientRect?.() ?? null,
      // A keystroke is a new question, so the level list closes: `/h3` has to narrow the
      // list rather than leave a submenu open over it.
      levelsOpen: queryChanged ? false : state.levelsOpen,
      level: queryChanged ? (namedLevel(props.query) ?? 2) : state.level,
    };
    paint();
  };

  const detachBlur = () => {
    if (editorDom && blurListener) editorDom.removeEventListener("blur", blurListener);
    editorDom = null;
    blurListener = null;
  };

  const teardown = () => {
    detachBlur();
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    run = null;
  };

  return {
    onStart: (props: SuggestionProps<SlashItem, SlashItem>) => {
      container = document.createElement("div");
      container.className = "slash-menu-layer";
      document.body.appendChild(container);
      root = createRoot(container);
      setFromProps(props);

      // The plugin does not watch focus; a click into the panel or toolbar
      // must close the menu instead of leaving it over a stale caret.
      editorDom = props.editor.view.dom;
      blurListener = () => {
        // A card can unmount with the menu open; the view is gone by then.
        if (props.editor.isDestroyed) return;
        exitSuggestion(props.editor.view, pluginKey);
      };
      editorDom.addEventListener("blur", blurListener);
    },
    onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => {
      picked = false;
      setFromProps(props);
    },
    onExit: () => {
      teardown();
      state = { items: [], query: "", active: 0, rect: null, levelsOpen: false, level: 2 };
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (picked) return true;
      const item = state.items[state.active];
      const levels = item?.levels ?? [];

      if (state.levelsOpen) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (levels.length === 0) return true;
          const delta = event.key === "ArrowDown" ? 1 : -1;
          state = {
            ...state,
            level: (state.level + delta + levels.length) % levels.length,
          };
          paint();
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const level = levels[state.level];
          if (level) {
            picked = true;
            run?.(levelItem(level));
          }
          return true;
        }
        if (event.key === "ArrowLeft" || event.key === "Escape") {
          // Back to the rows, not out of the menu: the reader asked to change their mind
          // about the level, not to abandon the block they are inserting.
          event.preventDefault();
          state = { ...state, levelsOpen: false };
          paint();
          return true;
        }
        // Anything else is typing, which narrows the query and closes the levels in onUpdate.
        return false;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const count = state.items.length;
        if (count === 0) return true;
        state = { ...state, active: (state.active + delta + count) % count };
        paint();
        return true;
      }
      if (event.key === "ArrowRight" && item?.levels !== undefined) {
        event.preventDefault();
        state = { ...state, levelsOpen: true, level: namedLevel(state.query) ?? 2 };
        paint();
        return true;
      }
      if (event.key === "Enter") {
        if (!item) return false;
        event.preventDefault();
        if (item.levels !== undefined) {
          const named = namedLevel(state.query);
          const level = named === null ? undefined : item.levels[named];
          if (level) {
            // `/h3` + Enter applies H3 without a second step, which is the whole point of
            // typing the level.
            picked = true;
            run?.(levelItem(level));
            return true;
          }
          state = { ...state, levelsOpen: true, level: 2 };
          paint();
          return true;
        }
        picked = true;
        run?.(item);
        return true;
      }
      if (event.key === "Escape") {
        // The plugin exits the suggestion itself; the typed `/query` stays.
        return true;
      }
      return false;
    },
  };
}
