import type { GraphEdge, Placement, Section } from "@suite/graph";

/**
 * What Cut and Copy put aside, and what Paste puts back.
 *
 * The clipboard is this tab's, not the operating system's: the canvas suppresses the native menu, so
 * the verbs have to exist here, and a system clipboard would either need a serialisation format the
 * document does not have or would hand a reader's cards to every other application on the machine.
 *
 * A link travels with its ends. Copying two cards that are joined copies the join; copying one of them
 * does not, because a link whose other end is not in the paste has nothing to attach to.
 */

/** One copied link, kept whole so its paint and label survive the round trip. */
export interface ClipboardLink {
  edge: GraphEdge;
}

export interface ClipboardEntry {
  cards: readonly string[];
  sections: readonly string[];
  links: readonly ClipboardLink[];
  /** The top-left of what was copied, so a paste lands where the pointer is rather than at the origin. */
  origin: { x: number; y: number };
}

export interface ClipboardSource {
  cards: readonly string[];
  sections: readonly string[];
  edges: readonly GraphEdge[];
  placements: readonly Placement[];
  sectionsById: ReadonlyMap<string, Section>;
}

/**
 * The entry for a selection, or null when it holds nothing a paste could make.
 *
 * A link is kept only when both of its ends are copied. `sourceKind`/`targetKind` are absent for a
 * card, so an end counts as a card unless it says otherwise.
 */
export function clipboardFrom(source: ClipboardSource): ClipboardEntry | null {
  const cards = [...new Set(source.cards)];
  const sections = [...new Set(source.sections)];
  if (cards.length === 0 && sections.length === 0) return null;

  const cardSet = new Set(cards);
  const sectionSet = new Set(sections);
  const copied = (id: string, kind: string | undefined) =>
    kind === "section" ? sectionSet.has(id) : kind === "board" ? false : cardSet.has(id);

  const links: ClipboardLink[] = [];
  for (const edge of source.edges) {
    if (!copied(edge.source, edge.sourceKind)) continue;
    if (!copied(edge.target, edge.targetKind)) continue;
    links.push({ edge });
  }

  // The origin is the top-left of everything copied, so the same paste offset puts the whole group
  // where the pointer is instead of spreading it by each member's own distance to the pointer.
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  for (const placement of source.placements) {
    if (!cardSet.has(placement.cardId)) continue;
    left = Math.min(left, placement.x);
    top = Math.min(top, placement.y);
  }
  for (const id of sectionSet) {
    const section = source.sectionsById.get(id);
    if (!section) continue;
    left = Math.min(left, section.x);
    top = Math.min(top, section.y);
  }

  return {
    cards,
    sections: sections.filter((id) => source.sectionsById.has(id)),
    links,
    origin: {
      x: Number.isFinite(left) ? left : 0,
      y: Number.isFinite(top) ? top : 0,
    },
  };
}
