import type { Board, Card, GraphEdge, Section } from "@suite/graph";
import { edgeEndpoints, PORTAL_BOARD_FIELD_ID, sectionMembership } from "@suite/graph";
import { useMemo } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/** One drawn link as the container panel reads it: the other end, and its label. */
export interface ContainerLinkRow {
  edgeId: string;
  direction: "in" | "out";
  /** What the link points at, in words: a card title, a section title, a board name. */
  title: string;
  /** Glyph for the other end's kind, so the list reads like the link itself. */
  glyph: string;
  kind: "card" | "board" | "section";
  description?: string | undefined;
}

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
  color: Section["color"] | null;
  /** Cards whose placement sits inside a section. */
  memberTitles: string[];
  links: ContainerLinkRow[];
  /** The board holding this container, for Locate. */
  boardId: string | null;
  readOnly: boolean;
  canEditLayout: boolean;
}

const KIND_GLYPH = { card: "\u25a1", board: "\u25c9", section: "\u25ad" } as const;

/** The board a portal card opens, if its `board` field still names one. */
export function portalBoard(card: Card | undefined, boards: readonly Board[]): Board | null {
  if (!card) return null;
  const value = card.properties[PORTAL_BOARD_FIELD_ID];
  if (typeof value !== "string") return null;
  return boards.find((board) => board.id === value) ?? null;
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
    const { edges, boards, sections, placements } = snapshot;
    const displayTitle = (cardId: string) => workspace.displayTitle(cardId);

    if (target.kind === "portal") {
      const card = snapshot.cards.find((entry) => entry.id === target.id && !entry.deletedAt);
      if (!card) return null;
      const board = portalBoard(card, boards);
      const placement = placements.find((entry) => entry.cardId === card.id);
      return {
        kind: "portal" as const,
        id: card.id,
        title: board?.name ?? "Missing board",
        board,
        section: null,
        color: board?.color ?? null,
        memberTitles: [],
        links: board
          ? containerLinks("board", board.id, { edges, boards, sections, displayTitle })
          : [],
        boardId: placement?.boardId ?? null,
        readOnly,
        canEditLayout,
      };
    }

    const section = sections.find((entry) => entry.id === target.id);
    if (!section) return null;
    const membership = sectionMembership([...placements], [...sections]);
    const memberIds = [...membership]
      .filter(([, sectionId]) => sectionId === section.id)
      .map(([cardId]) => cardId);
    return {
      kind: "section" as const,
      id: section.id,
      title: section.title || "Untitled section",
      board: null,
      section,
      color: section.color ?? null,
      memberTitles: memberIds.map(displayTitle),
      links: containerLinks("section", section.id, { edges, boards, sections, displayTitle }),
      boardId: section.boardId,
      readOnly,
      canEditLayout,
    };
  }, [target, snapshot, workspace, readOnly, canEditLayout]);
}
