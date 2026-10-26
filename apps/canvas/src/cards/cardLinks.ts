import {
  arrowSources,
  type Board,
  type Card,
  type CardType,
  type GraphEdge,
  incomingReferences,
  outgoingPropertyLinks,
  outgoingReferences,
  type Placement,
  propertySources,
  type ReferenceIndex,
} from "@suite/graph";

/** A card row in the References section, already resolved for display. */
export type LinkProvenance = "mention" | "property" | "arrow";

/** One thing that links two cards: a mention, a named value, an arrow. */
export interface LinkOccurrence {
  key: string;
  kind: LinkProvenance;
  /** Mention snippet, arrow description, or the field name carrying a value. */
  detail?: string;
  boardId: string | null;
  boardName?: string;
}

/**
 * One related card with every occurrence grouped under it. A pair joined by a
 * mention, a named property and an arrow is one row with three markers, not
 * three rows the reader has to reconcile.
 */
export interface LinkRow {
  cardId: string;
  title: string;
  /** The other card's type glyph. */
  glyph: string;
  occurrences: LinkOccurrence[];
  /** Provenance present, in display order. */
  kinds: LinkProvenance[];
  /** The name a `card` field gives this link in this direction, when it has one. */
  relationship?: string;
  /** The pair links both ways: mutual mentions or a bidirectional arrow. */
  mutual: boolean;
  /** Board to reveal on click; null means the card is unplaced. */
  boardId: string | null;
  boardName?: string;
}

export interface CardLinks {
  incoming: LinkRow[];
  outgoing: LinkRow[];
}

export const EMPTY_CARD_LINKS: CardLinks = { incoming: [], outgoing: [] };

export interface CardLinkInput {
  cardId: string;
  references: ReferenceIndex;
  cards: readonly Card[];
  types: readonly CardType[];
  edges: readonly GraphEdge[];
  placements: readonly Placement[];
  boards: readonly Board[];
  /** Live display title, including the body-first-line fallback. */
  displayTitle: (cardId: string) => string;
  /** Text around a mention; returning undefined omits the snippet. */
  mentionSnippet?: (sourceCardId: string, targetCardId: string) => string | undefined;
}
function typeGlyph(cardId: string, cards: readonly Card[], types: readonly CardType[]): string {
  const card = cards.find((entry) => entry.id === cardId);
  const primaryId = card?.primaryTypeId ?? card?.typeIds[0];
  const type = primaryId ? types.find((entry) => entry.id === primaryId) : undefined;
  return type?.glyph ?? "\u25a1";
}

/**
 * `text` trimmed to about `radius` characters either side of the first
 * occurrence of `needle`. Mentions are atoms, so a body can name the target
 * without containing its title; that case returns undefined rather than
 * inventing a snippet.
 */
export function snippetAround(text: string, needle: string, radius = 60): string | undefined {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = needle ? flat.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (at < 0) return undefined;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + needle.length + radius);
  const body = flat.slice(start, end).trim();
  return `${start > 0 ? "\u2026" : ""}${body}${end < flat.length ? "\u2026" : ""}`;
}

/** The first board an unplaced-card row can reveal, if any. */
function placementOf(
  cardId: string,
  placements: readonly Placement[],
  boards: readonly Board[],
): { boardId: string; boardName: string } | null {
  const placement = placements.find((entry) => entry.cardId === cardId);
  if (!placement) return null;
  const board = boards.find((entry) => entry.id === placement.boardId);
  return { boardId: placement.boardId, boardName: board?.name ?? "Board" };
}

const KIND_ORDER: LinkProvenance[] = ["mention", "property", "arrow"];

/**
 * Groups every link a card has into incoming and outgoing lists keyed by the
 * other card. All of it is derived: mentions, `card` values and arrows stay the
 * only truth, so nothing here can drift out of sync with the body.
 */
export function cardLinks(input: CardLinkInput): CardLinks {
  const { cardId, cards, types, edges, placements, boards, displayTitle } = input;
  const byCard = new Map<"in" | "out", Map<string, LinkOccurrence[]>>([
    ["in", new Map()],
    ["out", new Map()],
  ]);

  const add = (
    direction: "in" | "out",
    otherCardId: string,
    kind: LinkProvenance,
    detail?: string,
    /** Arrow links live on the board the arrow was drawn on, not the other card's. */
    board?: { boardId: string; boardName: string },
  ) => {
    if (!otherCardId || otherCardId === cardId) return;
    const map = byCard.get(direction);
    if (!map) return;
    const list = map.get(otherCardId) ?? [];
    const placement = board ?? placementOf(otherCardId, placements, boards);
    list.push({
      key: `${direction}:${otherCardId}:${kind}:${detail ?? ""}:${list.length}`,
      kind,
      boardId: placement?.boardId ?? null,
      ...(placement ? { boardName: placement.boardName } : {}),
      ...(detail ? { detail } : {}),
    });
    map.set(otherCardId, list);
  };

  for (const sourceId of incomingReferences(cardId, input.references)) {
    add("in", sourceId, "mention", input.mentionSnippet?.(sourceId, cardId));
  }
  for (const targetId of outgoingReferences(cardId, input.references)) {
    add("out", targetId, "mention");
  }
  for (const source of propertySources(cardId, cards, types)) {
    add("in", source.cardId, "property", source.fieldName);
  }
  for (const link of outgoingPropertyLinks(cardId, cards, types)) {
    add("out", link.cardId, "property", link.fieldName);
  }
  for (const arrow of arrowSources(cardId, edges)) {
    const board = boards.find((entry) => entry.id === arrow.boardId);
    add(arrow.direction, arrow.otherCardId, "arrow", arrow.description, {
      boardId: arrow.boardId,
      boardName: board?.name ?? "Board",
    });
  }

  const rows = (direction: "in" | "out"): LinkRow[] => {
    const map = byCard.get(direction);
    if (!map) return [];
    const opposite = direction === "in" ? "out" : "in";
    return [...map].map(([otherCardId, occurrences]) => {
      const relationship = occurrences.find(
        (occurrence) => occurrence.kind === "property" && occurrence.detail,
      )?.detail;
      const placed = occurrences.find((occurrence) => occurrence.boardId !== null);
      const kinds = KIND_ORDER.filter((kind) =>
        occurrences.some((occurrence) => occurrence.kind === kind),
      );
      return {
        cardId: otherCardId,
        title: displayTitle(otherCardId),
        glyph: typeGlyph(otherCardId, cards, types),
        occurrences,
        kinds,
        mutual: byCard.get(opposite)?.has(otherCardId) ?? false,
        boardId: placed?.boardId ?? null,
        ...(placed?.boardName ? { boardName: placed.boardName } : {}),
        ...(relationship ? { relationship } : {}),
      };
    });
  };
  const byTitle = (a: LinkRow, b: LinkRow) =>
    a.title.localeCompare(b.title) || a.cardId.localeCompare(b.cardId);

  return {
    incoming: rows("in").sort(byTitle),
    outgoing: rows("out").sort(byTitle),
  };
}
