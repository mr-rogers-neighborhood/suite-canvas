import type { CardType, PropertyValue, Tag } from "@suite/graph";
import { typePluralName } from "@suite/graph";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryScope, LibraryTab } from "../store/useUiStore";
import { LibraryCardPanel } from "./LibraryCardPanel";
import {
  facetCounts,
  filterItems,
  groupBySection as groupSections,
  type SectionOrderEntry,
  UNSORTED_SECTION,
} from "./libraryFilters";

export interface LibraryItem {
  id: string;
  title: string;
  boards: Array<{ id: string; name: string }>;
  typeIds: string[];
  tagIds: string[];
  /** The card's section on the scoped board plus its ancestors, innermost first. */
  sectionIds: string[];
  properties: Record<string, PropertyValue>;
}

export interface LibraryDrawerProps {
  open: boolean;
  tab: LibraryTab;
  counts: Record<LibraryTab, number>;
  inbox: LibraryItem[];
  cards: LibraryItem[];
  trash: LibraryItem[];
  onTab: (tab: LibraryTab) => void;
  onClose: () => void;
  onPlace: (cardId: string) => void;
  onCreateInInbox: () => void;
  onTrash: (cardId: string) => void;
  onRestore: (cardId: string) => void;
  onDeleteForever: (cardId: string) => void;
  onEmptyTrash: () => void;
  onGoToBoard: (boardId: string) => void;
  /** Pointer drop over the canvas, in client coordinates. */
  onDropAt: (cardId: string, point: { x: number; y: number }) => void;
  types: CardType[];
  tags: Tag[];
  typeFilter: string[];
  tagFilter: string[];
  onToggleType: (id: string) => void;
  onToggleTag: (id: string) => void;
  onClearFilters: () => void;
  /** Board that scopes the Cards tab, and the name the scope control shows. */
  activeBoardId: string | null;
  activeBoardName: string | null;
  scope: LibraryScope;
  onScope: (scope: LibraryScope) => void;
  sectionFilter: string[];
  onToggleSection: (id: string) => void;
  /** Sections of the active board in outline order. */
  sectionOrder: SectionOrderEntry[];
  groupBySection: boolean;
  onToggleGroup: () => void;
  /** Card whose panel is open; at most one at a time. */
  expandedRowId: string | null;
  onExpandRow: (cardId: string | null) => void;
  /** Replaces the store-connected panel in stories and tests. */
  renderRowPanel?: (cardId: string) => ReactNode;
}

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "cards", label: "Cards" },
  { id: "trash", label: "Trash" },
];

const HOLD_THRESHOLD = 4;

