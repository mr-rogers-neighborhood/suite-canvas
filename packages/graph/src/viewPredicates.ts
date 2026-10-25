import { z } from "zod";

import {
  type Card,
  type CardType,
  entityIdSchema,
  type FieldDefinition,
  type GraphEdge,
  type Placement,
  type PropertyValue,
  type Section,
} from "./schema.js";
import { searchTerms } from "./search.js";
import { sectionForCard, sectionLineage } from "./sections.js";

/**
 * The predicate half of a saved view. A query is a set of *groups*: every group
 * must pass, a group's `any` list is an OR, and its `not` list is a veto.
 *
 * There is deliberately no nesting and no expression language. One level of OR
 * covers "these types, with this status, without this tag"; anything deeper is
 * two views or a tag, because a boolean AST would need a parser, an error
 * surface, a migration path and documentation that all compete with the canvas.
 */

export const propertyOps = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "notIn",
  "between",
  "empty",
  "notEmpty",
] as const;
export type PropertyOp = (typeof propertyOps)[number];

export const presenceKinds = ["body", "attachment", "backlink", "property"] as const;
export type PresenceKind = (typeof presenceKinds)[number];

export const relationDirections = ["in", "out"] as const;
export type RelationDirection = (typeof relationDirections)[number];

export const textScopes = ["title", "body", "both"] as const;
export type TextScope = (typeof textScopes)[number];

export const propertyOpSchema = z.enum(propertyOps);
export const presenceKindSchema = z.enum(presenceKinds);
export const relationDirectionSchema = z.enum(relationDirections);
export const textScopeSchema = z.enum(textScopes);

/** A value is a scalar, a list of ids, or a `[low, high]` pair for `between`. */
const predicateValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
]);

export const viewPredicateSchema = z.discriminatedUnion("p", [
  z.object({ p: z.literal("type"), ids: z.array(entityIdSchema) }),
  z.object({ p: z.literal("tag"), ids: z.array(entityIdSchema) }),
  z.object({
    p: z.literal("section"),
    ids: z.array(entityIdSchema),
    /** Include the section's descendants; the library facet default. */
    subtree: z.boolean().optional(),
  }),
  z.object({
    p: z.literal("property"),
    fieldId: entityIdSchema,
    op: propertyOpSchema,
    /** Interpretation depends on the field kind; see `propertyMatches`. */
    value: predicateValueSchema.optional(),
  }),
  z.object({
    p: z.literal("text"),
    terms: z.string().min(1),
    scope: textScopeSchema.optional(),
  }),
  z.object({
    p: z.literal("presence"),
    of: presenceKindSchema,
    /** Required for `property`; ignored otherwise. */
    fieldId: entityIdSchema.optional(),
  }),
  z.object({
    p: z.literal("relation"),
    dir: relationDirectionSchema,
    cardId: entityIdSchema,
  }),
]);

export type ViewPredicate = z.infer<typeof viewPredicateSchema>;

export const viewPredicateGroupSchema = z.object({
  /** OR over these; empty or absent means "no constraint from this side". */
  any: z.array(viewPredicateSchema).optional(),
  /** Vetoes the card when any of these match. */
  not: z.array(viewPredicateSchema).optional(),
});

export type ViewPredicateGroup = z.infer<typeof viewPredicateGroupSchema>;

/* ------------------------------------------------------------- evaluation */

/** Everything a predicate needs, assembled once per query by the caller. */
export interface PredicateContext {
  /** Field definitions grouped by type, so a stray key on a card never matches. */
  readonly fieldsByType: ReadonlyMap<string, readonly FieldDefinition[]>;
  /** Searchable text per card (title, separator, body): the index search uses. */
  readonly searchText: (cardId: string) => string | undefined;
  /** Derived reference index, keyed by source card; resolved lazily. */
  readonly references: () => Readonly<Record<string, readonly string[]>>;
  /** Whether the card's body holds an attachment node. */
  readonly hasAttachment: (cardId: string) => boolean;
  /** Placements of one card, used to resolve its section. */
  readonly placementsFor: (cardId: string) => readonly Placement[];
  /** Sections of one board, for section predicates. */
  readonly sectionsForBoard: (boardId: string) => readonly Section[];
  /**
   * One-hop links in both directions, built once per query. A link is what the
   * card panel calls a reference: a mention, a `card`-valued property, or a
   * drawn arrow — the same definition the References section lists.
   */
  readonly links: () => LinkIndex;
}

export interface LinkIndex {
  /** Cards that point at this card. */
  readonly incoming: (cardId: string) => readonly string[];
  /** Cards this card points at. */
  readonly outgoing: (cardId: string) => readonly string[];
}

