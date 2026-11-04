import type { EntityKind } from "./kind";

/**
 * What a surface is looking at, resolved once.
 *
 * Three panels, one menu and a palette each used to answer "what is selected" for themselves, which is
 * how a card got a tabbed panel and a link got a list of rows. This is the one answer: the kinds in the
 * selection, the most specific of them, and the ids behind each. Everything downstream — the inspector's
 * tabs, the menu's rows, the verbs — reads this and stops re-deriving.
 */

export interface SubjectCounts {
  cards: number;
  sections: number;
  links: number;
}

export interface SelectionSubject {
  /** The kinds present, most specific first. Empty when nothing is selected. */
  kinds: EntityKind[];
  /** The kind a single-thing surface describes: the most specific one present. */
  primary: EntityKind | null;
  counts: SubjectCounts;
  nodeIds: readonly string[];
  sectionIds: readonly string[];
  edgeIds: readonly string[];
  isEmpty: boolean;
}

export interface SubjectInput {
  nodeIds: readonly string[];
  sectionIds: readonly string[];
  edgeIds: readonly string[];
  /** Node ids that are portal cards; a portal is a card with no body, and its own kind. */
  portalIds: ReadonlySet<string>;
}

/** Most specific first: a link's ends are less specific than the link, a frame less than a card. */
const SPECIFICITY: readonly EntityKind[] = ["portal", "card", "edge", "section"];

export function selectionSubject(input: SubjectInput): SelectionSubject {
  const nodeIds = [...new Set(input.nodeIds)];
  const sectionIds = [...new Set(input.sectionIds)];
  const edgeIds = [...new Set(input.edgeIds)];

  const present = new Set<EntityKind>();
  for (const id of nodeIds) present.add(input.portalIds.has(id) ? "portal" : "card");
  if (edgeIds.length > 0) present.add("edge");
  if (sectionIds.length > 0) present.add("section");

  const kinds = SPECIFICITY.filter((kind) => present.has(kind));
  return {
    kinds,
    primary: kinds[0] ?? null,
    counts: {
      cards: nodeIds.filter((id) => !input.portalIds.has(id)).length,
      sections: sectionIds.length,
      links: edgeIds.length,
    },
    nodeIds,
    sectionIds,
    edgeIds,
    isEmpty: kinds.length === 0,
  };
}

/**
 * The card the drawer describes: the one the reader pressed, or the last one selected.
 *
 * A click still wins, because that is the card they meant; a marquee opens on its last member,
 * the same `.at(-1)` rule the container panel uses for a frame.
 */
export function primaryNodeIdFor(
  inspectorNodeId: string | null,
  selectedNodeIds: readonly string[],
): string | null {
  return inspectorNodeId ?? selectedNodeIds.at(-1) ?? null;
}

/**
 * What the selection holds, in the panel's words: "3 cards · 2 sections · 1 link".
 *
 * A colour press reaches all of it, so the drawer says how much "it" is. One entity is its own
 * subject and needs no count; an empty selection is nothing to describe.
 */
export function selectionSummaryText(counts: SubjectCounts): string | null {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(counts.cards, "card", "cards");
  add(counts.sections, "section", "sections");
  add(counts.links, "link", "links");
  return parts.length > 1 ? parts.join(" \u00b7 ") : null;
}

/** A thing the style editor can write: a card, a link or a frame. */
export interface StyleTargetLike {
  kind: "card" | "edge" | "section";
  id: string;
}

/**
 * The selection as style targets, cards then links then frames.
 *
 * One list for one editor. The Style tab writes each target's own field, so colouring a mixed
 * selection goes through the same row a single card uses — and the rows a frame cannot take are
 * hidden by the intersection rule rather than by a second panel.
 */
export function styleTargetsFor(subject: SelectionSubject): StyleTargetLike[] {
  return [
    ...subject.nodeIds.map((id) => ({ kind: "card" as const, id })),
    ...subject.edgeIds.map((id) => ({ kind: "edge" as const, id })),
    ...subject.sectionIds.map((id) => ({ kind: "section" as const, id })),
  ];
}

/**
 * The kinds a surface should ask its capability table about.
 *
 * A portal is a card the document draws as a door, so a selection that holds both asks for what both
 * can do — the intersection rule, stated once. With nothing selected, the canvas answers.
 */
export function subjectKindsForTables(subject: SelectionSubject): EntityKind[] {
  if (subject.isEmpty) return ["canvas"];
  return subject.kinds;
}
