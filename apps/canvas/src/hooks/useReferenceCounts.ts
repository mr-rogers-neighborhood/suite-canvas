import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useWorkspaceSnapshot, useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceSnapshot } from "./snapshotMerge";

/** The sections a reference count reads. Identity is what the memo keys on. */
export type ReferenceCountInput = Pick<
  WorkspaceSnapshot,
  "references" | "cards" | "edges" | "types"
>;

export type ReferenceCountLookup = (cardId: string) => number;

interface CountCache {
  references: ReferenceCountInput["references"];
  cards: ReferenceCountInput["cards"];
  edges: ReferenceCountInput["edges"];
  types: ReferenceCountInput["types"];
  lookup: ReferenceCountLookup;
}

/** Shared across every card: one walk per snapshot change, not one per render. */
let cache: CountCache | null = null;

const NO_COUNT = 0;

/**
 * `referenceCount` for every card at once. The per-card helper walks the whole
 * workspace, so calling it in each card's render would be quadratic; this walks
 * each section once and tallies the same three sources (mentions pointing in,
 * `card` property values pointing here, arrows touching the card). Rows a
 * dangling property value names are tallied too; they are simply never asked for
 * unless a card with that id exists.
 */
function buildCounts(input: ReferenceCountInput): ReferenceCountLookup {
  const counts = new Map<string, number>();
  const add = (cardId: string) => {
    counts.set(cardId, (counts.get(cardId) ?? NO_COUNT) + 1);
  };

  for (const targets of Object.values(input.references)) {
    for (const target of targets) add(target);
  }
  for (const card of input.cards) {
    for (const value of Object.values(card.properties)) {
      if (typeof value === "string") add(value);
    }
  }
  for (const edge of input.edges) {
    add(edge.target);
    // A self-loop touches one card, exactly as `arrowSources` yields one row.
    if (edge.source !== edge.target) add(edge.source);
  }

  return (cardId) => counts.get(cardId) ?? NO_COUNT;
}

/**
 * Counts memoised on the three sections that feed them. Unchanged sections keep
 * their identity through `mergeSnapshots`, so an edit elsewhere reuses the
 * previous lookup and every card keeps the same function.
 */
export function referenceCounts(input: ReferenceCountInput): ReferenceCountLookup {
  if (
    cache &&
    cache.references === input.references &&
    cache.cards === input.cards &&
    cache.edges === input.edges &&
    cache.types === input.types
  ) {
    return cache.lookup;
  }
  const lookup = buildCounts(input);
  cache = {
    references: input.references,
    cards: input.cards,
    edges: input.edges,
    types: input.types,
    lookup,
  };
  return lookup;
}

/** The shared lookup, for surfaces that already track the whole snapshot. */
export function useReferenceCounts(): ReferenceCountLookup {
  const store = useWorkspaceStore();
  const get = useCallback(() => referenceCounts(store.getSnapshot()), [store]);
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * One card's count. Subscribing to the number rather than the snapshot keeps a
 * card from re-rendering when only unrelated sections changed.
 */
export function useReferenceCount(cardId: string): number {
  const store = useWorkspaceStore();
  const get = useCallback(() => referenceCounts(store.getSnapshot())(cardId), [store, cardId]);
  return useSyncExternalStore(store.subscribe, get, get);
}

export interface CardTitleOption {
  id: string;
  title: string;
}

/**
 * Live display titles for every card. A title is rich text, so editing it moves
 * no card record and no snapshot section; the picker and the reference rows
 * would otherwise keep naming cards by their old titles. One subscription per
 * card updates a single entry per keystroke, coalesced to one frame.
 */
export function useCardTitles(): readonly CardTitleOption[] {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map());
  const pending = useRef(new Set<string>());
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      frame.current = null;
      const changed = [...pending.current];
      pending.current.clear();
      if (changed.length === 0) return;
      setTitles((previous) => {
        let next: Map<string, string> | null = null;
        for (const cardId of changed) {
          const title = workspace.displayTitle(cardId);
          // Body edits also fire the title listener; keep the same map when the
          // first line did not move so the host does not re-render per keystroke.
          if (previous.get(cardId) === title) continue;
          next ??= new Map(previous);
          next.set(cardId, title);
        }
        return next ?? previous;
      });
    };

    const unsubscribers = snapshot.cards.map((card) =>
      workspace.observeTitle(card.id, () => {
        pending.current.add(card.id);
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current.clear();
    };
  }, [workspace, snapshot.cards]);

  return useMemo(
    () =>
      snapshot.cards.map((card) => ({
        id: card.id,
        title: titles.get(card.id) ?? workspace.displayTitle(card.id),
      })),
    [snapshot.cards, titles, workspace],
  );
}
