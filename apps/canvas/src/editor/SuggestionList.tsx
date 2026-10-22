import type { Card } from "@suite/graph";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import { type CSSProperties, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useCanvasStore } from "../store/useCanvasStore";
import { workspaceSnapshotStore } from "../store/workspaceSnapshotStore";
import type { MentionStorage } from "./Mention";
import { mentionGhostKey } from "./mentionGhost";

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
  /** A card's fields, shown under it because that card is selected. */
  nested?: boolean;
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

function optionClass(active: boolean, nested: boolean): string {
  return `flex w-full items-center gap-2 truncate rounded py-1 pr-2 text-left text-[12px] transition-colors ${
    nested ? "pl-5" : "pl-2"
  } ${
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
        items.map((item, index) => {
          const nested = item.nested === true;
          // A card that has fields advertises them, so the submenu is not a
          // surprise: the chevron and count say "there is more under here".
          const fields = item.kind === "card" ? cardFieldRows(item.id).length : 0;
          return (
            <button
              key={itemKey(item)}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-testid="mention-option"
              data-kind={item.kind}
              data-nested={nested ? "true" : undefined}
              data-card-id={item.cardId ?? item.id}
              className={optionClass(index === activeIndex, nested)}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(item)}
            >
              <span aria-hidden="true" className="w-3 shrink-0 text-center">
                {nested ? "\u00b7" : item.glyph}
              </span>
              {/* Under its card the name would only repeat what the parent row
                  says, so the submenu shows the field on its own. */}
              <span className="truncate" title={item.title}>
                {nested ? item.title.split(" \u00b7 ").pop() : item.title}
              </span>
              {item.kind === "card" && fields > 0 ? (
                <span
                  data-testid="mention-option-submenu"
                  title={`${fields} field${fields === 1 ? "" : "s"} available`}
                  className="ml-auto shrink-0 text-[11px] text-[var(--ink-muted)]"
                >
                  {fields} {"\u203a"}
                </span>
              ) : item.kind === "card" ? null : (
                <span
                  data-testid="mention-option-kind"
                  className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]"
                >
                  {item.kind === "field" ? "Field" : "Link"}
                </span>
              )}
            </button>
          );
        })
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
 * One card's fields as `@card.field` rows — links to the value, not copies. The
 * title carries the card so a drilled-in list still says what it belongs to.
 */
function referenceRowsFor(card: Card, needle: string): MentionSuggestionItem[] {
  const workspace = useCanvasStore.getState().workspace;
  const title = workspace.displayTitle(card.id);
  const glyph =
    currentSnapshot().types.find((type) => type.id === card.primaryTypeId)?.glyph ?? "\u25c7";
  return workspace
    .viewCardFields(card)
    .filter((view) => !needle || view.field.name.toLocaleLowerCase().includes(needle))
    .map((view) => ({
      id: `reference:${card.id}:${view.field.id}`,
      title: `${title} \u00b7 ${view.field.name}`,
      glyph,
      kind: "reference" as const,
      cardId: card.id,
      fieldId: view.field.id,
    }));
}

/** Cards a `.`-query or an exact-title query can point at. */
function otherCards(ownCardId: string): Card[] {
  return currentSnapshot().cards.filter((card) => !card.deletedAt && card.id !== ownCardId);
}

/** The rows a card can offer as `@card.field`, for the submenu under it. */
export function cardFieldRows(cardId: string): MentionSuggestionItem[] {
  const workspace = useCanvasStore.getState().workspace;
  const card = cardId ? workspace.getCard(cardId) : undefined;
  if (!card) return [];
  return referenceRowsFor(card, "").map((row) => ({ ...row, nested: true }));
}

/** Identity of a row across list rebuilds, so the active row can be re-found. */
export function itemKey(item: MentionSuggestionItem): string {
  return `${item.kind}:${item.id}`;
}

/**
 * The list with one card's fields opened under it. This is the submenu: the
 * selected card shows what it can link to without the reader having to know the
 * dot syntax, and nothing is written until a row is picked.
 */
export function expandedRows(
  items: MentionSuggestionItem[],
  cardId: string | null,
): MentionSuggestionItem[] {
  if (!cardId) return items;
  const index = items.findIndex((item) => item.kind === "card" && item.id === cardId);
  if (index < 0) return items;
  // A query that already names the card lists its fields itself.
  if (items.some((item) => item.kind === "reference" && item.cardId === cardId)) return items;
  const rows = cardFieldRows(cardId);
  if (rows.length === 0) return items;
  return [...items.slice(0, index + 1), ...rows, ...items.slice(index + 1)];
}

/**
 * `@card.field` rows for a typed dot: the text before it names a card, the text
 * after it narrows that card's fields.
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

  const workspace = useCanvasStore.getState().workspace;
  return otherCards(ownCardId)
    .filter((card) => workspace.displayTitle(card.id).toLocaleLowerCase().includes(cardPart))
    .flatMap((card) => referenceRowsFor(card, fieldPart));
}

/**
 * The `@` list. This card's own fields come first — they insert a block rather
 * than a link — then cards. Once the query names exactly one other card, that
 * card's fields are appended below it: Enter still inserts the card, and one
 * arrow down starts browsing `@card.field`. A typed dot does the same without
 * needing the name at all. Prefix matches rank above substring matches; ties
 * are alphabetical.
 */
export function rankItems(query: string, cardId = ""): MentionSuggestionItem[] {
  const workspace = useCanvasStore.getState().workspace;
  const types = currentSnapshot().types;
  const glyphOf = (typeId: string) => types.find((type) => type.id === typeId)?.glyph ?? "\u25c7";
  const needle = query.trim().toLocaleLowerCase();

  // A dotted query is asking for a field, so cards themselves step aside.
  if (needle.includes(".")) return referenceItems(needle, cardId).slice(0, 8);

  const matches: { item: MentionSuggestionItem; rank: number }[] = [];
  for (const item of fieldItems(cardId, needle)) {
    matches.push({
      item,
      rank: needle && item.title.toLocaleLowerCase().startsWith(needle) ? 0 : 1,
    });
  }

  const matching: Card[] = [];
  for (const card of otherCards(cardId)) {
    const title = workspace.displayTitle(card.id);
    const haystack = title.toLocaleLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    matching.push(card);
    matches.push({
      item: { id: card.id, title, glyph: glyphOf(card.primaryTypeId), kind: "card" },
      rank: needle && haystack.startsWith(needle) ? 0 : needle ? 1 : 2,
    });
  }

  // One card left in the running: offer its fields, below the card itself.
  const [only] = matching;
  if (matching.length === 1 && only && needle.length >= 2) {
    for (const item of cardFieldRows(only.id)) matches.push({ item, rank: 3 });
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
  /** Card whose fields are open under it, if any. */
  expanded: string | null;
  /** Query at the moment the submenu was opened, so a filter can be measured. */
  openedAt: string;
  loading: boolean;
  rect: DOMRect | null;
}

/**
 * The shadow a row would complete: the rest of its name after what is already
 * typed. Only a card row has one — a field row's name is filtered by text that
 * has nothing to do with the card query.
 */
export function ghostFor(item: MentionSuggestionItem | undefined, query: string): string {
  if (item?.kind !== "card") return "";
  const title = item.title;
  if (!title.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) return "";
  // Nothing to preview once the name is complete or the caret has moved on.
  return title.slice(query.length);
}

function createPickerRenderer() {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let state: PickerState = {
    items: [],
    query: "",
    active: 0,
    // Card whose fields are open under it, and the query the reader opened it at.
    expanded: null,
    openedAt: "",
    loading: false,
    rect: null,
  };
  let run: ((item: MentionSuggestionItem) => void) | null = null;
  let current: SuggestionProps<MentionSuggestionItem, MentionSuggestionItem> | null = null;
  let picked = false;

  /**
   * What has been typed since the submenu opened. While a submenu is open the
   * query is a field filter, not a card search, so the rows come from the card.
   */
  const fieldFilter = () =>
    state.expanded && state.query.startsWith(state.openedAt)
      ? state.query.slice(state.openedAt.length).trim()
      : "";

  /** The list as drawn: base rows plus the open card's fields. */
  const shown = () => {
    if (!state.expanded) return state.items;
    const filter = fieldFilter();
    if (!filter) return expandedRows(state.items, state.expanded);
    const needle = filter.toLocaleLowerCase();
    return cardFieldRows(state.expanded).filter((row) =>
      row.title.toLocaleLowerCase().includes(needle),
    );
  };

  /**
   * Draws the completion as shadow text after the caret. This is the whole
   * preview: nothing is written to the document until a row is picked.
   */
  const syncGhost = () => {
    if (!current) return;
    const { editor, range } = current;
    if (editor.isDestroyed) return;
    const text = ghostFor(shown()[state.active], state.query);
    const previous = mentionGhostKey.getState(editor.state);
    if ((previous?.text ?? "") === text) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(mentionGhostKey, text ? { pos: range.to, text } : null),
    );
  };

  const paint = () => {
    syncGhost();
    if (!root) return;
    root.render(
      createElement(SuggestionList, {
        items: shown(),
        query: state.query,
        activeIndex: state.active,
        loading: state.loading,
        rect: state.rect,
        onHover: (index: number) => setActive(index),
        onSelect: (item: MentionSuggestionItem) => {
          picked = true;
          run?.(item);
        },
      }),
    );
  };

  /**
   * Highlights a row. This deliberately does not open submenus: the list must
   * not change shape because the pointer happens to pass over it, which would
   * move rows under the cursor and make a keystroke land somewhere else.
   */
  const setActive = (index: number) => {
    const rows = shown();
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(index, rows.length - 1));
    if (next === state.active) return;
    state = { ...state, active: next };
    paint();
  };

  /** Enters the open submenu, or opens one and steps into its first field. */
  const enterSubmenu = () => {
    const item = shown()[state.active];
    if (item?.kind !== "card") return;
    const rows = cardFieldRows(item.id);
    if (rows.length === 0) return;
    const next = expandedRows(state.items, item.id);
    const at = next.findIndex((row) => itemKey(row) === itemKey(rows[0] as MentionSuggestionItem));
    state = { ...state, expanded: item.id, openedAt: state.query, active: at < 0 ? 0 : at };
    paint();
  };

  /** Leaves the submenu: the cursor lands back on the card that opened it. */
  const leaveSubmenu = () => {
    const item = shown()[state.active];
    const owner = item?.kind === "reference" ? (item.cardId ?? null) : state.expanded;
    if (!owner) return;
    const parent = state.items.find((row) => row.kind === "card" && row.id === owner);
    // A query that names the card has no card row to return to; it just closes.
    state = { ...state, expanded: null, openedAt: "" };
    const at = parent
      ? expandedRows(state.items, null).findIndex((row) => itemKey(row) === itemKey(parent))
      : 0;
    state = { ...state, active: at < 0 ? 0 : at };
    paint();
  };

  const setFromProps = (props: SuggestionProps<MentionSuggestionItem, MentionSuggestionItem>) => {
    run = (item) => props.command(item);
    current = props;
    const queryChanged = props.query !== state.query;
    const items = props.items;
    // Typing past the point the submenu was opened turns it into a filter over
    // that card's fields; it closes when the query no longer starts with it.
    const stillFiltering = state.expanded !== null && props.query.startsWith(state.openedAt);
    state = {
      items,
      query: props.query,
      // A new query starts from the best match, not wherever the cursor was.
      active: queryChanged ? 0 : state.active,
      expanded: stillFiltering ? state.expanded : null,
      openedAt: stillFiltering ? state.openedAt : "",
      loading: props.loading,
      rect: props.clientRect?.() ?? null,
    };
    paint();
  };

  const clearGhost = () => {
    if (!current || current.editor.isDestroyed) return;
    const { editor } = current;
    if (!mentionGhostKey.getState(editor.state)) return;
    editor.view.dispatch(editor.state.tr.setMeta(mentionGhostKey, null));
  };

  const teardown = () => {
    clearGhost();
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    run = null;
    current = null;
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
      state = {
        items: [],
        query: "",
        active: 0,
        expanded: null,
        openedAt: "",
        loading: false,
        rect: null,
      };
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (picked) return true;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const rows = shown();
        if (rows.length === 0) return true;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive((state.active + delta + rows.length) % rows.length);
        return true;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        enterSubmenu();
        return true;
      }
      if (event.key === "ArrowLeft") {
        if (!state.expanded) return false;
        event.preventDefault();
        leaveSubmenu();
        return true;
      }
      if (event.key === ".") {
        // `.` opens the submenu under the highlighted card, exactly as the
        // chevron promises. The dot itself is not inserted: it is a gesture,
        // not text, so a title with a space is no obstacle.
        const item = shown()[state.active];
        if (item?.kind === "card" && cardFieldRows(item.id).length > 0) {
          event.preventDefault();
          enterSubmenu();
          return true;
        }
        return false;
      }
      if (event.key === "Enter") {
        const item = shown()[state.active];
        if (!item) return false;
        event.preventDefault();
        picked = true;
        clearGhost();
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
