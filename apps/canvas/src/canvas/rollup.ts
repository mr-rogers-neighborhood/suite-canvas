import type { Card, GraphEdge, Placement } from "@suite/graph";

/**
 * A rollup is the collapse a card already has room for (ADR-0060): the card becomes
 * its header line plus a count of what it hides. The count is the whole problem. A
 * number a reader cannot check is worse than no collapse at all, so this module never
 * produces one: `members` is the list, `count` is that list's length, and there is no
 * field for a figure nobody can point at.
 *
 * What a card hides is the set it points at: outbound links, plus the mentions the
 * references index derives from its body. Both are already on the board's snapshot, so
 * a rollup is a read.
 */

/** One card a rollup hides, with everything a row needs to name it and open it. */
export interface RollupMember {
  cardId: string;
  /** The reader-facing title, or "Untitled" for a card whose body is empty. */
  title: string;
  /** The primary type's name, so a row can say what kind of thing it is. */
  kind: string;
  /** The board it sits on, or null when it sits in the inbox. */
  boardId: string | null;
  /** True when it sits on the board the rollup is read on. */
  onBoard: boolean;
}

export interface Rollup {
  /** The card reduced to its header line. */
  cardId: string;
  title: string;
  members: readonly RollupMember[];
  /** Exactly `members.length`, so a header cannot print a number it did not count. */
  count: number;
  /** Members that are not on the board being read; the header has to say so. */
  elsewhere: number;
}

export interface RollupInput {
  cardId: string;
  cards: readonly Card[];
  edges: readonly GraphEdge[];
  /** `fromCardId` → mentioned ids, from the references index on the snapshot. */
  references: Readonly<Record<string, readonly string[]>>;
  placements: readonly Placement[];
  /** The board the rollup is read on; null reads a card with no board. */
  activeBoardId: string | null;
  titles: ReadonlyMap<string, string>;
  /** Card type id → name. */
  typeNames: ReadonlyMap<string, string>;
}

const UNTITLED = "Untitled";

/**
 * The ids one card points at, deduplicated and in a stable order.
 *
 * A bidirectional edge counts as a pointer in both directions, because that is what
 * the record means. A link whose far end is a board or a section names no card, so it
 * is not a member: a rollup counts cards it can open.
 */
function pointedAt(
  cardId: string,
  edges: readonly GraphEdge[],
  references: Readonly<Record<string, readonly string[]>>,
): string[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    const forward = edge.source === cardId;
    const backward = edge.bidirectional === true && edge.target === cardId;
    if (!forward && !backward) continue;
    if (forward && (edge.targetKind ?? "card") !== "card") continue;
    if (backward && (edge.sourceKind ?? "card") !== "card") continue;
    ids.add(forward ? edge.target : edge.source);
  }
  for (const mentioned of references[cardId] ?? []) ids.add(mentioned);
  ids.delete(cardId);
  return [...ids];
}

/**
 * The rollup for one card, or null when the card itself is gone.
 *
 * Null is the honest answer for a deleted card: a rollup of something that no longer
 * exists has no list to stand behind. Deleted members are dropped for the same reason,
 * and because a trashed card is not something the reader can open from here.
 */
export function cardRollup(input: RollupInput): Rollup | null {
  const card = input.cards.find((entry) => entry.id === input.cardId);
  if (!card || card.deletedAt) return null;

  const byId = new Map(input.cards.map((entry) => [entry.id, entry]));
  const boardOf = new Map<string, string>();
  for (const placement of input.placements) {
    if (!boardOf.has(placement.cardId)) boardOf.set(placement.cardId, placement.boardId);
  }

  const members: RollupMember[] = [];
  for (const id of pointedAt(input.cardId, input.edges, input.references)) {
    const member = byId.get(id);
    if (!member || member.deletedAt) continue;
    const boardId = boardOf.get(id) ?? null;
    members.push({
      cardId: id,
      title: input.titles.get(id)?.trim() || UNTITLED,
      kind: input.typeNames.get(member.primaryTypeId) ?? "note",
      boardId,
      onBoard: boardId !== null && boardId === input.activeBoardId,
    });
  }

  members.sort((left, right) => {
    const byTitle = left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    return byTitle !== 0 ? byTitle : left.cardId.localeCompare(right.cardId);
  });

  return {
    cardId: card.id,
    title: input.titles.get(card.id)?.trim() || UNTITLED,
    members,
    count: members.length,
    elsewhere: members.filter((member) => !member.onBoard).length,
  };
}

/**
 * The header line's words. It reads the list it was given, so "3 cards" and three rows
 * are the same fact stated twice rather than two facts that can disagree.
 */
export function rollupSummary(rollup: Rollup, elsewhereLabel = "elsewhere"): string {
  if (rollup.count === 0) return "Nothing to summarise";
  const noun = rollup.count === 1 ? "card" : "cards";
  const away = rollup.elsewhere > 0 ? ` · ${rollup.elsewhere} ${elsewhereLabel}` : "";
  return `${rollup.count} ${noun}${away}`;
}
