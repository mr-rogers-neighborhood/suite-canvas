import type { Board, Card, GraphEdge, Placement, Section } from "@suite/graph";
import { edgeEndpoints, PORTAL_BOARD_FIELD_ID, sectionMembership } from "@suite/graph";
import { useMemo } from "react";
import { cardIcon, sectionIcon } from "../canvas/entityIcon";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/** One card as a panel row reads it. */
export interface ContainerCardRow {
  id: string;
  title: string;
}

/** One drawn link as the container panel reads it: the other end, and its label. */
export interface ContainerLinkRow {
  edgeId: string;
  direction: "in" | "out";
  /** What the link points at, in words: a card title, a section title, a board name. */
  title: string;
  /** Glyph for the other end's kind, so the list reads like the link itself. */
  glyph: string;
  kind: "card" | "board" | "section";
  /** The other end's id: what the row names, and where clicking it navigates. */
  otherId: string;
  description?: string | undefined;
}

/**
 * A slice of a portal's target board: one section, or the cards in no section at
 * all. A portal's contents are an outline of the board it opens, which is the one
 * thing its miniature cannot say in words.
 */
export interface ContainerContentsGroup {
  /** The section this group reads, or null for the cards outside every section. */
  sectionId: string | null;
  title: string;
  color?: Section["color"];
  cards: ContainerCardRow[];
}

/** The group title for cards that belong to no section on their board. */
export const LOOSE_CARDS_TITLE = "Loose cards";

/**
 * Everything the container panel paints, for one portal card or one section.
 *
 * A container has no fields, no types and no body — that is ADR-0040 — so this
 * model is deliberately small: identity, the board it opens (portal), the colour
 * it carries, who is inside it (section) and the links drawn to it.
 */
export interface ContainerPanelModel {
  kind: "portal" | "section";
  id: string;
  title: string;
  /** A portal's target board, resolved; null when the board is gone. */
  board: Board | null;
  /** A section's record; null for a portal. */
  section: Section | null;
  /**
   * The container's palette swatch id. A section names one of the six section
   * colours; a board may name any swatch, so the field is the wider string.
   */
  color: string | null;
  /** Cards whose placement sits inside this section. */
  members: ContainerCardRow[];
  links: ContainerLinkRow[];
  /** A portal's target board grouped by section; empty for a section or a lost board. */
  contents: ContainerContentsGroup[];
  /** A portal whose board is gone: the boards it could point at instead. */
  boardOptions: Array<{ id: string; name: string }>;
  /** The icon this container shows: a section's own, or the board a portal opens. */
  icon: string | null;
  /** What the portal's `board` field stores, whether or not it resolves. */
  targetBoardId: string | null;
  /** The board holding this container, for Locate. */
  boardId: string | null;
  readOnly: boolean;
  canEditLayout: boolean;
  /**
   * A portal whose target board no longer exists. Its panel reads as empty — the
   * record is still there, but there is nothing behind it to show.
   */
  orphan: boolean;
}

const KIND_GLYPH = { card: "\u25a1", board: "\u25c9", section: "\u25ad" } as const;

/** The board a portal card opens, if its `board` field still names one. */
export function portalBoard(card: Card | undefined, boards: readonly Board[]): Board | null {
  if (!card) return null;
  const value = card.properties[PORTAL_BOARD_FIELD_ID];
  if (typeof value !== "string") return null;
  return boards.find((board) => board.id === value) ?? null;
}

/** What a portal's `board` field stores, resolved or not. */
export function portalTargetId(card: Card | undefined): string | null {
  const value = card?.properties[PORTAL_BOARD_FIELD_ID];
  return typeof value === "string" ? value : null;
}

/**
 * Sections on one board in the order the board paints them, which is the order
 * the outline reads them: the stack, then creation, then id so every client
 * derives the same list from the same record.
 */
function boardSections(boardId: string, sections: readonly Section[]): Section[] {
  return sections
    .filter((section) => section.boardId === boardId)
    .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Placements on one board, in paint order, for the cards that still exist. */
function boardPlacements(
  boardId: string,
  placements: readonly Placement[],
  cards: readonly Card[],
): Placement[] {
  const live = new Set(cards.filter((card) => !card.deletedAt).map((card) => card.id));
  return placements
    .filter((placement) => placement.boardId === boardId && live.has(placement.cardId))
    .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId));
}

export interface PortalContentsInput {
  /** The target board, or null when the portal points at nothing. */
  boardId: string | null;
  sections: readonly Section[];
  placements: readonly Placement[];
  cards: readonly Card[];
  displayTitle: (cardId: string) => string;
}

/**
 * A portal's panel reads the target board the way that board's outline does: its
 * sections in paint order with their members under them, and the cards in no
 * section last. Derived from the snapshot on every render — nothing cached and no
 * second copy of the document to keep in step.
 */
