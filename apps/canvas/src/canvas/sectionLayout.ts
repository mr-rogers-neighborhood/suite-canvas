import {
  type Rect,
  rectContainsRect,
  type Section,
  sectionForCard,
  sectionLineage,
  unionRect,
} from "@suite/graph";

export interface SectionOffset {
  dx: number;
  dy: number;
}

export interface SectionGesture {
  sectionId: string;
  position: { x: number; y: number };
}

/**
 * Converts section top-left positions being dragged (locally or by a peer) into
 * offsets for the section itself and every section contained by it.
 */
export function sectionOffsets(
  sections: Section[],
  gestures: SectionGesture[],
): Map<string, SectionOffset> {
  const offsets = new Map<string, SectionOffset>();
  for (const gesture of gestures) {
    const root = sections.find((section) => section.id === gesture.sectionId);
    if (!root) continue;
    const dx = gesture.position.x - root.x;
    const dy = gesture.position.y - root.y;
    if (dx === 0 && dy === 0) continue;
    for (const section of sectionLineage(root.id, sections)) {
      offsets.set(section.id, { dx, dy });
    }
  }
  return offsets;
}

/** Card offsets for a section drag, resolved from the derived membership. */
export function cardSectionOffsets(
  membership: Map<string, string>,
  offsets: Map<string, SectionOffset>,
): Map<string, SectionOffset> {
  const result = new Map<string, SectionOffset>();
  for (const [cardId, sectionId] of membership) {
    const offset = offsets.get(sectionId);
    if (offset) result.set(cardId, offset);
  }
  return result;
}

/**
 * The rect changes needed when a card is dropped partly inside a section: grow
 * the section (and any ancestors that contained it) to include the card.
 * Returns null when the drop needs no resizing.
 */
export function sectionExpandPlan(
  sections: Section[],
  position: { x: number; y: number },
  size: { width?: number | undefined; height?: number | undefined },
): { id: string; x: number; y: number; width: number; height: number }[] | null {
  const match = sectionForCard(position, sections);
  if (!match) return null;

  const card: Rect = {
    x: position.x,
    y: position.y,
    width: size.width ?? 224,
    height: size.height ?? 160,
  };
  if (rectContainsRect(match, card, 8)) return null;

  const updates = new Map<string, { x: number; y: number; width: number; height: number }>();
  let current = unionRect(match, [card], 24);
  updates.set(match.id, current);

  const ancestors = sections
    .filter((section) => section.id !== match.id && rectContainsRect(section, match))
    .sort((a, b) => a.width * a.height - b.width * b.height);

  for (const ancestor of ancestors) {
    const next = unionRect(ancestor, [current], 24);
    updates.set(ancestor.id, next);
    current = next;
  }

  return [...updates].map(([id, rect]) => ({ id, ...rect }));
}
