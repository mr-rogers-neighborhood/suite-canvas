import { z } from "zod";
import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { entityIdSchema, type Placement, type Section } from "./schema.js";
import { buildSearchText, type SearchHit, searchCards, searchTerms } from "./search.js";
import { sectionForCard, sectionLineage } from "./sections.js";

export const viewScopes = ["all", "board"] as const;
export const viewOrders = ["relevance", "title", "updated"] as const;

export const viewScopeSchema = z.enum(viewScopes);
export const viewOrderSchema = z.enum(viewOrders);

/**
 * A saved query. It names *what to select*, never what was selected: no card
 * ids are stored, so the result follows edits, trash, renames and newly created
 * cards without the view itself changing.
 */
export const viewQuerySchema = z.object({
  /** Free text over the search index (titles and bodies). */
  text: z.string().min(1).optional(),
  /** Facets: OR within a group, AND across groups, exactly as the library. */
  typeIds: z.array(entityIdSchema),
  tagIds: z.array(entityIdSchema),
  sectionIds: z.array(entityIdSchema),
  scope: viewScopeSchema,
  groupBySection: z.boolean(),
  order: viewOrderSchema,
});

/** One saved view. `position` is its index in the Views menu. */
export const savedViewSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  position: z.number().int().nonnegative(),
  query: viewQuerySchema,
});

export type ViewScope = z.infer<typeof viewScopeSchema>;
export type ViewOrder = z.infer<typeof viewOrderSchema>;
export type ViewQuery = z.infer<typeof viewQuerySchema>;
export type SavedView = z.infer<typeof savedViewSchema>;

/**
 * Mirrors `UNSORTED_SECTION` in `apps/canvas/src/components/libraryFilters.ts`:
 * the value the section facet stores for cards on a scoped board in no section.
 */
export const VIEW_UNSORTED_SECTION = "__unsorted__";

/** A query that selects everything, for callers building one field at a time. */
export function emptyViewQuery(): ViewQuery {
  return {
    typeIds: [],
    tagIds: [],
    sectionIds: [],
    scope: "all",
    groupBySection: false,
    order: "relevance",
  };
}

export interface ViewContext {
  /** Active board; `scope: "board"` needs it, and section facets resolve against it. */
  boardId?: string | null;
  /** Prebuilt search index, so a caller can reuse one across views. */
  index?: ReadonlyMap<string, string>;
}

export interface ViewResult {
  /** Matching cards, in the view's order. */
  cardIds: string[];
  /** Search hits for the returned cards only; empty when the query has no text. */
  hits: Map<string, SearchHit>;
}

/**
 * A card's section on one board plus every ancestor, innermost first, or an
 * empty list when it sits in none. Matches the library's `sectionIds`, where
 * selecting a section therefore includes its whole subtree.
 */
function sectionChain(match: Section, sections: Section[], cache: Map<string, string[]>): string[] {
  const cached = cache.get(match.id);
  if (cached) return cached;
  const chain = sections
    .filter(
      (candidate) =>
        candidate.id === match.id ||
        sectionLineage(candidate.id, sections).some((entry) => entry.id === match.id),
    )
    // Largest first is outermost first; reversing leaves the card's own section at the head.
    .sort((a, b) => b.width * b.height - a.width * a.height || a.id.localeCompare(b.id))
    .map((candidate) => candidate.id)
    .reverse();
  cache.set(match.id, chain);
  return chain;
}

