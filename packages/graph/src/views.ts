import { z } from "zod";
import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { ATTACHMENT_NODE_NAME } from "./portable.js";
import { entityIdSchema, type FieldDefinition, type Placement, type Section } from "./schema.js";
import { buildSearchText, type SearchHit, searchCards, searchTerms } from "./search.js";
import { sectionForCard, sectionLineage } from "./sections.js";
import {
  buildLinkIndex,
  groupsMatch,
  type LinkIndex,
  type PredicateContext,
  textScopeMatches,
  textScopeSchema,
  viewPredicateGroupSchema,
} from "./viewPredicates.js";

export const viewScopes = ["all", "board"] as const;
export const viewOrders = ["relevance", "title", "updated"] as const;
export const viewGroupBys = ["section", "type", "tag"] as const;
export const viewSortKeys = ["title", "updated", "created", "section"] as const;

export const viewScopeSchema = z.enum(viewScopes);
export const viewOrderSchema = z.enum(viewOrders);
export const viewGroupBySchema = z.enum(viewGroupBys);
export const viewSortKeySchema = z.enum(viewSortKeys);

/**
 * A saved query. It names *what to select*, never what was selected: no card
 * ids are stored, so the result follows edits, trash, renames and newly created
 * cards without the view itself changing.
 */