export function portalContents(input: PortalContentsInput): ContainerContentsGroup[] {
  const { boardId } = input;
  if (!boardId) return [];
  const sections = boardSections(boardId, input.sections);
  const placements = boardPlacements(boardId, input.placements, input.cards);
  const membership = sectionMembership([...placements], sections);

  const groups: ContainerContentsGroup[] = sections.map((section) => ({
    sectionId: section.id,
    title: section.title || "Untitled section",
    ...(section.color ? { color: section.color } : {}),
    cards: [],
  }));
  const groupBySection = new Map(groups.map((group) => [group.sectionId, group]));
  const loose: ContainerCardRow[] = [];

  for (const placement of placements) {
    const row: ContainerCardRow = {
      id: placement.cardId,
      title: input.displayTitle(placement.cardId),
    };
    const owner = membership.get(placement.cardId);
    const group = owner ? groupBySection.get(owner) : undefined;
    if (group) group.cards.push(row);
    else loose.push(row);
  }

  // Loose cards only get a heading when there are some: an empty "Loose cards"
  // group would read as a place to put something rather than a fact.
  if (loose.length > 0) {
    groups.push({ sectionId: null, title: LOOSE_CARDS_TITLE, cards: loose });
  }
  return groups;
}

/**
 * The boards an orphaned portal could point at instead. The board it already
 * names is left out: it is gone, so offering it back would be a dead end.
 */
export function retargetOptions(
  boards: readonly Board[],
  currentBoardId: string | null,
): Array<{ id: string; name: string }> {
  return boards
    .filter((board) => board.id !== currentBoardId)
    .map((board) => ({ id: board.id, name: board.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Links touching one container, listed by what the *other* end is: a section
 * wired to three cards reads as three rows, and a board that points back reads
 * as a board.
 */
export function containerLinks(
  kind: "section" | "board",
  id: string,
  input: {
    edges: readonly GraphEdge[];
    boards: readonly Board[];
    sections: readonly Section[];
    displayTitle: (cardId: string) => string;
  },
): ContainerLinkRow[] {
  const rows: ContainerLinkRow[] = [];
  for (const edge of input.edges) {
    const { source, target } = edgeEndpoints(edge);
    const touchesSource = source.kind === kind && source.id === id;
    const touchesTarget = target.kind === kind && target.id === id;
    if (!touchesSource && !touchesTarget) continue;
    const other = touchesSource ? target : source;
    const title =
      other.kind === "card"
        ? input.displayTitle(other.id) || "Untitled"
        : other.kind === "board"
          ? (input.boards.find((board) => board.id === other.id)?.name ?? "Board")
          : input.sections.find((section) => section.id === other.id)?.title || "Untitled section";
    rows.push({
      edgeId: edge.id,
      direction: touchesSource ? "out" : "in",
      title,
      glyph: KIND_GLYPH[other.kind],
      kind: other.kind,
      otherId: other.id,
      ...(edge.label ? { description: edge.label } : {}),
    });
  }
  return rows;
}

/**
 * Resolves the open container target into a panel model. Null when the target no
 * longer exists (a section deleted in another tab, a portal trashed), which is
 * the host's signal to close the drawer rather than paint a ghost.
 */
export function useContainerPanelModel(): ContainerPanelModel | null {
  const target = useUiStore((state) => state.containerInspector);
  const readOnly = useUiStore((state) => state.readOnly);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();

  return useMemo(() => {
    if (!target) return null;
    const { edges, boards, sections, placements, cards, types } = snapshot;
    const displayTitle = (cardId: string) => workspace.displayTitle(cardId);

    if (target.kind === "portal") {
      const card = cards.find((entry) => entry.id === target.id && !entry.deletedAt);
      if (!card) return null;
      const board = portalBoard(card, boards);
      const placement = placements.find((entry) => entry.cardId === card.id);
      return {
        kind: "portal" as const,
        id: card.id,
        title: board?.name ?? "Missing board",
        board,
        section: null,
        // A portal is a card on this board, so its icon is its own: style, then the record,
        // then the portal type's. The board's icon belongs to the board and is edited in
        // the library, which is why choosing one here cannot repaint anything else.
        icon: cardIcon(card, types.find((entry) => entry.id === card.primaryTypeId)?.icon),
        color: board?.color ?? null,
        members: [],
        links: board
          ? containerLinks("board", board.id, { edges, boards, sections, displayTitle })
          : [],
        contents: board
          ? portalContents({ boardId: board.id, sections, placements, cards, displayTitle })
          : [],
        boardOptions: board ? [] : retargetOptions(boards, portalTargetId(card)),
        targetBoardId: portalTargetId(card),
        boardId: placement?.boardId ?? null,
        readOnly,
        canEditLayout,
        orphan: board === null,
      };
    }

    const section = sections.find((entry) => entry.id === target.id);
    if (!section) return null;
    // Membership is geometric, so only this board's sections and placements may
    // take part: another board's cards share the coordinate space but not the map.
    const onBoard = boardPlacements(section.boardId, placements, cards);
    const membership = sectionMembership([...onBoard], boardSections(section.boardId, sections));
    const inside = onBoard.filter((placement) => membership.get(placement.cardId) === section.id);
    return {
      kind: "section" as const,
      id: section.id,
      title: section.title || "Untitled section",
      board: null,
      section,
      icon: sectionIcon(section),
      color: section.color ?? null,
      members: inside.map((placement) => ({
        id: placement.cardId,
        title: displayTitle(placement.cardId),
      })),
      links: containerLinks("section", section.id, { edges, boards, sections, displayTitle }),
      contents: [],
      boardOptions: [],
      targetBoardId: null,
      boardId: section.boardId,
      readOnly,
      canEditLayout,
      orphan: false,
    };
  }, [target, snapshot, workspace, readOnly, canEditLayout]);
}
