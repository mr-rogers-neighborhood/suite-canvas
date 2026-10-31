import type { CardType, Tag } from "@suite/graph";
import { isBehaviourType, typePluralName } from "@suite/graph";
import { type facetCounts, type SectionOrderEntry, UNSORTED_SECTION } from "./libraryFilters";
import { BOARD_TYPE_FACET } from "./libraryTypes";

/** The type, tag and section facet row; a board row is not a card, so it hides. */
export function LibraryFacets({
  types,
  tags,
  countsByFacet,
  boardScope,
  sectionOrder,
  typeFilter,
  tagFilter,
  sectionFilter,
  groupBySection,
  filtering,
  onToggleType,
  onToggleTag,
  onToggleSection,
  onToggleGroup,
  onClearFilters,
}: {
  types: CardType[];
  tags: Tag[];
  countsByFacet: ReturnType<typeof facetCounts>;
  boardScope: boolean;
  sectionOrder: SectionOrderEntry[];
  typeFilter: string[];
  tagFilter: string[];
  sectionFilter: string[];
  groupBySection: boolean;
  filtering: boolean;
  onToggleType: (id: string) => void;
  onToggleTag: (id: string) => void;
  onToggleSection: (id: string) => void;
  onToggleGroup: () => void;
  onClearFilters: () => void;
}) {
  return (
    <div
      className="library-facets flex flex-wrap items-center gap-1 border-b border-[var(--hairline)] px-2 py-1.5"
      data-testid="library-facets"
    >
      {/* Boards sit in the same list as cards, so they are a facet like any
          type. It comes first because "show me the boards" is the filter a
          reader reaches for most. */}
      <button
        type="button"
        aria-pressed={typeFilter.includes(BOARD_TYPE_FACET)}
        data-testid={`facet-type-${BOARD_TYPE_FACET}`}
        className="library-tab"
        data-active={typeFilter.includes(BOARD_TYPE_FACET) ? "true" : undefined}
        onClick={() => onToggleType(BOARD_TYPE_FACET)}
      >
        <span aria-hidden="true">{"\u25f1"}</span>
        Boards
        <span className="tabular-nums text-[var(--ink-muted)]">
          {countsByFacet.types.get(BOARD_TYPE_FACET) ?? 0}
        </span>
      </button>

      {/* A behaviour is not a facet (ADR-0011 §3): offering Sketch or Portal here
          reads as "author your own Sketch type", which the model forbids. A sketch is
          found by its cards and a portal is that board's presence. */}
      {types
        .filter((type) => !isBehaviourType(type.id))
        .map((type) => {
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
  );
}
