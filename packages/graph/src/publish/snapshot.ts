/**
 * Owns rich-text capture: turning a Loro subtree into plain JSON
 * (`RichTextSnapshot`) and reading a card, placement, section or edge into the
 * field set a publish compares, plus the one definition of "equal"
 * (`canonical`/`same`) every other publish module compares with.
 *
 * It must never write to a document and must never decide what a difference
 * means: this module only converts and compares. Planning decides, apply
 * writes, and neither may grow a second snapshot format.
 */

import { getType, isContainer, type LoroList, type LoroMap, type LoroText } from "loro-crdt";
import type { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import type { GraphEdge, Placement, PropertyValue, Section } from "../schema.js";

/** A `LoroText` container serialized to its delta, marks included. */
export interface RichTextTextSnapshot {
  readonly $text: ReturnType<LoroText["toDelta"]>;
}

/**
 * A rich text tree as plain JSON. Maps keep the `loro-prosemirror` shape
 * (`nodeName`, `attributes`, `children`), lists keep order, and text keeps its
 * delta; comparing two of these is a deep comparison of the whole tree.
 */
export type RichTextSnapshot =
  | null
  | string
  | number
  | boolean
  | RichTextSnapshot[]
  | RichTextTextSnapshot
  | { readonly [key: string]: RichTextSnapshot };

/** One card's placement on the shared board, without the derived fields. */
export interface PlacementSnapshot {
  boardId: string;
  cardId: string;
  x: number;
  y: number;
  z: number;
  width?: number;
  height?: number;
}

export function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

export function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

export function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

export function isTextSnapshot(value: RichTextSnapshot): value is RichTextTextSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "$text" in value;
}

export function snapshotValue(value: unknown): RichTextSnapshot {
  if (isText(value)) return { $text: value.toDelta() };
  if (isList(value)) return value.toArray().map(snapshotValue);
  if (isMap(value)) {
    const out: Record<string, RichTextSnapshot> = {};
    for (const [key, child] of value.entries()) out[key] = snapshotValue(child);
    return out;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

export function snapshotText(root: LoroMap | null): RichTextSnapshot {
  return root ? snapshotValue(root) : null;
}

/** Stable JSON, so two equal trees compare equal regardless of key order. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortValue(record[key]);
    return out;
  }
  return value;
}

export function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(sortValue(value)) ?? "undefined";
}

export function same(left: unknown, right: unknown): boolean {
  return left === right || canonical(left) === canonical(right);
}

export interface CardSnapshot {
  title: RichTextSnapshot;
  body: RichTextSnapshot;
  properties: Record<string, PropertyValue | null>;
  tags: string[];
}

export function snapshotCard(workspace: WorkspaceDocument, cardId: string): CardSnapshot | null {
  const card = workspace.getCard(cardId);
  if (!card) return null;
  const properties: Record<string, PropertyValue | null> = {};
  for (const [fieldId, value] of Object.entries(card.properties)) {
    properties[fieldId] = Array.isArray(value) ? [...value] : value;
  }
  return {
    title: snapshotText(workspace.peekTitle(cardId)),
    body: snapshotText(workspace.peekContent(cardId)),
    properties,
    tags: [...card.tags].sort(),
  };
}

export function placementSnapshot(placement: Placement): PlacementSnapshot {
  return {
    boardId: placement.boardId,
    cardId: placement.cardId,
    x: placement.x,
    y: placement.y,
    z: placement.z,
    ...(placement.width === undefined ? {} : { width: placement.width }),
    ...(placement.height === undefined ? {} : { height: placement.height }),
  };
}

export interface SectionFields {
  title: string;
  color: Section["color"] | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sectionFields(section: Section): SectionFields {
  return {
    title: section.title,
    color: section.color ?? null,
    x: section.x,
    y: section.y,
    width: section.width,
    height: section.height,
  };
}

export interface EdgeFields {
  source: string;
  target: string;
  sourceKind: GraphEdge["sourceKind"] | null;
  targetKind: GraphEdge["targetKind"] | null;
  sourceConnector: string | null;
  targetConnector: string | null;
  path: GraphEdge["path"];
  bidirectional: boolean;
  label: string | null;
}

/** Only the fields a board editor may draw differently. */
export function edgeFields(edge: GraphEdge | undefined): EdgeFields | undefined {
  if (!edge) return undefined;
  return {
    source: edge.source,
    target: edge.target,
    sourceKind: edge.sourceKind ?? null,
    targetKind: edge.targetKind ?? null,
    sourceConnector: edge.sourceConnector ?? null,
    targetConnector: edge.targetConnector ?? null,
    path: edge.path,
    bidirectional: edge.bidirectional,
    label: edge.label ?? null,
  };
}
