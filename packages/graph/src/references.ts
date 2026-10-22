import { getType, isContainer, type LoroList, type LoroMap, type LoroText } from "loro-crdt";
import type { Card, CardType, GraphEdge } from "./schema.js";

/** The ProseMirror node name a mention is stored under. */
export const MENTION_NODE_NAME = "mention";

/** `fromCardId` → the ids it mentions. Derived from content; never authoritative. */
export type ReferenceIndex = Readonly<Record<string, readonly string[]>>;

export interface PropertySource {
  cardId: string;
  fieldId: string;
  fieldName: string;
}

export interface ArrowSource {
  edgeId: string;
  otherCardId: string;
  boardId: string;
  description?: string;
}

export interface ReferenceCountInput {
  references: ReferenceIndex;
  cards: readonly Card[];
  edges: readonly GraphEdge[];
  types?: readonly CardType[];
}

function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

/**
 * A mention stores its target on the node's attributes map, which is what
 * `loro-prosemirror` writes. Reading the node's own key as well tolerates
 * hand-built containers and older nodes that skipped the attributes map.
 */
function mentionCardId(node: LoroMap): string | undefined {
  const attributes = node.get("attributes");
  const attribute = isMap(attributes) ? attributes.get("cardId") : undefined;
  const raw = typeof attribute === "string" ? attribute : node.get("cardId");
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function walk(value: unknown, out: string[], seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, out, seen);
    return;
  }
  if (isText(value)) return;
  if (isList(value)) {
    for (const child of value.toArray()) walk(child, out, seen);
    return;
  }
  if (!isMap(value)) return;

  if (value.get("nodeName") === MENTION_NODE_NAME) {
    const cardId = mentionCardId(value);
    if (cardId !== undefined && !seen.has(cardId)) {
      seen.add(cardId);
      out.push(cardId);
    }
  }
  walk(value.get("children"), out, seen);
}

/**
 * Card ids mentioned in a Loro ProseMirror tree, in document order. Accepts a
 * document container, a single node, a list of nodes or a text container; text
 * and non-node values are ignored. Duplicate targets collapse to the first one.
 */
export function mentionTargets(root: unknown): string[] {
  const out: string[] = [];
  walk(root, out, new Set());
  return out;
}

export interface MentionContext {
  /** Text before the mention, newest last. Empty when the mention starts the card. */
  before: string;
  /** Text after the mention. Empty when nothing follows it. */
  after: string;
}

/** Block-ish nodes that should not run into each other in a snippet. */
const BLOCK_NODES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
  "tableRow",
]);

interface ContextWalk {
  text: string;
  hit: number | null;
}

function contextWalk(value: unknown, target: string, state: ContextWalk): void {
  if (Array.isArray(value)) {
    for (const entry of value) contextWalk(entry, target, state);
    return;
  }
  if (isText(value)) {
    state.text += value.toString();
    return;
  }
  if (isList(value)) {
    for (const child of value.toArray()) contextWalk(child, target, state);
    return;
  }
  if (!isMap(value)) return;

  const nodeName = value.get("nodeName");
  if (typeof nodeName === "string" && BLOCK_NODES.has(nodeName) && state.text.length > 0) {
    state.text += "\n";
  }

  if (nodeName === MENTION_NODE_NAME) {
    const cardId = mentionCardId(value);
    if (cardId === target) {
      // Record where the mention sits; the caller renders the live title there.
      if (state.hit === null) state.hit = state.text.length;
    } else {
      // A different mention still separates the words around it.
      state.text += " ";
    }
  }

  contextWalk(value.get("children"), target, state);
}

/**
 * Plain text around the first mention of `targetCardId`, for a backlink row.
 * The mention itself is omitted so the UI can place the target's live title
 * between `before` and `after`; returns null when the card never mentions it.
 */
export function mentionContext(
  root: unknown,
  targetCardId: string,
  radius = 90,
): MentionContext | null {
  const state: ContextWalk = { text: "", hit: null };
  contextWalk(root, targetCardId, state);
  if (state.hit === null) return null;

  const before = state.text.slice(Math.max(0, state.hit - radius), state.hit).replace(/\n+/g, " ");
  const after = state.text.slice(state.hit, state.hit + radius).replace(/\n+/g, " ");
  return {
    before: before.trim(),
    after: after.trim(),
  };
}

/** Set comparison: a reordered mention does not change the reference set. */
export function sameTargets(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/** Cards that mention `cardId`. Self-references are real and are included. */
export function incomingReferences(cardId: string, references: ReferenceIndex): string[] {
  const sources = new Set<string>();
  for (const [source, targets] of Object.entries(references)) {
    if (targets.includes(cardId)) sources.add(source);
  }
  return [...sources].sort();
}

/** Cards `cardId` mentions. */
export function outgoingReferences(cardId: string, references: ReferenceIndex): string[] {
  return [...(references[cardId] ?? [])];
}

/**
 * Cards whose `card` property points at `cardId`, naming the field. Field names
 * come from the type definitions when they are supplied; a field that is not
 * part of any type still reports its id so the row can navigate.
 */
export function propertySources(
  cardId: string,
  cards: readonly Card[],
  types: readonly CardType[] = [],
): PropertySource[] {
  const names = new Map<string, string>();
  for (const type of types) {
    for (const field of type.fields) names.set(field.id, field.name);
  }

  const sources: PropertySource[] = [];
  for (const card of cards) {
    for (const [fieldId, value] of Object.entries(card.properties)) {
      if (typeof value !== "string" || value !== cardId) continue;
      sources.push({ cardId: card.id, fieldId, fieldName: names.get(fieldId) ?? fieldId });
    }
  }
  return sources.sort(
    (a, b) =>
      a.cardId.localeCompare(b.cardId) ||
      a.fieldName.localeCompare(b.fieldName) ||
      a.fieldId.localeCompare(b.fieldId),
  );
}

/** Arrows touching `cardId`, from either endpoint. A self-loop yields one row. */
export function arrowSources(cardId: string, edges: readonly GraphEdge[]): ArrowSource[] {
  const sources: ArrowSource[] = [];
  for (const edge of edges) {
    const outgoing = edge.source === cardId;
    const incoming = edge.target === cardId;
    if (!outgoing && !incoming) continue;
    sources.push({
      edgeId: edge.id,
      otherCardId: outgoing ? edge.target : edge.source,
      boardId: edge.boardId,
      ...(edge.label === undefined ? {} : { description: edge.label }),
    });
  }
  return sources;
}

/** What the header chip counts: mentions, property links and arrows pointing in. */
export function referenceCount(cardId: string, input: ReferenceCountInput): number {
  return (
    incomingReferences(cardId, input.references).length +
    propertySources(cardId, input.cards, input.types ?? []).length +
    arrowSources(cardId, input.edges).length
  );
}
