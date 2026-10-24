import { rectContainsRect, type Section } from "@suite/graph";

/** Indentation levels a Board's grouping draws; deeper nesting stays at the last level. */
const MAX_ROW_DEPTH = 4;

export interface BoardRow {
  section: Section;
  /** 0 for a top-level section, at most `MAX_ROW_DEPTH`. */
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
function sectionParent(section: Section, sections: Section[]): Section | undefined {
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
 * Board rows in reading order (top-left first). Depth comes from containment,
 * never from the order sections were created.
 */
export function boardRows(sections: Section[], membership: Map<string, string>): BoardRow[] {
  const counts = new Map<string, number>();
  for (const sectionId of membership.values()) {
    counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
  }

  return [...sections].sort(byReadingOrder).map((section) => {
    let depth = 0;
    let current = section;
    // Equal rectangles would otherwise nest into each other forever.
    const seen = new Set([section.id]);
    while (depth < MAX_ROW_DEPTH) {
      const parent = sectionParent(current, sections);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      depth += 1;
      current = parent;
    }
    return { section, depth, count: counts.get(section.id) ?? 0 };
  });
}
