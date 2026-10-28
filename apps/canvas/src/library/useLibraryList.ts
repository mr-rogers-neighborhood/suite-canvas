import type { WorkspaceDocument } from "@suite/graph";
import { useMemo } from "react";
import { useLibrarySearch } from "../hooks/useLibrarySearch";
import type { LibraryScope, LibraryTab } from "../store/useUiStore";
import {
  facetCounts,
  filterItems,
  groupBySection as groupSections,
  type SectionOrderEntry,
} from "./libraryFilters";
import type { LibraryBoard, LibraryItem } from "./libraryTypes";
import type { BoardStarter } from "./TemplateGallery";

/**
 * Cards answer for the tags of the section they sit in as well as their own
 * (ADR-0053 §6).
 * Read-only: section membership still comes from geometry alone.
 */
function withSectionTags(items: LibraryItem[], workspace: WorkspaceDocument | null): LibraryItem[] {
  if (!workspace) return items;
  const tagsBySection = new Map<string, string[]>();
  for (const section of workspace.listSections()) {
    if (section.tags.length > 0) tagsBySection.set(section.id, section.tags);
  }
  if (tagsBySection.size === 0) return items;
  return items.map((item) => {
    const inherited = item.sectionIds.flatMap((id) => tagsBySection.get(id) ?? []);
    if (inherited.length === 0) return item;
    // A card can also carry the tag itself; the facet counts a card once.
    return { ...item, tagIds: [...new Set([...item.tagIds, ...inherited])] };
  });
}

/**
 * The three orders a library list can be in. Relevance is the search ranking;
 * a list with no query has no ranking to show, so it stays in facet order.
 */
export type LibrarySort = "relevance" | "title" | "updated";

/**
 * `hooks/useLibrarySearch.ts` ranks at most this many hits. A result set that
 * reaches the cap is a truncated one, and the list has to say so: a search that
 * silently stops at 200 looks like "this is everything".
 */
export const SEARCH_HIT_LIMIT = 200;

export interface LibraryListArgs {
  tab: LibraryTab;
  scope: LibraryScope;
  activeBoardId: string | null;
  inbox: LibraryItem[];
  cards: LibraryItem[];
  trash: LibraryItem[];
  boards: LibraryBoard[];
  starters: readonly BoardStarter[];
  typeFilter: string[];
  tagFilter: string[];
  sectionFilter: string[];
  sectionOrder: SectionOrderEntry[];
  groupBySection: boolean;
  workspace: WorkspaceDocument | null;
  /** How the reader asked for the list to be ordered. */
  sort: LibrarySort;
  /** Seeds the query box. Stories and tests only. */
  initialQuery: string;
}

/**
 * The library's derived list: facets, search ranking, view order and section
 * grouping. Pure reads over the props and the search index; nothing is stored.
 */
export function useLibraryList({
  tab,
  scope,
  activeBoardId,
  inbox,
  cards,
  trash,
  boards,
  starters,
  typeFilter,
  tagFilter,
  sectionFilter,
  sectionOrder,
  groupBySection,
  workspace,
  sort,
  initialQuery,
}: LibraryListArgs) {
  const boardScope = tab === "cards" && scope === "board" && activeBoardId !== null;
  const items = tab === "inbox" ? inbox : tab === "cards" ? cards : tab === "trash" ? trash : [];
  const scopedItems = boardScope
    ? items.filter((item) => item.boards.some((board) => board.id === activeBoardId))
    : items;
  const activeSectionFilter = boardScope ? sectionFilter : [];
  const {
    query,
    setQuery,
    active: searching,
    terms,
    hits,
    ids: rankedIds,
  } = useLibrarySearch(workspace, scopedItems, initialQuery);

  const filterable = withSectionTags(scopedItems, workspace);
  const countsByFacet = facetCounts(filterable, typeFilter, tagFilter, activeSectionFilter);
  const facetFiltered = filterItems(filterable, typeFilter, tagFilter, activeSectionFilter);
  // A query replaces the facet-filtered list but never bypasses it: facets keep
  // narrowing the ranked hits, and the ranking order wins.
  const itemsById = new Map(scopedItems.map((item) => [item.id, item]));
  const facetIds = new Set(facetFiltered.map((item) => item.id));
  const searched = searching
    ? rankedIds.flatMap((id) => {
        const item = itemsById.get(id);
        return item !== undefined && facetIds.has(id) ? [item] : [];
      })
    : null;
  const visible = searched ?? facetFiltered;
  // Relevance is whatever the search produced; the other two orders are a sort
  // over it, because a reader who asks for "recently updated" means the list
  // they can see.
  const ordered = useMemo(() => {
    if (sort === "relevance") return visible;
    const byTitle = (a: LibraryItem, b: LibraryItem) =>
      a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (sort === "updated") {
      const updatedAt = (item: LibraryItem) => workspace?.getCard(item.id)?.updatedAt ?? 0;
      return [...visible].sort((a, b) => updatedAt(b) - updatedAt(a) || byTitle(a, b));
    }
    return [...visible].sort(byTitle);
  }, [visible, sort, workspace]);
  const filtering = typeFilter.length > 0 || tagFilter.length > 0 || activeSectionFilter.length > 0;
  const grouped =
    boardScope && groupBySection && !searching ? groupSections(ordered, sectionOrder) : null;
  const sectionsById = new Map(sectionOrder.map((section) => [section.id, section]));

  // Boards are a name and a placement count, so they are matched by title only:
  // the card index has nothing to say about them.
  const boardQuery = query.trim().toLowerCase();
  const matchesBoardQuery = (title: string) =>
    boardQuery.length === 0 || title.toLowerCase().includes(boardQuery);
  const matchedBoards =
    tab !== "boards"
      ? []
      : boardQuery.length === 0
        ? boards
        : boards.filter((board) => board.title.toLowerCase().includes(boardQuery));
  const visibleBoards = matchedBoards;
  // The Templates group answers the same query as the list: a search narrows
  // both halves instead of leaving a gallery of things the reader did not ask for.
  const visibleTemplates =
    tab === "boards"
      ? boards.filter((board) => board.template && matchesBoardQuery(board.title))
      : [];
  const visibleStarters =
    tab === "boards" ? starters.filter((entry) => matchesBoardQuery(entry.title)) : [];

  return {
    query,
    setQuery,
    searching,
    terms,
    hits,
    rankedIds,
    boardScope,
    scopedItems,
    countsByFacet,
    ordered,
    filtering,
    /** The search stopped at its cap, so the list is not the whole result. */
    truncated: searching && rankedIds.length >= SEARCH_HIT_LIMIT,
    grouped,
    sectionsById,
    visibleBoards,
    visibleTemplates,
    visibleStarters,
  };
}
