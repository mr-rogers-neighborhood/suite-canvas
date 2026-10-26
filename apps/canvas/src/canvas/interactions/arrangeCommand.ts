import type {
  LayoutPlan,
  LayoutPlanPlacement,
  LayoutPlanSection,
  Placement,
  Section,
} from "@suite/graph";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./multiSelect";

/**
 * Align and distribute: the Arrangement a canvas user actually reaches for.
 *
 * Planning is pure — selection plus placements in, a `LayoutPlan` out — so it can
 * be previewed, tested without a renderer, and applied in one undoable batch by
 * `WorkspaceDocument.applyLayoutPlan`. Nothing here reads Loro.
 *
 * Sections are deliberately not arranged: they are containers, and their members
 * choose where they sit. A section that holds a moved card grows to fit it instead
 * (`growSectionsToFit`), which is the same rule the canvas already applies while
 * dragging.
 */

export const ALIGNMENTS = ["left", "centerHorizontal", "right", "top", "middle", "bottom"] as const;

export type AlignEdge = (typeof ALIGNMENTS)[number];

export const DISTRIBUTIONS = ["horizontal", "vertical"] as const;

export type DistributeAxis = (typeof DISTRIBUTIONS)[number];

export interface ArrangeTarget {
  boardId: string;
  placements: readonly Placement[];
  sections: readonly Section[];
  /** Cards that must move; anything not selected is left exactly where it is. */
  selectedCardIds: readonly string[];
}

/** The box a placement occupies, using the same defaults the canvas paints with. */
function boxOf(placement: Placement) {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width ?? DEFAULT_CARD_WIDTH,
    height: placement.height ?? DEFAULT_CARD_HEIGHT,
  };
}

/** The selected placements on this board, in paint order, so results are stable. */
function selectedOnBoard(target: ArrangeTarget): Placement[] {
  const selected = new Set(target.selectedCardIds);
  return target.placements
    .filter((placement) => placement.boardId === target.boardId && selected.has(placement.cardId))
    .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId));
}

/**
 * Align every selected card to one edge (or one centre line) of their common
 * bounding box. Two cards are enough; one is a no-op, because aligning a card to
 * itself would only jitter it by rounding.
 */
export function planAlign(target: ArrangeTarget, edge: AlignEdge): LayoutPlan | null {
  const chosen = selectedOnBoard(target);
  if (chosen.length < 2) return null;

  const boxes = chosen.map(boxOf);
  const minX = Math.min(...boxes.map((box) => box.x));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  const placements: LayoutPlanPlacement[] = chosen.flatMap((placement) => {
    const box = boxOf(placement);
    switch (edge) {
      case "left":
        return [{ boardId: placement.boardId, cardId: placement.cardId, x: minX, y: box.y }];
      case "right":
        return [
          { boardId: placement.boardId, cardId: placement.cardId, x: maxX - box.width, y: box.y },
        ];
      case "centerHorizontal":
        return [
          {
            boardId: placement.boardId,
            cardId: placement.cardId,
            x: (minX + maxX) / 2 - box.width / 2,
            y: box.y,
          },
        ];
      case "top":
        return [{ boardId: placement.boardId, cardId: placement.cardId, x: box.x, y: minY }];
      case "bottom":
        return [
          { boardId: placement.boardId, cardId: placement.cardId, x: box.x, y: maxY - box.height },
        ];
      default:
        return [
          {
            boardId: placement.boardId,
            cardId: placement.cardId,
            x: box.x,
            y: (minY + maxY) / 2 - box.height / 2,
          },
        ];
    }
  });

  return finish(target, placements, chosen);
}

/**
 * Spread the selected cards so the gaps between them are equal along one axis.
 * The two extremes stay put — that is what makes the result predictable — and
 * everything between them is redistributed. Cards are handled in visual order,
 * not selection order, so the same selection always yields the same result.
 */
export function planDistribute(target: ArrangeTarget, axis: DistributeAxis): LayoutPlan | null {
  const chosen = selectedOnBoard(target);
  if (chosen.length < 3) return null;

  const boxes = chosen.map((placement) => ({ placement, box: boxOf(placement) }));
  const sorted = [...boxes].sort((a, b) =>
    axis === "horizontal" ? a.box.x - b.box.x : a.box.y - b.box.y,
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;

  const span =
    axis === "horizontal"
      ? last.box.x + last.box.width - first.box.x
      : last.box.y + last.box.height - first.box.y;
  const totalSize = sorted.reduce(
    (sum, entry) => sum + (axis === "horizontal" ? entry.box.width : entry.box.height),
    0,
  );
  const gap = (span - totalSize) / (sorted.length - 1);

  const placements: LayoutPlanPlacement[] = [];
  let cursor = axis === "horizontal" ? first.box.x : first.box.y;
  for (const entry of sorted) {
    placements.push(
      axis === "horizontal"
        ? {
            boardId: entry.placement.boardId,
            cardId: entry.placement.cardId,
            x: cursor,
            y: entry.box.y,
          }
        : {
            boardId: entry.placement.boardId,
            cardId: entry.placement.cardId,
            x: entry.box.x,
            y: cursor,
          },
    );
    cursor += (axis === "horizontal" ? entry.box.width : entry.box.height) + gap;
  }

  return finish(target, placements, chosen);
}

/**
 * A section that holds any moved card grows to contain it again. Shrinking is
 * deliberately not done: a section someone sized by hand is theirs, and pulling
 * it in around its contents would undo that choice.
 */
export function growSectionsToFit(
  sections: readonly Section[],
  placed: readonly { x: number; y: number; width: number; height: number }[],
): LayoutPlanSection[] {
  const grown: LayoutPlanSection[] = [];
  for (const section of sections) {
    const inside = placed.filter(
      (box) =>
        box.x + box.width >= section.x &&
        box.x <= section.x + section.width &&
        box.y + box.height >= section.y &&
        box.y <= section.y + section.height,
    );
    if (inside.length === 0) continue;
    const right = Math.max(...inside.map((box) => box.x + box.width));
    const bottom = Math.max(...inside.map((box) => box.y + box.height));
    const nextWidth = Math.max(section.width, right - section.x);
    const nextHeight = Math.max(section.height, bottom - section.y);
    if (nextWidth === section.width && nextHeight === section.height) continue;
    grown.push({
      sectionId: section.id,
      x: section.x,
      y: section.y,
      width: nextWidth,
      height: nextHeight,
    });
  }
  return grown;
}

/** Drops writes that would not change anything, then wraps them in a plan. */
function finish(
  target: ArrangeTarget,
  placements: readonly LayoutPlanPlacement[],
  chosen: readonly Placement[],
): LayoutPlan | null {
  const before = new Map(chosen.map((placement) => [placement.cardId, boxOf(placement)]));
  const moved = placements.filter((placement) => {
    const previous = before.get(placement.cardId);
    return !previous || previous.x !== placement.x || previous.y !== placement.y;
  });
  if (moved.length === 0) return null;

  const boxes = chosen.map((placement) => {
    const next = moved.find((entry) => entry.cardId === placement.cardId);
    const box = boxOf(placement);
    return { ...box, x: next?.x ?? box.x, y: next?.y ?? box.y };
  });
  const sections = growSectionsToFit(target.sections, boxes);

  return {
    boards: [target.boardId],
    placements: moved,
    ...(sections.length > 0 ? { sections } : {}),
  };
}
