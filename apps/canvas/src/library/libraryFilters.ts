export interface FilterableItem {
  typeIds: string[];
  tagIds: string[];
  /**
   * The card's section on the scoped board plus every ancestor, innermost
   * first, or `[UNSORTED_SECTION]` when it sits in none. Selecting a section
   * therefore includes its whole subtree.
   */
  sectionIds?: string[];
}

/** Explicit facet value for cards that are on the scoped board but in no section. */
export const UNSORTED_SECTION = "__unsorted__";

export function matchesFilters(
  item: FilterableItem,
  typeIds: string[],
  tagIds: string[],
  sectionIds: string[] = [],
): boolean {
  const typeMatch = typeIds.length === 0 || typeIds.some((id) => item.typeIds.includes(id));
  const tagMatch = tagIds.length === 0 || tagIds.some((id) => item.tagIds.includes(id));
  const sectionMatch =
    sectionIds.length === 0 || sectionIds.some((id) => (item.sectionIds ?? []).includes(id));
  return typeMatch && tagMatch && sectionMatch;
}

/** OR within a facet group, AND across groups. */
export function filterItems<T extends FilterableItem>(
  items: T[],
  typeIds: string[],
  tagIds: string[],
  sectionIds: string[] = [],
): T[] {
  if (typeIds.length === 0 && tagIds.length === 0 && sectionIds.length === 0) return items;
  return items.filter((item) => matchesFilters(item, typeIds, tagIds, sectionIds));
}

export interface FacetCounts {
  types: Map<string, number>;
  tags: Map<string, number>;
  sections: Map<string, number>;
}

/**
 * Counts for each facet respect the *other* groups, so the numbers answer
 * "how many would I get if I toggled this on?".
 */
export function facetCounts<T extends FilterableItem>(
  items: T[],
  typeIds: string[],
  tagIds: string[],
  sectionIds: string[] = [],
): FacetCounts {
  const types = new Map<string, number>();
  const tags = new Map<string, number>();
  const sections = new Map<string, number>();
  for (const item of items) {
    if (matchesFilters(item, [], tagIds, sectionIds)) {
      for (const id of item.typeIds) types.set(id, (types.get(id) ?? 0) + 1);
    }
    if (matchesFilters(item, typeIds, [], sectionIds)) {
      for (const id of item.tagIds) tags.set(id, (tags.get(id) ?? 0) + 1);
    }
    if (matchesFilters(item, typeIds, tagIds, [])) {
      for (const id of item.sectionIds ?? []) sections.set(id, (sections.get(id) ?? 0) + 1);
    }
  }
  return { types, tags, sections };
}

export interface SectionOrderEntry {
  id: string;
  title: string;
  depth: number;
}

export interface SectionGroup<T> {
  id: string;
  title: string;
  depth: number;
  items: T[];
}

/**
 * Sections in outline order, then `Unsorted` last. Items keep their incoming
 * order and land in their deepest known section, so a subsection is its own
 * group rather than folding into its parent. Empty groups are omitted.
 */
export function groupBySection<T extends FilterableItem>(
  items: T[],
  sectionOrder: SectionOrderEntry[],
): SectionGroup<T>[] {
  const orderIds = new Set(sectionOrder.map((entry) => entry.id));
  const bySection = new Map<string, T[]>();
  const unsorted: T[] = [];

  for (const item of items) {
    const owner = (item.sectionIds ?? []).find((id) => orderIds.has(id));
    if (!owner) {
      unsorted.push(item);
      continue;
    }
    const bucket = bySection.get(owner);
    if (bucket) bucket.push(item);
    else bySection.set(owner, [item]);
  }

  const groups: SectionGroup<T>[] = [];
  for (const entry of sectionOrder) {
    const bucket = bySection.get(entry.id);
    if (bucket) groups.push({ ...entry, items: bucket });
  }
  if (unsorted.length > 0) {
    groups.push({ id: UNSORTED_SECTION, title: "Unsorted", depth: 0, items: unsorted });
  }
  return groups;
}
