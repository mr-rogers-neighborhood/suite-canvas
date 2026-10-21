import { rectContainsRect, type Section } from "@suite/graph";
import type { PeerPresence } from "../collab/presence";

/** Indentation levels the rail draws; deeper nesting stays at the last level. */
export const OUTLINE_MAX_DEPTH = 4;

export interface OutlineRow {
  section: Section;
  /** 0 for a top-level section, at most `OUTLINE_MAX_DEPTH`. */
  depth: number;
  /** Cards whose smallest containing section is this one. */
  count: number;
}

function area(section: Section): number {
  return section.width * section.height;
}

function byReadingOrder(a: Section, b: Section): number {
  return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
}

/**
 * The smallest section fully containing `section`. Crossing rectangles are not
 * nesting, so only real containment creates a parent; ties fall back to the id
 * so every client builds the same tree.
 */
export function outlineParent(section: Section, sections: Section[]): Section | undefined {
  let parent: Section | undefined;
  for (const candidate of sections) {
    if (candidate.id === section.id || !rectContainsRect(candidate, section)) continue;
    if (!parent) {
      parent = candidate;
      continue;
    }
    const difference = area(candidate) - area(parent);
    if (difference < 0 || (difference === 0 && candidate.id.localeCompare(parent.id) < 0)) {
      parent = candidate;
    }
  }
  return parent;
}

/**
 * Rails rows in reading order (top-left first). Depth comes from containment,
 * never from the order sections were created.
 */
export function outlineRows(sections: Section[], membership: Map<string, string>): OutlineRow[] {
  const counts = new Map<string, number>();
  for (const sectionId of membership.values()) {
    counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
  }

  return [...sections].sort(byReadingOrder).map((section) => {
    let depth = 0;
    let current = section;
    // Equal rectangles would otherwise nest into each other forever.
    const seen = new Set([section.id]);
    while (depth < OUTLINE_MAX_DEPTH) {
      const parent = outlineParent(current, sections);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      depth += 1;
      current = parent;
    }
    return { section, depth, count: counts.get(section.id) ?? 0 };
  });
}

/**
 * Peers touching each section: selecting it, dragging it, or resizing it. One
 * entry per peer per section even while several of those hold at once.
 */
export function outlinePeerIds(peers: PeerPresence[]): Map<string, PeerPresence[]> {
  const bySection = new Map<string, PeerPresence[]>();
  for (const peer of peers) {
    const sectionIds = new Set<string>();
    if (peer.selection?.sectionId) sectionIds.add(peer.selection.sectionId);
    if (peer.sectionDrag?.sectionId) sectionIds.add(peer.sectionDrag.sectionId);
    if (peer.sectionResize?.sectionId) sectionIds.add(peer.sectionResize.sectionId);
    for (const sectionId of sectionIds) {
      const list = bySection.get(sectionId);
      if (list) list.push(peer);
      else bySection.set(sectionId, [peer]);
    }
  }
  return bySection;
}
