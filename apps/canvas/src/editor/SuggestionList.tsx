import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { type CSSProperties, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCanvasStore } from "../store/useCanvasStore";
import { workspaceSnapshotStore } from "../store/workspaceSnapshotStore";
import type { MentionStorage } from "./Mention";

/**
 * One row of the `@` picker: a card to mention, or one of this card's own
 * fields, which inserts an editable property block instead.
 */
export interface MentionSuggestionItem {
  id: string;
  title: string;
  glyph: string;
  /**
   * `field` is one of this card's own fields, which inserts an editable block;
   * `reference` is a field of another card, which inserts a `@card.field` chip.
   */
  kind: "card" | "field" | "reference";
  /** Set for `field` and `reference`. */
  fieldId?: string;
  /** Set for `reference`: the card the field belongs to. */
  cardId?: string;
}

/** Everything the picker needs to draw itself; owned by the renderer below. */
export interface SuggestionListProps {
  items: MentionSuggestionItem[];
  query: string;
  activeIndex: number;
  loading: boolean;
  /** Caret rect in viewport coordinates; the list is placed just under it. */
  rect: DOMRect | null;
  onHover: (index: number) => void;
  onSelect: (item: MentionSuggestionItem) => void;
}

const LIST_MAX_HEIGHT = 280;
const LIST_WIDTH = 260;
const GAP = 6;

/**
 * Anchors the list to the caret and keeps it on screen. Picking above the caret
 * when there is no room below avoids the list being cut off at the bottom of
 * the window without needing a positioning library.
 */
function listStyle(rect: DOMRect | null): CSSProperties {
  const viewportWidth = typeof window === "undefined" ? LIST_WIDTH : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const left = rect ? Math.max(8, Math.min(rect.left, viewportWidth - LIST_WIDTH - 8)) : 8;
  const base: CSSProperties = { position: "fixed", left, width: LIST_WIDTH };
  if (!rect) return { ...base, top: 8 };
  const below = rect.bottom + GAP;
  if (below + LIST_MAX_HEIGHT > viewportHeight && rect.top > LIST_MAX_HEIGHT) {
    return { ...base, bottom: viewportHeight - rect.top + GAP };
  }
  return { ...base, top: below };
}

function optionClass(active: boolean): string {
  return `flex w-full items-center gap-2 truncate rounded px-2 py-1 text-left text-[12px] transition-colors ${
    active
      ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
      : "text-[var(--ink-muted)] hover:bg-[var(--segmented-bg)]"
  }`;
}

/**
 * The `@` menu. Presentational on purpose: keyboard state lives in the
 * renderer that the suggestion plugin drives, so the list can be mounted
 * outside the React tree without a second source of truth.
 */
export function SuggestionList({
  items,
  query,
  activeIndex,
  loading,
  rect,
  onHover,
  onSelect,
}: SuggestionListProps) {
  return (
    <div
      role="listbox"
      aria-label="Mention a card"
      data-testid="mention-picker"
      className="mention-picker"
      style={listStyle(rect)}
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
            data-testid="mention-option"
            data-kind={item.kind}
            data-card-id={item.id}
            className={optionClass(index === activeIndex)}
            onMouseEnter={() => onHover(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(item)}
          >
            <span aria-hidden="true" className="w-3 shrink-0 text-center">
              {item.glyph}
            </span>
            <span className="truncate">{item.title}</span>
            {item.kind === "card" ? null : (
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                Field
              </span>
            )}
          </button>
        ))
      ) : (
        <p className="px-2 py-1 text-[12px] text-[var(--ink-muted)]" data-testid="mention-empty">
          {loading ? "Searching…" : query.trim() ? "Nothing matches" : "No cards yet"}
        </p>
      )}
    </div>
  );
}

function currentSnapshot() {
  const workspace = useCanvasStore.getState().workspace;
  return workspaceSnapshotStore(workspace).getSnapshot();
}

/**
 * Live titles come from the document, not the schema: a card has no stored
 * title, only its title container (with the body's first line as a fallback).
 */
export function titleForCardId(cardId: string): string {
  if (!cardId) return "";
  return useCanvasStore.getState().workspace.displayTitle(cardId);
}

/** Field name for a `@card.field` mention's plain-text form. */
export function fieldNameForId(cardId: string, fieldId: string): string {
  if (!cardId || !fieldId) return "";
  const workspace = useCanvasStore.getState().workspace;
  const card = workspace.getCard(cardId);
  if (!card) return "";
  return workspace.viewCardFields(card).find((view) => view.field.id === fieldId)?.field.name ?? "";
}

/** The card's own fields, as rows that insert a property block. */
function fieldItems(cardId: string, needle: string): MentionSuggestionItem[] {
  const workspace = useCanvasStore.getState().workspace;
  const card = cardId ? workspace.getCard(cardId) : undefined;
  if (!card) return [];
  return workspace
    .viewCardFields(card)
    .filter((view) => !needle || view.field.name.toLocaleLowerCase().includes(needle))
    .map((view) => ({
      id: `field:${view.field.id}`,
      title: view.field.name,
      glyph: "\u25a4",
      kind: "field" as const,
      fieldId: view.field.id,
    }));
}

/**
 * `@card.field` rows: a typed dot after a card name picks one of its fields.
 * The row is a link to the value rather than a copy of it.
 */
