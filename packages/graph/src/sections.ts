import type { Placement, Section } from "./schema.js";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Inside the card header, so membership only depends on stored placement coordinates. */
export const CARD_ANCHOR_INSET = 8;

/** A card's membership anchor: its top-left header point, never its measured center. */
export function cardAnchor(placement: Pick<Placement, "x" | "y">): Point {
  return { x: placement.x + CARD_ANCHOR_INSET, y: placement.y + CARD_ANCHOR_INSET };
}

export function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Full containment with a small tolerance for fractional flow coordinates. */
export function rectContainsRect(outer: Rect, inner: Rect, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function area(section: Section): number {
  return section.width * section.height;
}

/** Sections whose rectangle contains the point, most specific first. */
export function sectionsAt(point: Point, sections: Section[]): Section[] {
  return sections
    .filter((section) => rectContainsPoint(section, point))
    .sort((a, b) => area(a) - area(b) || b.z - a.z || a.id.localeCompare(b.id));
}

/**
 * One section per card: the smallest section containing its anchor. Tie-break
 * is the higher section, then the id, so every client resolves it identically.
 */
export function sectionMembership(
  placements: Placement[],
  sections: Section[],
): Map<string, string> {
  const membership = new Map<string, string>();
  if (sections.length === 0) return membership;
  for (const placement of placements) {
    const [match] = sectionsAt(cardAnchor(placement), sections);
    if (match) membership.set(placement.cardId, match.id);
  }
  return membership;
}

/** A card's section on one board, if any. */
export function sectionForCard(
  placement: Pick<Placement, "x" | "y">,
  sections: Section[],
): Section | undefined {
  return sectionsAt(cardAnchor(placement), sections)[0];
}

/** Sections geometrically inside a section, excluding the section itself. */
export function containedSections(section: Section, sections: Section[]): Section[] {
  return sections.filter(
    (candidate) => candidate.id !== section.id && rectContainsRect(section, candidate),
  );
}

/** A section plus every section geometrically contained by it. */
export function sectionLineage(sectionId: string, sections: Section[]): Section[] {
  const root = sections.find((section) => section.id === sectionId);
  if (!root) return [];
  return [root, ...containedSections(root, sections)];
}

/**
 * The set that moves with a section drag. Membership is captured from stored
 * geometry, so every client derives the same plan before any write lands.
 */
export function sectionMovePlan(
  sectionId: string,
  sections: Section[],
  placements: Placement[],
): { sections: Section[]; placements: Placement[] } {
  const movingSections = sectionLineage(sectionId, sections);
  const movingIds = new Set(movingSections.map((section) => section.id));
  if (movingIds.size === 0) return { sections: [], placements: [] };

  const membership = sectionMembership(placements, sections);
  const movingPlacements = placements.filter((placement) => {
    const owner = membership.get(placement.cardId);
    return owner !== undefined && movingIds.has(owner);
  });
  return { sections: movingSections, placements: movingPlacements };
}

/** The smallest rectangle containing a section and the given rectangles. */
export function unionRect(rect: Rect, others: Rect[], padding = 0): Rect {
  let minX = rect.x;
  let minY = rect.y;
  let maxX = rect.x + rect.width;
  let maxY = rect.y + rect.height;

  for (const other of others) {
    minX = Math.min(minX, other.x);
    minY = Math.min(minY, other.y);
    maxX = Math.max(maxX, other.x + other.width);
    maxY = Math.max(maxY, other.y + other.height);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
