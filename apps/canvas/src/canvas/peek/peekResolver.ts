import type { Board, Card, GraphEdge, Placement, Section, Target } from "@suite/graph";

/**
 * What a peek says about one entity (ADR-0055).
 *
 * A peek names the thing, states its kind and offers one route to open it. It is a
 * reading: nothing here writes, and nothing here decides how a surface draws the peek.
 * One resolver per entity kind, in one function, so a card reads the same way in the
 * outline, in a rollup row and in a link endpoint.
 *
 * A kind with nothing truthful to say returns null. That is deliberate: no peek is
 * better than a peek that guesses, and the surface that offered it simply does not open.
 */
export interface PeekSource {
  cards: readonly Card[];
  boards: readonly Board[];
  sections: readonly Section[];
  edges: readonly GraphEdge[];
  placements: readonly Placement[];
  /** Card id → title, resolved from rich text. */
  titles: ReadonlyMap<string, string>;
  /** Card type id → name. */
  typeNames: ReadonlyMap<string, string>;
}

export interface PeekEntity {
  target: Target;
  /** The name a reader would say out loud. */
  label: string;
  /** What kind of thing it is: a type name, "board", "section" or a link kind. */
  kindLabel: string;
  /** One line of context, or null when there is nothing true to add. */
  detail: string | null;
}

const UNTITLED_CARD = "Untitled card";
const UNTITLED_BOARD = "Untitled board";
const UNTITLED_SECTION = "Untitled section";
const UNTITLED_LINK = "Untitled link";

function nameOf(kind: string | undefined, id: string, source: PeekSource): string {
  switch (kind ?? "card") {
    case "board":
      return source.boards.find((board) => board.id === id)?.name.trim() || UNTITLED_BOARD;
    case "section":
      return source.sections.find((section) => section.id === id)?.title.trim() || UNTITLED_SECTION;
    default:
      return source.titles.get(id)?.trim() || UNTITLED_CARD;
  }
}

function boardName(boardId: string | null | undefined, source: PeekSource): string | null {
  if (!boardId) return null;
  return source.boards.find((board) => board.id === boardId)?.name.trim() || UNTITLED_BOARD;
}

function cardPeek(card: Card, source: PeekSource): PeekEntity {
  const placement = source.placements.find((entry) => entry.cardId === card.id);
  const board = boardName(placement?.boardId, source);
  return {
    target: { kind: "card", id: card.id },
    label: source.titles.get(card.id)?.trim() || UNTITLED_CARD,
    kindLabel: source.typeNames.get(card.primaryTypeId) ?? "card",
    detail: board ? `On ${board}` : "In the inbox",
  };
}

function boardPeek(board: Board, source: PeekSource): PeekEntity {
  const cards = new Set(
    source.placements.filter((entry) => entry.boardId === board.id).map((entry) => entry.cardId),
  );
  return {
    target: { kind: "board", id: board.id },
    label: board.name.trim() || UNTITLED_BOARD,
    kindLabel: "board",
    detail: `${cards.size} ${cards.size === 1 ? "card" : "cards"}`,
  };
}

function sectionPeek(section: Section, source: PeekSource): PeekEntity {
  const board = boardName(section.boardId, source);
  return {
    target: { kind: "section", id: section.id },
    label: section.title.trim() || UNTITLED_SECTION,
    kindLabel: "section",
    detail: board ? `On ${board}` : null,
  };
}

function edgePeek(edge: GraphEdge, source: PeekSource): PeekEntity {
  const from = nameOf(edge.sourceKind, edge.source, source);
  const to = nameOf(edge.targetKind, edge.target, source);
  return {
    target: { kind: "link", id: edge.id },
    label: edge.label?.trim() || UNTITLED_LINK,
    kindLabel: edge.kind,
    detail: `${from} \u2192 ${to}`,
  };
}

/**
 * The peek for one target, or null when the target is not in the snapshot.
 *
 * A deleted card, a board that was closed or an edge that was removed all return null
 * for the same reason: a peek describes what is here now, and "it used to exist" is the
 * inspector's business, not a hover's.
 */
export function resolvePeek(target: Target, source: PeekSource): PeekEntity | null {
  switch (target.kind) {
    case "card": {
      const card = source.cards.find((entry) => entry.id === target.id);
      return card && !card.deletedAt ? cardPeek(card, source) : null;
    }
    case "board": {
      const board = source.boards.find((entry) => entry.id === target.id);
      return board ? boardPeek(board, source) : null;
    }
    case "section": {
      const section = source.sections.find((entry) => entry.id === target.id);
      return section ? sectionPeek(section, source) : null;
    }
    case "link": {
      const edge = source.edges.find((entry) => entry.id === target.id);
      return edge ? edgePeek(edge, source) : null;
    }
    default:
      // A target kind added without a resolver reads as no peek, not as a wrong one.
      return null;
  }
}

/** The accessible name of the surface, e.g. "Reading list, note". */
export function peekLabel(entity: PeekEntity): string {
  return `${entity.label}, ${entity.kindLabel}`;
}