function sectionIdsFor(
  placements: readonly Placement[],
  sectionsByBoard: ReadonlyMap<string, Section[]>,
  cache: Map<string, string[]>,
): string[] {
  const ids: string[] = [];
  for (const placement of placements) {
    const sections = sectionsByBoard.get(placement.boardId);
    if (!sections || sections.length === 0) continue;
    const match = sectionForCard(placement, sections);
    if (!match) continue;
    for (const id of sectionChain(match, sections, cache)) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function sameTitle(a: string, aid: string, b: string, bid: string): number {
  return a.localeCompare(b) || aid.localeCompare(bid);
}

/**
 * Runs a saved query against the workspace. Pure: the document is only read, so
 * every call sees the current cards, sections and bodies. A card in the trash
 * or a card whose body changed changes the result without a view edit.
 */
export function runViewQuery(
  workspace: WorkspaceDocument,
  query: ViewQuery,
  context: ViewContext = {},
): ViewResult {
  const boardId = context.boardId ?? null;
  // A board-scoped view has nothing to show without an active board; returning
  // an empty list is honest, while falling back to the whole workspace would not.
  if (query.scope === "board" && boardId === null) return { cardIds: [], hits: new Map() };

  const placementsByCard = new Map<string, Placement[]>();
  for (const placement of workspace.listPlacements()) {
    const list = placementsByCard.get(placement.cardId);
    if (list) list.push(placement);
    else placementsByCard.set(placement.cardId, [placement]);
  }

  // Section facets need the subtree of each board the candidate card sits on.
  const sectionsByBoard = new Map<string, Section[]>();
  if (query.sectionIds.length > 0) {
    for (const section of workspace.listSections()) {
      const list = sectionsByBoard.get(section.boardId);
      if (list) list.push(section);
      else sectionsByBoard.set(section.boardId, [section]);
    }
  }
  const chainCache = new Map<string, string[]>();

  // A facet id whose record was deleted is dropped rather than matched or
  // thrown on: the type, tag or section no longer exists, so keeping it would
  // strand the view on a filter nobody can see or clear. A group left empty
  // simply stops narrowing.
  const wantedTypes = new Set(query.typeIds.filter((id) => workspace.getType(id) !== undefined));
  const wantedTags = new Set(query.tagIds.filter((id) => workspace.getTag(id) !== undefined));
  const wantedSections = new Set(
    query.sectionIds.filter(
      (id) => id === VIEW_UNSORTED_SECTION || workspace.getSection(id) !== undefined,
    ),
  );
  const takesType = wantedTypes.size > 0;
  const takesTag = wantedTags.size > 0;
  const takesSection = wantedSections.size > 0;

  const matches = new Set<string>();
  const titles = new Map<string, string>();
  const updated = new Map<string, number>();
  for (const card of workspace.listCards()) {
    if (card.deletedAt) continue;
    const placements = placementsByCard.get(card.id) ?? [];
    const scoped =
      query.scope === "board"
        ? placements.filter((placement) => placement.boardId === boardId)
        : placements;
    if (query.scope === "board" && scoped.length === 0) continue;

    if (takesType && !card.typeIds.some((id) => wantedTypes.has(id))) continue;
    if (takesTag && !card.tags.some((id) => wantedTags.has(id))) continue;
    if (takesSection) {
      const sectionIds = sectionIdsFor(scoped, sectionsByBoard, chainCache);
      const own = sectionIds.length > 0 ? sectionIds : [VIEW_UNSORTED_SECTION];
      if (!own.some((id) => wantedSections.has(id))) continue;
    }

    matches.add(card.id);
    titles.set(card.id, workspace.displayTitle(card.id));
    updated.set(card.id, card.updatedAt);
  }

  const text = query.text ?? "";
  const searching = searchTerms(text).length > 0;
  const hits = new Map<string, SearchHit>();
  const ranked: string[] = [];
  if (searching) {
    const index = context.index ?? buildSearchText(workspace);
    for (const hit of searchCards(index, text, { limit: Math.max(1, index.size) })) {
      hits.set(hit.id, hit);
      ranked.push(hit.id);
    }
  }

  let cardIds = searching ? ranked.filter((id) => matches.has(id)) : [...matches];
  const titleOf = (id: string) => titles.get(id) ?? "";
  const updatedOf = (id: string) => updated.get(id) ?? 0;

  // Relevance without text has nothing to rank, so it falls back to title order.
  const order = query.order === "relevance" && !searching ? "title" : query.order;
  if (order === "title" || order === "updated") {
    cardIds = [...cardIds].sort((a, b) =>
      order === "updated"
        ? updatedOf(b) - updatedOf(a) || sameTitle(titleOf(a), a, titleOf(b), b)
        : sameTitle(titleOf(a), a, titleOf(b), b),
    );
  }

  const resultHits = new Map<string, SearchHit>();
  if (searching) {
    for (const id of cardIds) {
      const hit = hits.get(id);
      if (hit) resultHits.set(id, hit);
    }
  }
  return { cardIds, hits: resultHits };
}

/** Runs a saved view; the name and position never affect the selection. */
export function runView(
  workspace: WorkspaceDocument,
  view: SavedView,
  context: ViewContext = {},
): ViewResult {
  return runViewQuery(workspace, view.query, context);
}
