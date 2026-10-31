/**
 * The regions of the interface the handbook can name (ADR-0044's `ui` kind).
 *
 * A region is a *user-facing* piece of the shell: the title bar, the dock, the inspector. It
 * is deliberately not every component — an article per internal widget would document the
 * code rather than the product, and the picker would offer a hundred rows nobody can tell
 * apart.
 *
 * The id is the contract. It appears in an article's frontmatter, in the `data-handbook-region`
 * attribute on the element, and in nothing else, so "is this region documented?" and "is this
 * article's subject on screen?" are both answered by a set lookup. `scripts/sync-handbook.mjs`
 * fails the build when an article names a region that is not here, or a region here has no
 * article: a documented region that is not in the list is a typo, and a region with no article
 * is a promise the handbook cannot keep.
 *
 * The label is what the picker and the list show. It is a noun phrase a reader would say out
 * loud, because the article title underneath can be longer.
 */
export interface HandbookRegion {
  readonly id: string;
  readonly label: string;
  /**
   * Which part of the shell the region belongs to, for grouping the picker. Not used for
   * matching: a region is present when its element is, wherever that is.
   */
  readonly group: "chrome" | "dock" | "canvas" | "panel";
}

export const HANDBOOK_REGIONS: readonly HandbookRegion[] = [
  { id: "title-bar", label: "The title bar", group: "chrome" },
  { id: "workspace-name", label: "The workspace name", group: "chrome" },
  { id: "command-bar", label: "Search and commands", group: "chrome" },
  { id: "sync-status", label: "Sync, people and storage", group: "chrome" },
  { id: "share-action", label: "Share", group: "chrome" },
  { id: "theme-toggle", label: "Appearance", group: "chrome" },
  { id: "board-switcher", label: "Board tabs", group: "chrome" },
  { id: "new-tab", label: "New tab", group: "chrome" },
  { id: "undo-redo", label: "Undo and redo", group: "chrome" },
  { id: "interaction-mode", label: "Interaction mode", group: "chrome" },
  { id: "history-toggle", label: "Version history", group: "chrome" },
  { id: "outline-control", label: "Board outline", group: "chrome" },
  { id: "views-bar", label: "Saved views", group: "chrome" },
  { id: "dock", label: "The dock", group: "dock" },
  { id: "new-thing-menu", label: "The new-thing menu", group: "dock" },
  { id: "library-drawer", label: "The library", group: "dock" },
  { id: "library-search", label: "Library search", group: "dock" },
  { id: "library-tabs", label: "Library sections", group: "dock" },
  { id: "canvas-surface", label: "The board", group: "canvas" },
  { id: "board-outline", label: "The outline rail", group: "canvas" },
  { id: "card-inspector", label: "The inspector", group: "panel" },
  { id: "inspector-tabs", label: "Inspector tabs", group: "panel" },
  { id: "type-settings", label: "Card types", group: "panel" },
  { id: "command-palette", label: "The command palette", group: "panel" },
  { id: "pinned-cards", label: "Pinned cards", group: "panel" },
  { id: "peek-surface", label: "Hover peek", group: "panel" },
  { id: "tour-overlay", label: "Tours", group: "panel" },
  { id: "toast-layer", label: "Toasts", group: "panel" },
  { id: "handbook-bubble", label: "The handbook", group: "panel" },
  { id: "views-layer", label: "The views layer", group: "panel" },
  { id: "views-projection-bar", label: "A projected view", group: "panel" },
];

/** The attribute a shell element carries so the picker and the presence check can find it. */
export const HANDBOOK_REGION_ATTRIBUTE = "data-handbook-region";

const REGION_IDS: ReadonlySet<string> = new Set(HANDBOOK_REGIONS.map((region) => region.id));

/** Whether a string is a region this build knows, so an authored id can fail loudly. */
export function isHandbookRegion(id: string): boolean {
  return REGION_IDS.has(id);
}

/** The label for a region id, or the id itself when it is unknown. */
export function regionLabel(id: string): string {
  return HANDBOOK_REGIONS.find((region) => region.id === id)?.label ?? id;
}

/** A selector for one region, escaped for ids that could hold CSS-significant characters. */
export function regionSelector(id: string): string {
  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
  return `[${HANDBOOK_REGION_ATTRIBUTE}="${escaped}"]`;
}
