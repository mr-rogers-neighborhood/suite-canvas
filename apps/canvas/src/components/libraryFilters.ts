export interface FilterableItem {
  typeIds: string[];
  tagIds: string[];
}

export function matchesFilters(item: FilterableItem, typeIds: string[], tagIds: string[]): boolean {
  const typeMatch = typeIds.length === 0 || typeIds.some((id) => item.typeIds.includes(id));
  const tagMatch = tagIds.length === 0 || tagIds.some((id) => item.tagIds.includes(id));
  return typeMatch && tagMatch;
}

/** OR within a facet group, AND across groups. */
export function filterItems<T extends FilterableItem>(
  items: T[],
  typeIds: string[],
  tagIds: string[],
): T[] {
  if (typeIds.length === 0 && tagIds.length === 0) return items;
  return items.filter((item) => matchesFilters(item, typeIds, tagIds));
}

/**
 * Counts for each facet respect the *other* group, so the numbers answer
 * "how many would I get if I toggled this on?".
 */
export function facetCounts<T extends FilterableItem>(
  items: T[],
  typeIds: string[],
  tagIds: string[],
): { types: Map<string, number>; tags: Map<string, number> } {
  const types = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const item of items) {
    if (matchesFilters(item, [], tagIds)) {
      for (const id of item.typeIds) types.set(id, (types.get(id) ?? 0) + 1);
    }
    if (matchesFilters(item, typeIds, [])) {
      for (const id of item.tagIds) tags.set(id, (tags.get(id) ?? 0) + 1);
    }
  }
  return { types, tags };
}
