import fuzzysort from "fuzzysort";

/**
 * One palette entry. Providers build these; the palette renders them and the
 * ranker orders them. Keeping the item a plain value is what lets every source
 * be tested without a browser.
 */
export interface PaletteItem {
  /** Stable across renders; also the React key. */
  id: string;
  /** The registry command this row came from, when it came from one. */
  commandId?: string | undefined;
  /** What the row reads. */
  title: string;
  /** The small second line: a board name, a type, a shortcut. */
  subtitle?: string | undefined;
  /** Grouping label, shown as a menu section heading. */
  group: string;
  /** Extra words the search should reach: synonyms, initials, ids. */
  keywords?: readonly string[] | undefined;
  /** Lower runs first among equal scores (navigation before actions). */
  weight?: number | undefined;
  /** The keys that run this row, printed at its right edge. */
  shortcut?: string | undefined;
  run: () => void;
}

/**
 * The one place ranking happens. Swapping the matcher is a change here, not in
 * every provider: providers only describe items.
 */
export function rankPaletteItems(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const needle = query.trim();
  if (needle.length === 0) {
    return [...items].sort(
      (a, b) => (a.weight ?? 0) - (b.weight ?? 0) || a.title.localeCompare(b.title),
    );
  }

  const ranked: Array<{ item: PaletteItem; score: number }> = [];
  for (const item of items) {
    const targets = [item.title, item.subtitle ?? "", ...(item.keywords ?? [])];
    let best = Number.NEGATIVE_INFINITY;
    for (const target of targets) {
      if (!target) continue;
      const result = fuzzysort.single(needle, target);
      if (result && result.score > best) best = result.score;
    }
    if (best === Number.NEGATIVE_INFINITY) continue;
    ranked.push({ item, score: best });
  }

  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.item.weight ?? 0) - (b.item.weight ?? 0) ||
        a.item.title.localeCompare(b.item.title),
    )
    .map((entry) => entry.item);
}

/** Groups ranked items in the order their first member appears. */
export function paletteGroups(items: readonly PaletteItem[]): Array<{
  group: string;
  items: PaletteItem[];
}> {
  const order: string[] = [];
  const buckets = new Map<string, PaletteItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.group);
    if (bucket) bucket.push(item);
    else {
      buckets.set(item.group, [item]);
      order.push(item.group);
    }
  }
  return order.map((group) => ({ group, items: buckets.get(group) ?? [] }));
}
