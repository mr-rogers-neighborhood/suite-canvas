import type { PluginKey } from "@tiptap/pm/state";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { type CSSProperties, createElement, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SlashItem } from "./SlashCommands";

export interface SlashMenuProps {
  items: SlashItem[];
  query: string;
  activeIndex: number;
  /** Caret rect in viewport coordinates; the menu is placed just under it. */
  rect: DOMRect | null;
  onHover: (index: number) => void;
  onSelect: (item: SlashItem) => void;
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
export function SlashMenu({ items, query, activeIndex, rect, onHover, onSelect }: SlashMenuProps) {
  const list = useRef<HTMLDivElement | null>(null);

  // Keyboard navigation is driven outside React, so the active row must be
  // brought into view here; otherwise the highlight walks past the scrollport
  // and the list looks like it stopped responding.
  useEffect(() => {
    if (activeIndex < 0 || items.length === 0) return;
    const option = list.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
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
  }, [activeIndex, items]);

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
        items.map((item, index) => (
          <button
            key={item.id}
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
            <span className="min-w-0">
              <span className="block truncate text-[12px]">{item.title}</span>
              <span className="block truncate text-[11px] text-[var(--ink-muted)]">
                {item.hint}
              </span>
            </span>
          </button>
        ))
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
  let state: MenuState = { items: [], query: "", active: 0, rect: null };
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
        onHover: (index: number) => {
          if (index === state.active) return;
          state = { ...state, active: index };
          paint();
        },
        onSelect: (item: SlashItem) => {
          picked = true;
          run?.(item);
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
      state = { items: [], query: "", active: 0, rect: null };
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (picked) return true;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const count = state.items.length;
        if (count === 0) return true;
        state = { ...state, active: (state.active + delta + count) % count };
        paint();
        return true;
      }
      if (event.key === "Enter") {
        const item = state.items[state.active];
        if (!item) return false;
        event.preventDefault();
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
