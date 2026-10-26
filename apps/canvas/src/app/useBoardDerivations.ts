import { resolveSurfaceStyle, sectionForCard, sectionMembership } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { outlineRows } from "../canvas/outlineTree";
import { surfacePaintVars } from "../canvas/surfacePaint";
import { sectionPath } from "../cards/cardWhere";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { UNSORTED_SECTION } from "../library/libraryFilters";

/** Board-scoped reads the shell needs for paint, the outline and the library. */
export function useBoardDerivations(args: {
  snapshot: WorkspaceSnapshot;
  activeBoardId: string | null;
}) {
  const { snapshot, activeBoardId } = args;
  const activeBoardName = snapshot.boards.find((board) => board.id === activeBoardId)?.name ?? null;
  // The canvas behind the cards is a surface of its own (ADR-0051 §1), so the
  // board's style paints it. React Flow's own layer reads --xy-background-color,
  // which is what lets the paint reach it without the canvas knowing about styles.
  const boardPaint = useMemo((): Record<string, string> => {
    const board = snapshot.boards.find((entry) => entry.id === activeBoardId);
    if (!board?.style) return {};
    const paint = surfacePaintVars(resolveSurfaceStyle(board.style, "board"));
    return { ...paint, "--xy-background-color": "var(--paint-surface)" };
  }, [snapshot.boards, activeBoardId]);
  const boardPainted = Object.keys(boardPaint).length > 0;
  const boardSections = useMemo(
    () =>
      activeBoardId ? snapshot.sections.filter((section) => section.boardId === activeBoardId) : [],
    [snapshot.sections, activeBoardId],
  );
  const boardPlacements = useMemo(
    () =>
      activeBoardId
        ? snapshot.placements.filter((placement) => placement.boardId === activeBoardId)
        : [],
    [snapshot.placements, activeBoardId],
  );
  const boardMembership = useMemo(
    () =>
      activeBoardId ? sectionMembership(boardPlacements, boardSections) : new Map<string, string>(),
    [activeBoardId, boardPlacements, boardSections],
  );
  // The same trees the outline rail draws, so the facet and the grouping agree
  // with it about order and depth.
  const sectionOrder = useMemo(
    () =>
      outlineRows(boardSections, boardMembership).map((row) => ({
        id: row.section.id,
        title: row.section.title.trim() || "Untitled section",
        depth: row.depth,
      })),
    [boardSections, boardMembership],
  );

  /**
   * A card's section on the active board plus every ancestor, innermost first,
   * or the unsorted sentinel. Selecting a section therefore includes its subtree.
   */
  const sectionIdsByCard = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const placement of boardPlacements) {
      const match = sectionForCard(placement, boardSections);
      ids.set(
        placement.cardId,
        match
          ? sectionPath(match, boardSections)
              .map((section) => section.id)
              .reverse()
          : [UNSORTED_SECTION],
      );
    }
    return ids;
  }, [boardPlacements, boardSections]);

  const sectionIdsFor = useCallback(
    (cardId: string): string[] => sectionIdsByCard.get(cardId) ?? [UNSORTED_SECTION],
    [sectionIdsByCard],
  );

  return {
    activeBoardName,
    boardPaint,
    boardPainted,
    boardSections,
    boardPlacements,
    boardMembership,
    sectionOrder,
    sectionIdsFor,
  };
}