function referenceItems(query: string, ownCardId: string): MentionSuggestionItem[] {
  const dot = query.indexOf(".");
  if (dot <= 0) return [];
  const cardPart = query.slice(0, dot).trim().toLocaleLowerCase();
  const fieldPart = query
    .slice(dot + 1)
    .trim()
    .toLocaleLowerCase();
  if (!cardPart) return [];

  const snapshot = currentSnapshot();
  const workspace = useCanvasStore.getState().workspace;
  const glyphs = new Map(snapshot.types.map((type) => [type.id, type.glyph]));
  const items: MentionSuggestionItem[] = [];
  for (const card of snapshot.cards) {
    if (card.deletedAt || card.id === ownCardId) continue;
    const title = workspace.displayTitle(card.id);
    if (!title.toLocaleLowerCase().includes(cardPart)) continue;
    for (const view of workspace.viewCardFields(card)) {
      const name = view.field.name;
      if (fieldPart && !name.toLocaleLowerCase().includes(fieldPart)) continue;
      items.push({
        id: `reference:${card.id}:${view.field.id}`,
        title: `${title} \u00b7 ${name}`,
        glyph: glyphs.get(card.primaryTypeId) ?? "\u25c7",
        kind: "reference",
        cardId: card.id,
        fieldId: view.field.id,
      });
    }
  }
  return items;
}

/**
 * This card's fields first — they insert a block rather than a link — then
 * cards, then a `card.field` reference once the query names one. Prefix
 * matches rank above substring matches; ties are alphabetical.
 */
export function rankItems(query: string, cardId = ""): MentionSuggestionItem[] {
  const snapshot = currentSnapshot();
  const workspace = useCanvasStore.getState().workspace;
  const glyphs = new Map(snapshot.types.map((type) => [type.id, type.glyph]));
  const needle = query.trim().toLocaleLowerCase();

  const matches: { item: MentionSuggestionItem; rank: number }[] = [];
  for (const item of fieldItems(cardId, needle)) {
    matches.push({
      item,
      rank: needle && item.title.toLocaleLowerCase().startsWith(needle) ? 0 : 1,
    });
  }
  for (const card of snapshot.cards) {
    if (card.deletedAt) continue;
    const title = workspace.displayTitle(card.id);
    const haystack = title.toLocaleLowerCase();
    // A dotted query is asking for a field, so cards themselves step aside.
    if (needle.includes(".") || (needle && !haystack.includes(needle))) continue;
    matches.push({
      item: { id: card.id, title, glyph: glyphs.get(card.primaryTypeId) ?? "\u25c7", kind: "card" },
      rank: needle && haystack.startsWith(needle) ? 0 : needle ? 1 : 2,
    });
  }
  for (const item of referenceItems(needle, cardId)) {
    matches.push({ item, rank: 0 });
  }

  matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.item.title.localeCompare(b.item.title) ||
      a.item.id.localeCompare(b.item.id),
  );
  return matches.slice(0, 8).map(({ item }) => item);
}

interface PickerState {
  items: MentionSuggestionItem[];
  query: string;
  active: number;
  loading: boolean;
  rect: DOMRect | null;
}

function createPickerRenderer() {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let state: PickerState = { items: [], query: "", active: 0, loading: false, rect: null };
  let run: ((item: MentionSuggestionItem) => void) | null = null;
  let picked = false;

  const paint = () => {
    if (!root) return;
    root.render(
      createElement(SuggestionList, {
        items: state.items,
        query: state.query,
        activeIndex: state.active,
        loading: state.loading,
        rect: state.rect,
        onHover: (index: number) => {
          if (index === state.active) return;
          state = { ...state, active: index };
          paint();
        },
        onSelect: (item: MentionSuggestionItem) => {
          picked = true;
          run?.(item);
        },
      }),
    );
  };

  const setFromProps = (props: SuggestionProps<MentionSuggestionItem, MentionSuggestionItem>) => {
    run = (item) => props.command(item);
    const queryChanged = props.query !== state.query;
    state = {
      items: props.items,
      query: props.query,
      // A new query starts from the best match, not wherever the cursor was.
      active: queryChanged ? 0 : Math.min(state.active, Math.max(0, props.items.length - 1)),
      loading: props.loading,
      rect: props.clientRect?.() ?? null,
    };
    paint();
  };

  const teardown = () => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    run = null;
  };

  return {
    onStart: (props: SuggestionProps<MentionSuggestionItem, MentionSuggestionItem>) => {
      container = document.createElement("div");
      container.className = "mention-picker-layer";
      document.body.appendChild(container);
      root = createRoot(container);
      setFromProps(props);
    },
    onUpdate: (props: SuggestionProps<MentionSuggestionItem, MentionSuggestionItem>) => {
      picked = false;
      setFromProps(props);
    },
    onExit: () => {
      teardown();
      state = { items: [], query: "", active: 0, loading: false, rect: null };
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
        // The plugin exits the suggestion itself; just make sure the editor keeps the key.
        return true;
      }
      return false;
    },
  };
}

/**
 * One config, shared by the title and body editors. Item lookup reads the
 * snapshot at call time, so a peer's new card appears without re-configuring
 * either editor.
 */
export const mentionSuggestion: Omit<
  SuggestionOptions<MentionSuggestionItem, MentionSuggestionItem>,
  "editor"
> = {
  char: "@",
  allowSpaces: false,
  startOfLine: false,
  allow: ({ editor }) => editor.isEditable,
  items: ({ query, editor }) =>
    rankItems(query, (editor.storage as { mention?: MentionStorage }).mention?.cardId ?? ""),
  command: ({ editor, range, props }) => {
    const node =
      props.kind === "field"
        ? { type: "propertyBlock", attrs: { fieldId: props.fieldId } }
        : props.kind === "reference"
          ? { type: "mention", attrs: { cardId: props.cardId, fieldId: props.fieldId } }
          : { type: "mention", attrs: { cardId: props.id } };
    editor.chain().focus().insertContentAt(range, node).insertContent(" ").run();
  },
  render: createPickerRenderer,
};