/** Field ids that carry a card reference, so a text field is never a link. */
function cardFieldIds(types: readonly CardType[]): Set<string> {
  const ids = new Set<string>();
  for (const type of types) {
    for (const field of type.fields) if (field.kind === "card") ids.add(field.id);
  }
  return ids;
}

/**
 * Builds the one-hop link index. Mentions come from the derived reference
 * index; `card` properties and arrows are read directly, because the reference
 * index only stores mentions.
 */
export function buildLinkIndex(input: {
  cards: readonly Card[];
  types: readonly CardType[];
  edges: readonly GraphEdge[];
  references: Readonly<Record<string, readonly string[]>>;
}): LinkIndex {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string): void => {
    if (key === value) return;
    const set = map.get(key);
    if (set) set.add(value);
    else map.set(key, new Set([value]));
  };

  for (const [source, targets] of Object.entries(input.references)) {
    for (const target of targets) {
      add(outgoing, source, target);
      add(incoming, target, source);
    }
  }

  const cardFields = cardFieldIds(input.types);
  const known = new Set(input.cards.map((card) => card.id));
  for (const card of input.cards) {
    for (const [fieldId, value] of Object.entries(card.properties)) {
      // An unknown field is kept: a missing type definition must not hide a link,
      // exactly as `propertySources` decides for the panel.
      if (typeof value !== "string" || !known.has(value)) continue;
      if (cardFields.size > 0 && !cardFields.has(fieldId)) continue;
      add(outgoing, card.id, value);
      add(incoming, value, card.id);
    }
  }

  for (const edge of input.edges) {
    add(outgoing, edge.source, edge.target);
    add(incoming, edge.target, edge.source);
  }

  const sorted = (map: Map<string, Set<string>>, id: string): readonly string[] =>
    [...(map.get(id) ?? [])].sort();
  return {
    incoming: (id) => sorted(incoming, id),
    outgoing: (id) => sorted(outgoing, id),
  };
}

const FIELD_SEPARATOR = "\n";

/** Title and body halves of an indexed card, split the way `search.ts` does. */
function splitSearchText(text: string): { title: string; body: string } {
  const at = text.indexOf(FIELD_SEPARATOR);
  if (at === -1) return { title: text, body: "" };
  return { title: text.slice(0, at), body: text.slice(at + 1) };
}

