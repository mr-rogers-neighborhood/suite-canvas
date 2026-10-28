import type { EntityKind } from "../entities/kind";

/**
 * One description of what an inspector can show, and which kinds it can show it for.
 *
 * An inspector does not branch on "am I a card or a section": it asks this table for the
 * tabs and the rows that serve what is being described, and renders those in order. A
 * thing that has no body never reaches the body row, so a missing feature is a missing
 * row rather than a missing `if`.
 */
export type InspectorTabId = "details" | "content" | "style";

export interface InspectorTab {
  id: InspectorTabId;
  /** The card's own name for the tab; other kinds get `title`. */
  title: string;
  kinds: readonly EntityKind[];
}

export type InspectorSectionId =
  | "identity"
  | "properties"
  | "contents"
  | "links"
  | "placement"
  | "style";

export interface InspectorSection {
  id: InspectorSectionId;
  tab: InspectorTabId;
  title: string;
  kinds: readonly EntityKind[];
}

export const INSPECTOR_TABS: readonly InspectorTab[] = [
  { id: "details", title: "Details", kinds: ["card", "portal", "section"] },
  { id: "content", title: "Content", kinds: ["card", "portal", "section"] },
  // A link is read in its own inspector, which is a list of rows rather than tabs.
  { id: "style", title: "Style", kinds: ["card", "portal"] },
];

export const INSPECTOR_SECTIONS: readonly InspectorSection[] = [
  // What it is: the type it falls under and the words filed against it.
  { id: "identity", tab: "details", title: "Type and tags", kinds: ["card", "portal", "section"] },
  // What its type says it has; a portal and a section have no types of their own.
  { id: "properties", tab: "details", title: "Properties", kinds: ["card"] },
  // What it holds: a card's body, or the cards inside a container.
  { id: "contents", tab: "content", title: "Contents", kinds: ["card", "portal", "section"] },
  { id: "links", tab: "details", title: "Links", kinds: ["card", "portal", "section"] },
  { id: "placement", tab: "details", title: "Placement", kinds: ["card", "portal"] },
  { id: "style", tab: "style", title: "Style", kinds: ["card", "portal"] },
];

/**
 * Everything in `rows` that serves *every* kind asked for.
 *
 * A multi-selection intersects rather than unions: offering to style four cards and a
 * link would be offering something the link cannot do.
 */
function serving<K extends { kinds: readonly EntityKind[] }>(
  rows: readonly K[],
  kinds: readonly EntityKind[],
): K[] {
  const wanted = new Set(kinds);
  if (wanted.size === 0) return [];
  return rows.filter((row) => [...wanted].every((kind) => row.kinds.includes(kind)));
}

/** The tabs an inspector shows, in reading order, for what it is describing. */
export function tabsFor(kinds: readonly EntityKind[]): InspectorTab[] {
  return serving(INSPECTOR_TABS, kinds);
}

/** The body rows under one tab, for what it is describing. */
export function sectionsFor(tab: InspectorTabId, kinds: readonly EntityKind[]): InspectorSection[] {
  return serving(INSPECTOR_SECTIONS, kinds).filter((section) => section.tab === tab);
}

/** Whether a kind shows a tab; the tab strip and the body read the same answer. */
export function hasTab(kinds: readonly EntityKind[], tab: InspectorTabId): boolean {
  return tabsFor(kinds).some((entry) => entry.id === tab);
}

/**
 * A tab's label. A container's content is the list of cards inside it, so it reads
 * "Contents"; a tutorial card's content is the steps it is made of.
 */
export function tabLabel(
  tab: InspectorTabId,
  kind: EntityKind,
  options: { tutorial?: boolean } = {},
): string {
  if (tab === "content") {
    if (kind !== "card") return "Contents";
    return options.tutorial ? "Steps" : "Content";
  }
  if (tab === "style") return "Style";
  return "Details";
}
