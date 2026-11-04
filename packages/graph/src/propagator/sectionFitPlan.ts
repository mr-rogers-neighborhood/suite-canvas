/**
 * A section's box, recomputed from what is actually inside it — its member cards **and the
 * sections nested in it**.
 *
 * `proposeReflowPlan` fits a section to the cards a drag displaced. That is right for a flat
 * board and wrong for a nested one: an outer section that holds an inner section sees none of
 * the inner section's cards as its own (a card belongs to the smallest frame containing it), so
 * it either collapsed to nothing or fought the child for the same space. Treating a nested
 * section as one more member box is what makes nesting behave: the child is laid out first, the
 * parent then grows to hold the child's *new* box, exactly as it would for a card.
 *
 * Pure: it reads sections and placements and returns a plan. Applying it is the caller's job.
 */

import type { LayoutPlan, LayoutPlanSection } from "../layoutPlan.js";
import { MIN_LAYOUT_SECTION_HEIGHT, MIN_LAYOUT_SECTION_WIDTH } from "../layoutPlan.js";
import type { Placement, Section } from "../schema.js";
import { cardAnchor, type Rect, rectContainsRect } from "../sections.js";

/** Matches `DEFAULT_REFLOW_SECTION_PADDING`, so a gesture-driven refit and a drag-driven one agree. */
export const DEFAULT_SECTION_FIT_PADDING = 24;

/** The title bar a section reserves above its first card, after `computeSectionResizes`. */
const TOP_PADDING_FLOOR = 40;

/** What an empty section collapses to when the reader asks it to fit. */
const EMPTY_SECTION_WIDTH = 160;
const EMPTY_SECTION_HEIGHT = 120;

/** Below this the numbers are noise from rounding, not a change worth a write. */
const GEOMETRY_EPSILON = 0.5;