function isEmptyValue(value: PropertyValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** The field a card's own types declare, in type order. */
export function fieldForCard(
  card: Card,
  fieldId: string,
  context: Pick<PredicateContext, "fieldsByType">,
): FieldDefinition | undefined {
  for (const typeId of card.typeIds) {
    const field = context.fieldsByType.get(typeId)?.find((candidate) => candidate.id === fieldId);
    if (field) return field;
  }
  return undefined;
}

/** Numbers compare numerically and dates as instants; other kinds have no order. */
function ordered(kind: FieldDefinition["kind"], value: unknown): number | undefined {
  if (kind === "number")
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (kind === "date") {
    if (typeof value !== "string") return undefined;
    const at = Date.parse(value);
    return Number.isNaN(at) ? undefined : at;
  }
  return undefined;
}

/**
 * One property comparison. The operation means the same thing for every kind,
 * but "less than" only exists where an order does: numbers and dates. Comparing
 * against a missing value is false, except for `empty`/`notEmpty`, which is what
 * they are for.
 */
export function propertyMatches(
  field: FieldDefinition,
  stored: PropertyValue | undefined,
  op: PropertyOp,
  wanted: unknown,
): boolean {
  if (op === "empty") return isEmptyValue(stored);
  if (op === "notEmpty") return !isEmptyValue(stored);
  // A card of this type that never set the field is "not X", not "unknown".
  if (stored === undefined) return op === "neq" || op === "notIn";

  const orderedKinds = field.kind === "number" || field.kind === "date";
  if (orderedKinds) {
    if (op === "between") {
      const [low, high] = Array.isArray(wanted) ? wanted : [];
      const subject = ordered(field.kind, stored);
      const min = ordered(field.kind, low);
      const max = ordered(field.kind, high);
      if (subject === undefined || min === undefined || max === undefined) return false;
      return subject >= min && subject <= max;
    }
    if (op === "eq" || op === "neq") {
      const subject = ordered(field.kind, stored);
      const other = ordered(field.kind, wanted);
      if (subject === undefined) return false;
      if (other === undefined) return op === "neq";
      return op === "eq" ? subject === other : subject !== other;
    }
    const subject = ordered(field.kind, stored);
    const bound = ordered(field.kind, wanted);
    if (subject === undefined || bound === undefined) return false;
    if (op === "lt") return subject < bound;
    if (op === "lte") return subject <= bound;
    if (op === "gt") return subject > bound;
    if (op === "gte") return subject >= bound;
    return false;
  }

  const wantedIds = Array.isArray(wanted) ? wanted.map(String) : [String(wanted)];

  if (field.kind === "multiSelect") {
    const selected = Array.isArray(stored) ? stored : [];
    const shares = wantedIds.some((id) => selected.includes(id));
    if (op === "eq" || op === "in") return shares;
    if (op === "neq" || op === "notIn") return !shares;
    return false;
  }

  if (field.kind === "checkbox") {
    const subject = stored === true || stored === "true";
    const against = wanted === true || wanted === "true";
    if (op === "eq") return subject === against;
    if (op === "neq") return subject !== against;
    return false;
  }

  if (typeof stored !== "string") return false;
  if (op === "eq") return stored === wantedIds[0];
  if (op === "neq") return stored !== wantedIds[0];
  if (op === "in") return wantedIds.includes(stored);
  if (op === "notIn") return !wantedIds.includes(stored);
  return false;
}

/** Section ids a card sits in, innermost first; `subtree` adds its ancestors. */
function cardSectionIds(cardId: string, context: PredicateContext, subtree: boolean): string[] {
  const ids: string[] = [];
  for (const placement of context.placementsFor(cardId)) {
    const sections = context.sectionsForBoard(placement.boardId) as Section[];
    if (sections.length === 0) continue;
    const match = sectionForCard(placement, sections);
    if (!match) continue;
    const chain = subtree ? sectionLineage(match.id, sections) : [match];
    for (const section of chain) {
      if (!ids.includes(section.id)) ids.push(section.id);
    }
  }
  return ids;
}

/** Whether every term sits in the requested half of an indexed card's text. */
export function textScopeMatches(text: string, terms: string, scope: TextScope): boolean {
  const words = searchTerms(terms);
  if (words.length === 0) return true;
  const { title, body } = splitSearchText(text);
  if (scope === "title") return words.every((word) => title.includes(word));
  if (scope === "body") return words.every((word) => body.includes(word));
  return words.every((word) => text.includes(word));
}

/**
 * One predicate against one card. A card whose types do not declare the field
 * is outside the field's domain: only `empty` reads as true for it ("this card
 * has no Score"), because it genuinely has no value there.
 */
export function predicateMatches(
  card: Card,
  predicate: ViewPredicate,
  context: PredicateContext,
): boolean {
  switch (predicate.p) {
    case "type":
      return predicate.ids.some((id) => card.typeIds.includes(id));
    case "tag":
      return predicate.ids.some((id) => card.tags.includes(id));
    case "section":
      return cardSectionIds(card.id, context, predicate.subtree ?? true).some((id) =>
        predicate.ids.includes(id),
      );
    case "property": {
      const field = fieldForCard(card, predicate.fieldId, context);
      if (!field) return predicate.op === "empty";
      return propertyMatches(field, card.properties[field.id], predicate.op, predicate.value);
    }
    case "text":
      return textScopeMatches(
        context.searchText(card.id) ?? "",
        predicate.terms,
        predicate.scope ?? "both",
      );
    case "presence": {
      if (predicate.of === "body") {
        const text = context.searchText(card.id) ?? "";
        return splitSearchText(text).body.trim().length > 0;
      }
      if (predicate.of === "attachment") return context.hasAttachment(card.id);
      if (predicate.of === "backlink") return context.links().incoming(card.id).length > 0;
      if (!predicate.fieldId) return false;
      return !isEmptyValue(card.properties[predicate.fieldId]);
    }
    case "relation": {
      // "out" is a link this card draws to `cardId`; "in" is one drawn to it.
      const links = context.links();
      const related = predicate.dir === "out" ? links.outgoing(card.id) : links.incoming(card.id);
      return related.includes(predicate.cardId);
    }
  }
}

/** Every group must pass: `any` is an OR, `not` is a veto. */
export function groupsMatch(
  card: Card,
  groups: readonly ViewPredicateGroup[],
  context: PredicateContext,
): boolean {
  for (const group of groups) {
    const any = group.any ?? [];
    if (any.length > 0 && !any.some((predicate) => predicateMatches(card, predicate, context))) {
      return false;
    }
    const none = group.not ?? [];
    if (none.some((predicate) => predicateMatches(card, predicate, context))) return false;
  }
  return true;
}
