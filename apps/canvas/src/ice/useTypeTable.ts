import { useMemo } from "react";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * The *Types in view* table's data: one row per primary card type on a board,
 * with a count and a share of that board's cards.
 *
 * This is a view, like the type graph it sits above: it derives from the
 * snapshot, writes nothing, and never invents a record. A card whose type is
 * missing from the registry gets no made-up row — it still counts towards the
 * board's total, so the shares stay honest — and a placement whose card record
 * is gone is not counted at all. Trashed cards are excluded, because a trashed
 * card is not on the view. The primary type is the one the canvas draws, so the
 * table's numbers agree with the graph band's counts.
 */

export interface TypeTableRow {
  readonly typeId: string;
  readonly name: string;
  readonly glyph: string;
  readonly color?: string | undefined;
  readonly count: number;
  /** `count` over the board's live cards, 0…1; 0 for an empty board. */
  readonly share: number;
}

/** The slice of a card the table needs; `Card` satisfies it. */
export interface TypeTableCard {
  readonly id: string;
  readonly primaryTypeId: string;
  readonly deletedAt?: number | null | undefined;
}

export interface TypeTablePlacement {
  readonly boardId: string;
  readonly cardId: string;
}

/** The slice of a type the table needs; `CardType` satisfies it. */
export interface TypeTableType {
  readonly id: string;
  readonly name: string;
  readonly glyph: string;
  readonly color?: string | undefined;
}

/** A `WorkspaceSnapshot` satisfies this; tests pass just these three lists. */
export interface TypeTableInput {
  readonly cards: readonly TypeTableCard[];
  readonly placements: readonly TypeTablePlacement[];
  readonly types: readonly TypeTableType[];
}

interface BoardTypeCounts {
  readonly byType: ReadonlyMap<string, number>;
  readonly total: number;
}

function cardIndex(input: TypeTableInput): Map<string, TypeTableCard> {
  return new Map(input.cards.map((card) => [card.id, card]));
}

/** One pass over the board's placements: counts per known type plus the total. */
function boardTypeCounts(input: TypeTableInput, boardId: string | null): BoardTypeCounts {
  const byType = new Map<string, number>();
  if (boardId === null) return { byType, total: 0 };
  const cards = cardIndex(input);
  const knownTypes = new Set(input.types.map((type) => type.id));
  let total = 0;
  for (const placement of input.placements) {
    if (placement.boardId !== boardId) continue;
    const card = cards.get(placement.cardId);
    if (card === undefined || card.deletedAt) continue;
    total += 1;
    if (!knownTypes.has(card.primaryTypeId)) continue;
    byType.set(card.primaryTypeId, (byType.get(card.primaryTypeId) ?? 0) + 1);
  }
  return { byType, total };
}

/**
 * Rows for one board, sorted by count (most first) then name, with the type id
 * as the last tiebreaker so two clients never draw a different order.
 */
export function typeTableRows(input: TypeTableInput, boardId: string | null): TypeTableRow[] {
  const { byType, total } = boardTypeCounts(input, boardId);
  if (total === 0) return [];
  const types = new Map(input.types.map((type) => [type.id, type]));
  const rows: TypeTableRow[] = [];
  for (const [typeId, count] of byType) {
    const type = types.get(typeId);
    if (type === undefined) continue;
    rows.push({
      typeId,
      name: type.name,
      glyph: type.glyph,
      ...(type.color === undefined ? {} : { color: type.color }),
      count,
      share: count / total,
    });
  }
  rows.sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.typeId.localeCompare(b.typeId),
  );
  return rows;
}

/**
 * The cards one row's actions operate on — "select all in type" and framing.
 * Same rules as the rows themselves: this board, live cards, primary type.
 */
export function typeTableCardIds(
  input: TypeTableInput,
  boardId: string | null,
  typeId: string,
): string[] {
  if (boardId === null) return [];
  const cards = cardIndex(input);
  const ids = new Set<string>();
  for (const placement of input.placements) {
    if (placement.boardId !== boardId) continue;
    const card = cards.get(placement.cardId);
    if (card === undefined || card.deletedAt) continue;
    if (card.primaryTypeId !== typeId) continue;
    ids.add(card.id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * The table for a board, kept live by the workspace snapshot. `boardId` defaults
 * to the canvas's active board; pass one explicitly when the surface is showing
 * a board the store does not consider active (a portal).
 */
export function useTypeTable(boardId?: string | null): TypeTableRow[] {
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const board = boardId === undefined ? activeBoardId : boardId;
  return useMemo(() => typeTableRows(snapshot, board), [snapshot, board]);
}
