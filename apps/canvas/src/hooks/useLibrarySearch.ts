import type { SearchHit, WorkspaceDocument } from "@suite/graph";
import { buildSearchText, cardSearchText, searchCards, searchTerms } from "@suite/graph";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { workspaceSnapshotStore } from "../store/workspaceSnapshotStore";

/**
 * Window event the dock fires after it opens the library on the Cards tab. The
 * drawer owns the input, so it listens and focuses its own box.
 */
export const LIBRARY_SEARCH_FOCUS_EVENT = "suite:library-search-focus";

/** A burst of edits patches the index once, not once per keystroke. */
const REBUILD_DELAY_MS = 250;

/** The drawer re-filters by facet anyway; this just bounds the ranking work. */
const MAX_HITS = 200;

export interface SearchableItem {
  id: string;
}

export interface LibrarySearch {
  query: string;
  setQuery: (query: string) => void;
  clear: () => void;
  /** True when the query has at least one term, i.e. results replace the list. */
  active: boolean;
  /** Normalized terms, reused to highlight the live title in the results. */
  terms: string[];
  /** Ranked hits among `items`, keyed by card id. Empty while inactive. */
  hits: ReadonlyMap<string, SearchHit>;
  /** Ranked card ids among `items`. Empty while inactive. */
  ids: string[];
}

/**
 * Offline search over titles and bodies.
 *
 * The index is `buildSearchText`'s map, built on the first non-empty query and
 * kept in a ref afterwards. Body text is expensive to re-extract, so changes
 * only dirty a card id and a debounced flush patches those entries. Card changes
 * come from `workspaceSnapshotStore`, which owns the one document subscription
 * and reports both record and text edits.
 */
export function useLibrarySearch(
  workspace: WorkspaceDocument | null | undefined,
  items: readonly SearchableItem[],
  initialQuery = "",
): LibrarySearch {
  const [query, setQuery] = useState(initialQuery);
  const index = useRef<Map<string, string> | null>(null);
  const indexOwner = useRef<WorkspaceDocument | null>(null);
  /**
   * How many cards the cached index covers. A structural change (a new or a
   * deleted card) that arrived before the index existed, or that the change
   * stream coalesced away, would otherwise leave the new card unsearchable
   * until a reload. Comparing counts is cheap and self-healing.
   */
  const indexSize = useRef(0);
  const [version, invalidate] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    if (!workspace) return;
    const dirty = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const current = index.current;
      // Nothing built yet: keep the ids so the full build picks them up instead
      // of dropping them on the floor.
      if (!current) return;
      if (dirty.size === 0) return;
      for (const cardId of dirty) {
        if (workspace.getCard(cardId) === undefined) current.delete(cardId);
        else current.set(cardId, cardSearchText(workspace, cardId));
      }
      indexSize.current = current.size;
      dirty.clear();
      invalidate();
    };

    const mark = (cardId: string) => {
      dirty.add(cardId);
      if (timer === null) timer = setTimeout(flush, REBUILD_DELAY_MS);
    };

    const stopCards = workspaceSnapshotStore(workspace).subscribeCardChanges((cardIds) => {
      for (const cardId of cardIds) mark(cardId);
    });

    return () => {
      stopCards();
      if (timer !== null) clearTimeout(timer);
    };
  }, [workspace]);

  const terms = useMemo(() => searchTerms(query), [query]);
  const active = terms.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` invalidates the cached index; nothing reads it.
  const ranked = useMemo(() => {
    if (!workspace || !active) return null;
    if (indexOwner.current !== workspace) {
      // A different document (workspace vs projection) needs its own index.
      index.current = null;
      indexOwner.current = workspace;
      indexSize.current = 0;
    }
    const cardCount = workspace.listCards().length;
    if (index.current === null || indexSize.current !== cardCount) {
      index.current = buildSearchText(workspace);
      indexSize.current = index.current.size;
    }
    return searchCards(index.current, query, { limit: MAX_HITS });
  }, [workspace, active, query, version]);

  const scoped = useMemo(() => {
    if (ranked === null) return null;
    const wanted = new Set(items.map((item) => item.id));
    return ranked.filter((hit) => wanted.has(hit.id));
  }, [ranked, items]);

  const hits = useMemo(() => new Map((scoped ?? []).map((hit) => [hit.id, hit])), [scoped]);
  const ids = useMemo(() => (scoped ?? []).map((hit) => hit.id), [scoped]);

  return {
    query,
    setQuery,
    clear: () => setQuery(""),
    active,
    terms,
    hits,
    ids,
  };
}