export interface SectionFitPlanInput {
  readonly boardId: string;
  readonly sections: readonly Section[];
  readonly placements: readonly Placement[];
  readonly cardSizes?:
    | ReadonlyMap<string, { readonly width: number; readonly height: number }>
    | undefined;
  readonly padding?: number | undefined;
  /**
   * Section rects the caller has just written, or is about to. The document may not have
   * observed them yet, and a plan built on the old geometry would undo the gesture.
   */
  readonly sectionOverrides?: ReadonlyMap<string, Rect> | undefined;
  /** Card positions from the same gesture, for the same reason. */
  readonly placementOverrides?:
    | ReadonlyMap<string, { readonly x: number; readonly y: number }>
    | undefined;
  /**
   * Set when the caller has already landed the `sectionOverrides`. The plan then fits around them
   * and leaves them out of its own writes, so a gesture is not written twice and the undo history
   * does not carry a no-op entry.
   */
  readonly overridesAreWritten?: boolean | undefined;
  /**
   * Sections that collapse to a small box when they hold nothing. Opt-in per id: a refit that
   * followed a drag must leave an empty section exactly where the reader put it.
   */
  readonly collapseEmpty?: ReadonlySet<string> | undefined;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const area = (box: Box) => box.width * box.height;

function rectOf(section: Section): Rect {
  return { x: section.x, y: section.y, width: section.width, height: section.height };
}

function containsPoint(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * The card's own section: the smallest frame whose rect holds its header anchor, the same rule
 * `sectionMembership` applies, so a card never counts for two nested frames at once.
 */
function ownerOf(
  placement: Placement,
  sections: readonly { id: string; rect: Rect }[],
): string | null {
  const anchor = cardAnchor(placement);
  let best: { id: string; rect: Rect } | null = null;
  for (const section of sections) {
    if (!containsPoint(section.rect, anchor)) continue;
    if (best === null || area(section.rect) < area(best.rect)) best = section;
  }
  return best?.id ?? null;
}

/**
 * The plan, or null when every section already holds what it holds.
 *
 * Sections are laid out smallest first, because a frame's box depends on the frames inside it.
 * Area ordering is enough: a section nested in another is strictly smaller, so a child is
 * always handled before its parent and its new box is the one the parent grows around.
 */
export function planSectionFit(input: SectionFitPlanInput): LayoutPlan | null {
  const { boardId, sections, placements, cardSizes, sectionOverrides, placementOverrides } = input;
  const board = sections.filter((section) => section.boardId === boardId);
  if (board.length === 0) return null;

  const padding = input.padding ?? DEFAULT_SECTION_FIT_PADDING;
  const stored = new Map(board.map((section) => [section.id, rectOf(section)]));
  // Overrides seed the settled map as well as the current rect: a child the caller has already
  // resized is that size for its parent even when the child itself has nothing inside it to fit.
  const effective = new Map<string, Rect>(stored);
  for (const [id, rect] of sectionOverrides ?? []) {
    if (stored.has(id)) effective.set(id, rect);
  }

  const positioned = placements
    .filter((placement) => placement.boardId === boardId)
    .map((placement) => {
      const override = placementOverrides?.get(placement.cardId);
      return override ? { ...placement, x: override.x, y: override.y } : placement;
    });

  // Membership is read from the *stored* frames: a card belongs to the frame it was dropped in,
  // and a parent growing because of its child must not steal the child's cards.
  const storedFrames = board.map((section) => ({ id: section.id, rect: rectOf(section) }));
  const members = new Map<string, string[]>();
  for (const placement of positioned) {
    const owner = ownerOf(placement, storedFrames);
    if (owner === null) continue;
    const list = members.get(owner);
    if (list) list.push(placement.cardId);
    else members.set(owner, [placement.cardId]);
  }
  const placementById = new Map(positioned.map((placement) => [placement.cardId, placement]));

  const writes: LayoutPlanSection[] = [];
  const ordered = [...board].sort(
    (a, b) => area(rectOf(a)) - area(rectOf(b)) || a.id.localeCompare(b.id),
  );

  for (const section of ordered) {
    const override = sectionOverrides?.get(section.id);
    const current = override ?? stored.get(section.id) ?? rectOf(section);
    const before = stored.get(section.id) ?? current;

    /**
     * A rect the caller already decided — a drag or a resize the reader just made — is the answer
     * for that frame, not an input to be fitted. Snapping it back to the tight box around its
     * members would undo the gesture; what it still does is let the frames *around* it use it.
     */
    if (override) {
      effective.set(section.id, override);
      if (
        input.overridesAreWritten !== true &&
        (Math.abs(override.x - before.x) > GEOMETRY_EPSILON ||
          Math.abs(override.y - before.y) > GEOMETRY_EPSILON ||
          Math.abs(override.width - before.width) > GEOMETRY_EPSILON ||
          Math.abs(override.height - before.height) > GEOMETRY_EPSILON)
      ) {
        writes.push({
          sectionId: section.id,
          x: Math.round(override.x),
          y: Math.round(override.y),
          width: Math.round(override.width),
          height: Math.round(override.height),
        });
      }
      continue;
    }

    const boxes: Box[] = [];

    for (const cardId of members.get(section.id) ?? []) {
      const placement = placementById.get(cardId);
      if (!placement) continue;
      const measured = cardSizes?.get(cardId);
      boxes.push({
        x: placement.x,
        y: placement.y,
        width: measured?.width ?? placement.width ?? 0,
        height: measured?.height ?? placement.height ?? 0,
      });
    }

    /**
     * Every frame nested in this one contributes the box it has *now*: the child's new box when it
     * has already been handled in this pass, or the one the caller moved or resized it to.
     *
     * Whether it is still a member depends on the gesture, not only on geometry. A child that was
     * **resized** stays a member even though it now sticks out, because that is the whole point of
     * an elastic parent: it grows to hold it. A child that was **moved** keeps its membership only
     * while it still overlaps the frame, so dragging it out drops it instead of dragging the parent
     * along the board after it.
     */
    const parentStored = stored.get(section.id) ?? rectOf(section);
    for (const child of board) {
      if (child.id === section.id) continue;
      const box = effective.get(child.id);
      const asStored = stored.get(child.id);
      if (!box || !asStored || !rectContainsRect(parentStored, asStored)) continue;
      const resized =
        Math.abs(box.width - asStored.width) > GEOMETRY_EPSILON ||
        Math.abs(box.height - asStored.height) > GEOMETRY_EPSILON;
      if (!resized && !overlaps(parentStored, box)) continue;
      boxes.push(box);
    }

    const collapsed =
      boxes.length === 0 && input.collapseEmpty?.has(section.id) === true
        ? { ...current, width: EMPTY_SECTION_WIDTH, height: EMPTY_SECTION_HEIGHT }
        : null;
    const next =
      collapsed ?? (boxes.length === 0 ? null : fittedRect(section, current, boxes, padding));
    if (next === null) continue;

    effective.set(section.id, next);
    if (
      Math.abs(next.x - before.x) <= GEOMETRY_EPSILON &&
      Math.abs(next.y - before.y) <= GEOMETRY_EPSILON &&
      Math.abs(next.width - before.width) <= GEOMETRY_EPSILON &&
      Math.abs(next.height - before.height) <= GEOMETRY_EPSILON
    ) {
      continue;
    }
    writes.push({
      sectionId: section.id,
      x: Math.round(next.x),
      y: Math.round(next.y),
      width: Math.round(next.width),
      height: Math.round(next.height),
    });
  }

  if (writes.length === 0) return null;
  return { boards: [boardId], placements: [], sections: writes };
}

/**
 * The box a section takes around `boxes`, in the two modes the reflow already uses: elastic
 * (tight, both ways) and fixed (grow to hold what moved, never shrink).
 */
/** Two rects sharing any area at all, edges touching not counted. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function fittedRect(section: Section, current: Rect, boxes: readonly Box[], padding: number): Rect {
  const minLeft = Math.min(...boxes.map((box) => box.x));
  const minTop = Math.min(...boxes.map((box) => box.y));
  const maxRight = Math.max(...boxes.map((box) => box.x + box.width));
  const maxBottom = Math.max(...boxes.map((box) => box.y + box.height));

  const elastic = section.shrinkToFit !== false;
  const topPadding = Math.max(padding, TOP_PADDING_FLOOR);

  const left = elastic ? minLeft - padding : Math.min(current.x, minLeft - padding);
  const top = elastic ? minTop - topPadding : Math.min(current.y, minTop - topPadding);
  const right = elastic
    ? maxRight + padding
    : Math.max(current.x + current.width, maxRight + padding);
  const bottom = elastic
    ? maxBottom + padding
    : Math.max(current.y + current.height, maxBottom + padding);

  return {
    x: left,
    y: top,
    width: Math.max(MIN_LAYOUT_SECTION_WIDTH, right - left),
    height: Math.max(MIN_LAYOUT_SECTION_HEIGHT, bottom - top),
  };
}