export function LibraryDrawer({
  open,
  tab,
  counts,
  inbox,
  cards,
  trash,
  onTab,
  onClose,
  onPlace,
  onCreateInInbox,
  onTrash,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
  onGoToBoard,
  onDropAt,
  types,
  tags,
  typeFilter,
  tagFilter,
  onToggleType,
  onToggleTag,
  onClearFilters,
  activeBoardId,
  activeBoardName,
  scope,
  onScope,
  sectionFilter,
  onToggleSection,
  sectionOrder,
  groupBySection,
  onToggleGroup,
  expandedRowId,
  onExpandRow,
  renderRowPanel = (cardId) => <LibraryCardPanel cardId={cardId} />,
}: LibraryDrawerProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [hold, setHold] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const holdRef = useRef<{
    cardId: string;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setHold(null);
  }, [open]);

  // Scope is a Cards-tab idea, and so is the row panel: leaving either collapses it.
  useEffect(() => {
    if (!open || tab !== "cards") onExpandRow(null);
  }, [open, tab, onExpandRow]);

  // Pointer-based hold: the row lifts into a ghost that follows the cursor, and
  // dropping over the canvas places the card there.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = holdRef.current;
      if (!current) return;
      const far =
        Math.abs(event.clientX - current.startX) > HOLD_THRESHOLD ||
        Math.abs(event.clientY - current.startY) > HOLD_THRESHOLD;
      if (!far && !current.dragging) return;
      current.dragging = true;
      setHold((previous) =>
        previous ? { ...previous, x: event.clientX, y: event.clientY } : null,
      );
    };

    const up = (event: PointerEvent) => {
      const current = holdRef.current;
      holdRef.current = null;
      setHold(null);
      if (!current?.dragging) return;
      const canvas = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-testid="canvas-board"]');
      if (canvas) onDropAt(current.cardId, { x: event.clientX, y: event.clientY });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [onDropAt]);

  const boardScope = tab === "cards" && scope === "board" && activeBoardId !== null;
  const items = tab === "inbox" ? inbox : tab === "cards" ? cards : trash;
  const scopedItems = boardScope
    ? items.filter((item) => item.boards.some((board) => board.id === activeBoardId))
    : items;
  const activeSectionFilter = boardScope ? sectionFilter : [];
  const countsByFacet = facetCounts(scopedItems, typeFilter, tagFilter, activeSectionFilter);
  const visible = filterItems(scopedItems, typeFilter, tagFilter, activeSectionFilter);
  const filtering = typeFilter.length > 0 || tagFilter.length > 0 || activeSectionFilter.length > 0;
  const grouped = boardScope && groupBySection ? groupSections(visible, sectionOrder) : null;
  const wide = boardScope || expandedRowId !== null;
  const sectionsById = new Map(sectionOrder.map((section) => [section.id, section]));
  // The open row fell out of the facet or out of scope; do not keep a stale panel.
  const staleExpanded =
    expandedRowId !== null && tab === "cards" && !visible.some((item) => item.id === expandedRowId);

  useEffect(() => {
    if (staleExpanded) onExpandRow(null);
  }, [staleExpanded, onExpandRow]);

  // The list scrolls inside a capped drawer; open the panel where the reader is
  // looking instead of below the fold.
  useEffect(() => {
    if (!expandedRowId || !open) return;
    panel.current
      ?.querySelector(`[data-row-id="${expandedRowId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [expandedRowId, open]);

  if (!open) return null;

  const sectionLabel = (item: LibraryItem): string => {
    const owner = item.sectionIds.find((id) => sectionsById.has(id));
    return owner ? (sectionsById.get(owner)?.title ?? "Untitled section") : "Unsorted";
  };

  const renderRow = (item: LibraryItem) => {
    const expanded = tab === "cards" && expandedRowId === item.id;
    return (
      <li key={item.id} className="library-entry" data-row-id={item.id}>
        <div
          data-testid={`library-item-${item.id}`}
          className="library-row"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (
              (event.target as HTMLElement).closest(
                'button, input, textarea, select, [contenteditable="true"], [data-testid="library-row-panel"]',
              )
            ) {
              return;
            }
            // Keep the gesture from selecting text across the board.
            event.preventDefault();
            holdRef.current = {
              cardId: item.id,
              startX: event.clientX,
              startY: event.clientY,
              dragging: false,
            };
            setHold({ item, x: event.clientX, y: event.clientY });
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px]">{item.title}</p>
            {item.tagIds.length > 0 ? (
              <p className="truncate text-[10px] text-[var(--ink-muted)]">
                {item.tagIds
                  .map((id) => tags.find((tag) => tag.id === id))
                  .filter((tag): tag is Tag => tag !== undefined)
                  .map((tag) => `#${tag.name}`)
                  .join(" ")}
              </p>
            ) : null}
            {boardScope ? (
              <p
                className="truncate text-[10px] text-[var(--ink-muted)]"
                data-testid="library-row-meta"
              >
                {sectionLabel(item)}
                {" \u00b7 "}
                {activeBoardName ?? "This board"}
              </p>
            ) : item.boards.length > 0 ? (
              <p className="truncate text-[10px] text-[var(--ink-muted)]">
                {item.boards.map((board) => board.name).join(" \u00b7 ")}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {tab === "trash" ? (
              <>
                <button type="button" className="library-action" onClick={() => onRestore(item.id)}>
                  Restore
                </button>
                <button
                  type="button"
                  className="library-action text-red-600"
                  onClick={() => onDeleteForever(item.id)}
                >
                  Delete
                </button>
              </>
            ) : (
              <>
                {item.boards.length > 0 ? (
                  <button
                    type="button"
                    className="library-action"
                    onClick={() => onGoToBoard(item.boards[0]?.id ?? "")}
                  >
                    Open
                  </button>
                ) : null}
                <button type="button" className="library-action" onClick={() => onPlace(item.id)}>
                  Place
                </button>
                <button
                  type="button"
                  className="library-action text-red-600"
                  onClick={() => onTrash(item.id)}
                >
                  Trash
                </button>
                {tab === "cards" ? (
                  <button
                    type="button"
                    className="library-row-expand"
                    data-testid="library-row-expand"
                    aria-expanded={expanded}
                    aria-controls={expanded ? `library-row-panel-${item.id}` : undefined}
                    aria-label={expanded ? `Close ${item.title}` : `Open ${item.title}`}
                    // Disclosure must not take focus from an editor that owns it.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onExpandRow(expanded ? null : item.id)}
                  >
                    <span aria-hidden="true">{expanded ? "\u25be" : "\u25b8"}</span>
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {expanded ? (
          <div
            className="library-row-panel"
            data-testid="library-row-panel"
            id={`library-row-panel-${item.id}`}
          >
            {renderRowPanel(item.id)}
          </div>
        ) : null}
      </li>
    );
  };

  // An open row takes the list over: the panel needs the height more than the
  // neighbouring rows do, and the chevron on the row brings the list back.
  const openCard = expandedRowId ? visible.find((item) => item.id === expandedRowId) : undefined;
  const rows = openCard ? (
    <ul className="space-y-0.5">{[openCard].map(renderRow)}</ul>
  ) : grouped ? (
    <div className="space-y-2">
      {grouped.map((group) => (
        <section key={group.id} data-testid={`library-group-${group.id}`}>
          <h3
            className="library-group-heading"
            style={{ paddingLeft: 4 + group.depth * 10 }}
            data-depth={group.depth}
          >
            <span className="min-w-0 truncate">{group.title}</span>
            <span className="tabular-nums text-[var(--ink-muted)]">{group.items.length}</span>
          </h3>
          <ul className="space-y-0.5">{group.items.map(renderRow)}</ul>
        </section>
      ))}
    </div>
  ) : (
    <ul className="space-y-0.5">{visible.map(renderRow)}</ul>
  );

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Library"
      data-testid="library-drawer"
      data-wide={wide ? "true" : undefined}
      className="library-drawer"
    >
      <div className="library-header flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5">
        <div role="tablist" aria-label="Library sections" className="flex items-center gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`library-tab-${entry.id}`}
              className="library-tab"
              data-active={tab === entry.id ? "true" : undefined}
              onClick={() => onTab(entry.id)}
            >
              {entry.label}
              <span className="tabular-nums text-[var(--ink-muted)]">{counts[entry.id]}</span>
            </button>
          ))}
        </div>

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
          {tab === "trash" && trash.length > 0 ? (
            <button
              type="button"
              data-testid="library-empty-trash"
              className="library-action text-red-600"
              onClick={onEmptyTrash}
            >
              Empty trash
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Close library"
            className="library-action"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>
      </div>

      <div
        className="library-facets flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5"
        data-testid="library-facets"
      >
        {types.map((type) => {
          const count = countsByFacet.types.get(type.id) ?? 0;
          const active = typeFilter.includes(type.id);
          return (
            <button
              key={type.id}
              type="button"
              aria-pressed={active}
              data-testid={`facet-type-${type.id}`}
              className="library-tab"
              data-active={active ? "true" : undefined}
              onClick={() => onToggleType(type.id)}
            >
              <span aria-hidden="true">{type.glyph}</span>
              {typePluralName(type)}
              <span className="tabular-nums text-[var(--ink-muted)]">{count}</span>
            </button>
          );
        })}

        {tags.length > 0 ? <span className="h-4 w-px bg-[var(--hairline)]" /> : null}

        {tags.map((tag) => {
          const count = countsByFacet.tags.get(tag.id) ?? 0;
          const active = tagFilter.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              data-testid={`facet-tag-${tag.id}`}
              className="library-tab"
              data-active={active ? "true" : undefined}
              onClick={() => onToggleTag(tag.id)}
            >
              #{tag.name}
              <span className="tabular-nums text-[var(--ink-muted)]">{count}</span>
            </button>
          );
        })}

        {boardScope ? (
          <>
            <span className="h-4 w-px bg-[var(--hairline)]" />
            {sectionOrder.map((section) => {
              const count = countsByFacet.sections.get(section.id) ?? 0;
              const active = sectionFilter.includes(section.id);
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-pressed={active}
                  data-testid={`facet-section-${section.id}`}
                  data-depth={section.depth}
                  className="library-tab"
                  data-active={active ? "true" : undefined}
                  style={{ paddingLeft: 9 + section.depth * 10 }}
                  onClick={() => onToggleSection(section.id)}
                >
                  <span className="truncate">{section.title}</span>
                  <span className="tabular-nums text-[var(--ink-muted)]">{count}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={sectionFilter.includes(UNSORTED_SECTION)}
              data-testid={`facet-section-${UNSORTED_SECTION}`}
              className="library-tab"
              data-active={sectionFilter.includes(UNSORTED_SECTION) ? "true" : undefined}
              onClick={() => onToggleSection(UNSORTED_SECTION)}
            >
              Unsorted
              <span className="tabular-nums text-[var(--ink-muted)]">
                {countsByFacet.sections.get(UNSORTED_SECTION) ?? 0}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={groupBySection}
              data-testid="library-group-toggle"
              className="library-tab ml-auto"
              data-active={groupBySection ? "true" : undefined}
              onClick={onToggleGroup}
            >
              Group by section
            </button>
          </>
        ) : null}

        {filtering ? (
          <button
            type="button"
            className="library-action ml-auto"
            data-testid="clear-filters"
            onClick={onClearFilters}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="library-list overflow-y-auto p-1.5">
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--ink-muted)]">
            {filtering
              ? "No cards match these filters."
              : tab === "inbox"
                ? "Nothing in the inbox. Cards you take off a board land here."
                : tab === "cards"
                  ? boardScope
                    ? "No cards on this board."
                    : "No cards yet."
                  : "Trash is empty."}
          </p>
        ) : (
          rows
        )}
      </div>

      {hold ? (
        <div
          aria-hidden="true"
          data-testid="library-hold-ghost"
          className="library-ghost"
          style={{ left: hold.x, top: hold.y }}
        >
          {hold.item.title}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
