import {
  type Rect,
  rectContainsRect,
  type Section,
  sectionForCard,
  sectionLineage,
  unionRect,
} from "@suite/graph";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../interactions/multiSelect";

export interface SectionOffset {
  dx: number;
  dy: number;
}

export interface SectionGesture {
  sectionId: string;
  position: { x: number; y: number };
}

/** A section's new geometry after a card drop; only changed sections appear. */
export interface SectionRectUpdate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Breathing room a section keeps around the cards it grows to fit. */
const EXPAND_PADDING = 24;
/** Overflow a section tolerates before it is grown. */
const EXPAND_TOLERANCE = 8;

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
 * The rect changes needed when cards are dropped partly inside sections: grow
 * the section holding each card (and every ancestor of it) until every dropped
 * card fits. Sections are deduped by id, so a multi-drop is one geometry write.
 * Returns an empty list when no drop needs resizing.
 */
export function sectionsExpandPlan(sections: Section[], cards: Rect[]): SectionRectUpdate[] {
  if (sections.length === 0 || cards.length === 0) return [];

  const byId = new Map(sections.map((section) => [section.id, section]));
  const direct = new Map<string, Rect>();
  const dropped = new Map<string, Rect[]>();

  for (const card of cards) {
    const match = sectionForCard(card, sections);
    if (!match) continue;
    if (rectContainsRect(match, card, EXPAND_TOLERANCE)) continue;
    const group = dropped.get(match.id);
    if (group) group.push(card);
    else dropped.set(match.id, [card]);
  }
  if (dropped.size === 0) return [];

  for (const [id, rects] of dropped) {
    const section = byId.get(id);
    if (section) direct.set(id, unionRect(section, rects, EXPAND_PADDING));
  }

  // Ancestors are always larger than the sections they hold, so one ascending
  // pass settles the chain; the extra passes keep equal-area rectangles stable.
  const ordered = [...sections].sort(
    (a, b) => a.width * a.height - b.width * b.height || a.id.localeCompare(b.id),
  );
  const planned = new Map<string, Rect>(direct);
  for (let pass = 0; pass <= sections.length; pass += 1) {
    let changed = false;
    for (const section of ordered) {
      const descendants: Rect[] = [];
      for (const [childId, rect] of planned) {
        if (childId === section.id) continue;
        const child = byId.get(childId);
        if (child && rectContainsRect(section, child)) descendants.push(rect);
      }
      if (descendants.length === 0) continue;
      const base = direct.get(section.id) ?? section;
      const next = unionRect(base, descendants, EXPAND_PADDING);
      if (!sameRect(planned.get(section.id), next)) {
        planned.set(section.id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const updates: SectionRectUpdate[] = [];
  for (const section of ordered) {
    const rect = planned.get(section.id);
    if (!rect || sameRect(section, rect)) continue;
    updates.push({ id: section.id, ...rect });
  }
  return updates;
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
): SectionRectUpdate[] | null {
  const plan = sectionsExpandPlan(sections, [
    {
      x: position.x,
      y: position.y,
      width: size.width ?? DEFAULT_CARD_WIDTH,
      height: size.height ?? DEFAULT_CARD_HEIGHT,
    },
  ]);
  return plan.length > 0 ? plan : null;
}

function sameRect(left: Rect | undefined, right: Rect): boolean {
  return (
    left !== undefined &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