export const viewQuerySchema = z.object({
  /** Free text over the search index, narrowed by `textScope`. */
  text: z.string().min(1).optional(),
  /** Which half of the index `text` reads. Absent means both, as v1 did. */
  textScope: textScopeSchema.optional(),
  /** Facets: OR within a group, AND across groups, exactly as the library. */
  typeIds: z.array(entityIdSchema),
  /**
   * A card answers for its own tags and for the tags of the section it sits in
   * (ADR-0053 §6):
   * a section tag is a queryable grouping, never a membership rule.
   */
  tagIds: z.array(entityIdSchema),
  sectionIds: z.array(entityIdSchema),
  scope: viewScopeSchema,
  /** v1 grouping flag; still written so a downgrade keeps its meaning. */
  groupBySection: z.boolean(),
  /** v2 grouping. Absent means the same as `groupBySection: false`. */
  groupBy: viewGroupBySchema.optional(),
  order: viewOrderSchema,
  /** v2 sorts, applied after `order`; a stable tiebreak on title always follows. */
  sorts: z.array(z.object({ by: viewSortKeySchema, dir: z.enum(["asc", "desc"]) })).optional(),
  /**
   * v2 predicates: every group must pass, `any` is one level of OR, `not` is a
   * veto. Empty or absent leaves the facet behaviour above untouched.
   */
  groups: z.array(viewPredicateGroupSchema).optional(),
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
export type ViewGroupBy = z.infer<typeof viewGroupBySchema>;
export type ViewSortKey = z.infer<typeof viewSortKeySchema>;
export type ViewSort = { by: ViewSortKey; dir: "asc" | "desc" };
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

/**
 * Reads a stored query as v2 without changing it. v1 saved views keep parsing
 * (every v2 field is optional), so a migration only rewrites what it must and a
 * client that has not updated still understands the result.
 */
export function normalizeViewQuery(query: ViewQuery): ViewQuery {
  const groupBy = query.groupBy ?? (query.groupBySection ? "section" : undefined);
  return {
    ...query,
    ...(groupBy ? { groupBy, groupBySection: groupBy === "section" } : {}),
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

/** One entry of a grouped result; grouping is presentation, never stored. */
export interface ViewGroup {
  /** `null` is the "no group" bucket: unsorted, untyped, untagged. */
  key: string | null;
  cardIds: string[];
}

/** Attachment nodes anywhere in a card body, read from the Loro tree once. */
function bodyHasAttachment(workspace: WorkspaceDocument, cardId: string): boolean {
  const content = workspace.peekContent(cardId);
  if (!content) return false;
  const visit = (node: unknown): boolean => {
    const value = node as { get?: (key: string) => unknown } | null;
    if (!value || typeof value.get !== "function") return false;
    if (value.get("nodeName") === ATTACHMENT_NODE_NAME) return true;
    const children = value.get("children");
    const list = children as { toArray?: () => unknown[] } | undefined;
    if (!list || typeof list.toArray !== "function") return false;
    return list.toArray().some(visit);
  };
  return visit(content);
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

/** The title a card's section contributes to a section sort; unsorted last. */
function sectionTitleFor(
  placements: readonly Placement[],
  boardId: string | null,
  sectionsOf: (boardId: string) => readonly Section[],
): string {
  const placement =
    boardId === null
      ? placements[0]
      : (placements.find((entry) => entry.boardId === boardId) ?? placements[0]);
  if (!placement) return "";
  const sections = sectionsOf(placement.boardId) as Section[];
  if (sections.length === 0) return "";
  return sectionForCard(placement, sections)?.title ?? "";
}

interface SortKeys {
  readonly title: (id: string) => string;
  readonly updated: (id: string) => number;
  readonly created: (id: string) => number;
  readonly section: (id: string) => string;
}

/**
 * Multi-key comparison. Every key is followed by title and id so a sort is
 * total: two cards that tie on the requested keys never swap between runs.
 * A card with no section sorts after one that has a section.
 */
function compareCards(a: string, b: string, sorts: readonly ViewSort[], keys: SortKeys): number {
  for (const sort of sorts) {
    const direction = sort.dir === "desc" ? -1 : 1;
    if (sort.by === "updated" || sort.by === "created") {
      const difference = keys[sort.by](b) - keys[sort.by](a);
      if (difference !== 0) return sort.dir === "desc" ? difference : -difference;
      continue;
    }
    const left = keys[sort.by](a);
    const right = keys[sort.by](b);
    if (left === right) continue;
    if (sort.by === "section") {
      // An empty section is "no section", which sorts last in either direction.
      if (left === "") return direction;
      if (right === "") return -direction;
    }
    return left.localeCompare(right) * direction;
  }
  return sameTitle(keys.title(a), a, keys.title(b), b);
}

/**
 * Groups a result for presentation. Grouping is never stored and never changes
 * the selection: this is the same `cardIds` the view returned, bucketed.
 */
export function groupViewResult(
  workspace: WorkspaceDocument,
  query: ViewQuery,
  result: ViewResult,
  context: ViewContext = {},
): ViewGroup[] {
  const by = query.groupBy ?? (query.groupBySection ? "section" : undefined);
  if (!by) return [{ key: null, cardIds: result.cardIds }];

  const keys = new Map<string, string | null>();
  const placementsByCard = new Map<string, Placement[]>();
  for (const placement of workspace.listPlacements()) {
    const list = placementsByCard.get(placement.cardId);
    if (list) list.push(placement);
    else placementsByCard.set(placement.cardId, [placement]);
  }
  const boardId = context.boardId ?? null;

  for (const id of result.cardIds) {
    const card = workspace.getCard(id);
    if (!card) continue;
    if (by === "type") {
      keys.set(id, card.primaryTypeId);
      continue;
    }
    if (by === "tag") {
      keys.set(id, card.tags[0] ?? null);
      continue;
    }
    const placement =
      boardId === null
        ? placementsByCard.get(id)?.[0]
        : (placementsByCard.get(id)?.find((entry) => entry.boardId === boardId) ??
          placementsByCard.get(id)?.[0]);
    if (!placement) {
      keys.set(id, null);
      continue;
    }
    const sections = workspace.listSections().filter((s) => s.boardId === placement.boardId);
    keys.set(id, sectionForCard(placement, sections)?.id ?? null);
  }

  const groups = new Map<string | null, string[]>();
  for (const id of result.cardIds) {
    if (!keys.has(id)) continue;
    const key = keys.get(id) ?? null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(id);
    else groups.set(key, [id]);
  }
  // Named groups read A→Z; the "no group" bucket closes the list.
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    })
    .map(([key, cardIds]) => ({ key, cardIds }));
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

  // Sections are only read when something asks for them: a facet, a section
  // predicate, or a section sort. The map is built once and shared.
  let sectionsByBoard: Map<string, Section[]> | null = null;
  const ensureSections = (): Map<string, Section[]> => {
    if (!sectionsByBoard) {
      sectionsByBoard = new Map();
      for (const section of workspace.listSections()) {
        const list = sectionsByBoard.get(section.boardId);
        if (list) list.push(section);
        else sectionsByBoard.set(section.boardId, [section]);
      }
    }
    return sectionsByBoard;
  };
  const sectionsOf = (id: string): Section[] => ensureSections().get(id) ?? [];
  const chainCache = new Map<string, string[]>();
  // A section tag is a lens target (ADR-0053 §6): the cards inside a tagged
  // section answer for that tag. Membership itself stays pure geometry — this
  // is a read, and nothing in the query writes a placement.
  let sectionsById: Map<string, Section> | undefined;
  const sectionById = (id: string): Section | undefined => {
    if (!sectionsById) {
      sectionsById = new Map();
      for (const sections of ensureSections().values()) {
        for (const section of sections) sectionsById.set(section.id, section);
      }
    }
    return sectionsById.get(id);
  };

  // The search index and the reference index are derived and shared: the same
  // map serves a text predicate, a presence check and the ranked text search.
  let searchIndex: ReadonlyMap<string, string> | undefined = context.index;
  const indexText = (id: string): string | undefined => {
    searchIndex ??= buildSearchText(workspace);
    return searchIndex.get(id);
  };
  let referenceIndex: Readonly<Record<string, readonly string[]>> | undefined;
  let linkIndex: LinkIndex | undefined;
  const fieldsByType = new Map<string, readonly FieldDefinition[]>();
  const types = workspace.listTypes();
  for (const type of types) fieldsByType.set(type.id, type.fields);

  const predicateContext: PredicateContext = {
    fieldsByType,
    searchText: indexText,
    references: () => {
      referenceIndex ??= workspace.listReferences();
      return referenceIndex;
    },
    hasAttachment: (cardId) => bodyHasAttachment(workspace, cardId),
    placementsFor: (cardId) => placementsByCard.get(cardId) ?? [],
    sectionsForBoard: sectionsOf,
    links: () => {
      linkIndex ??= buildLinkIndex({
        cards: workspace.listCards(),
        types,
        edges: workspace.listEdges(),
        references: workspace.listReferences(),
      });
      return linkIndex;
    },
  };

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
  const groups = query.groups ?? [];
  const takesGroups = groups.length > 0;

  const matches = new Set<string>();
  const titles = new Map<string, string>();
  const updated = new Map<string, number>();
  const created = new Map<string, number>();
  for (const card of workspace.listCards()) {
    if (card.deletedAt) continue;
    const placements = placementsByCard.get(card.id) ?? [];
    const scoped =
      query.scope === "board"
        ? placements.filter((placement) => placement.boardId === boardId)
        : placements;
    if (query.scope === "board" && scoped.length === 0) continue;

    if (takesType && !card.typeIds.some((id) => wantedTypes.has(id))) continue;
    // The section chain answers both the tag and the section facet, so it is
    // resolved at most once per card.
    let resolvedSectionIds: string[] | undefined;
    const cardSections = (): string[] =>
      (resolvedSectionIds ??= sectionIdsFor(scoped, ensureSections(), chainCache));
    if (takesTag) {
      const viaOwnTag = card.tags.some((id) => wantedTags.has(id));
      const viaSectionTag =
        !viaOwnTag &&
        cardSections().some((id) => sectionById(id)?.tags.some((tagId) => wantedTags.has(tagId)));
      if (!viaOwnTag && !viaSectionTag) continue;
    }
    if (takesSection) {
      const ids = cardSections();
      const own = ids.length > 0 ? ids : [VIEW_UNSORTED_SECTION];
      if (!own.some((id) => wantedSections.has(id))) continue;
    }
    if (takesGroups && !groupsMatch(card, groups, predicateContext)) continue;

    matches.add(card.id);
    titles.set(card.id, workspace.displayTitle(card.id));
    updated.set(card.id, card.updatedAt);
    created.set(card.id, card.createdAt);
  }

  const text = query.text ?? "";
  const searching = searchTerms(text).length > 0;
  const textScope = query.textScope ?? "both";
  const hits = new Map<string, SearchHit>();
  const ranked: string[] = [];
  if (searching) {
    const index = searchIndex ?? buildSearchText(workspace);
    searchIndex = index;
    for (const hit of searchCards(index, text, { limit: Math.max(1, index.size) })) {
      // A card whose terms sit in the half this query does not read is not a
      // match, even though the whole-text search found it.
      if (textScope !== "both" && !textScopeMatches(index.get(hit.id) ?? "", text, textScope)) {
        continue;
      }
      hits.set(hit.id, hit);
      ranked.push(hit.id);
    }
  }

  let cardIds = searching ? ranked.filter((id) => matches.has(id)) : [...matches];
  const titleOf = (id: string) => titles.get(id) ?? "";
  const updatedOf = (id: string) => updated.get(id) ?? 0;
  const createdOf = (id: string) => created.get(id) ?? 0;
  const sectionTitleOf = (id: string) =>
    sectionTitleFor(placementsByCard.get(id) ?? [], boardId, sectionsOf);

  // Search ranking is already the order when a relevance view has text and no
  // explicit sorts. Everything else sorts: `order` keeps its v1 meaning
  // (relevance without text reads like title), and explicit `sorts` win.
  const keepSearchOrder = searching && query.order === "relevance" && !query.sorts;
  if (!keepSearchOrder) {
    const sorts: ViewSort[] =
      query.sorts && query.sorts.length > 0
        ? query.sorts
        : [
            {
              by: query.order === "updated" ? "updated" : "title",
              dir: query.order === "updated" ? "desc" : "asc",
            },
          ];
    const keys: SortKeys = {
      title: titleOf,
      updated: updatedOf,
      created: createdOf,
      section: sectionTitleOf,
    };
    cardIds = [...cardIds].sort((a, b) => compareCards(a, b, sorts, keys));
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
export function runView(
  workspace: WorkspaceDocument,
  view: SavedView,
  context: ViewContext = {},
): ViewResult {
  return runViewQuery(workspace, view.query, context);
}
