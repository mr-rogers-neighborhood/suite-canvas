import { z } from "zod";
import { iconRefSchema } from "./icons.js";
import { surfaceStyleSchema } from "./style.js";

export const edgeKinds = ["references", "relates-to", "tagged"] as const;
/**
 * `avoid` routes around the cards and sections a link would cross. It is one more
 * value of the path, so it is stored per link and syncs like any other; a link
 * with bends keeps its bends and the router is not consulted
 * (ADR-0052 §6).
 */
export const edgePaths = ["bezier", "straight", "step", "smoothstep", "avoid"] as const;
export const fieldKinds = [
  "text",
  "number",
  "date",
  "select",
  "multiSelect",
  "checkbox",
  "card",
  "board",
  // A card reference narrowed to a kind of card. The value is the same card id a
  // `card` field holds; `allowedTypeIds` is what makes it a media or a sketch
  // field, so the shape stays one thing and the rule stays data.
  "media",
  "sketch",
  // Composing kinds (ADR-0057):
  // a number with a presentation, a record, and an ordered repeatable.
  "rating",
  "group",
  "list",
] as const;
export const sectionColors = ["slate", "blue", "green", "amber", "rose", "violet"] as const;
/** What a link endpoint points at. Boards and sections are identities, not types. */
export const edgeEndpointKinds = ["card", "board", "section"] as const;

export const edgeKindSchema = z.enum(edgeKinds);
export const edgePathSchema = z.enum(edgePaths);
export const fieldKindSchema = z.enum(fieldKinds);
export const sectionColorSchema = z.enum(sectionColors);
export const edgeEndpointKindSchema = z.enum(edgeEndpointKinds);

export const entityIdSchema = z.string().min(1);

/** The type every card falls back to; it cannot be deleted. */
export const DEFAULT_TYPE_ID = "note";

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** A connection point, stored as a 0..1 fraction of the node's width/height. */
export const connectorSchema = z.object({
  id: entityIdSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const boardSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  /** Any palette swatch id; the six section colours are the defaults. */
  color: z.string().min(1).max(64).optional(),
  /** An icon reference, painted in the board's colour. */
  icon: iconRefSchema.optional(),
  /** Replaces the live miniature inside a portal card when set. */
  coverAttachmentId: entityIdSchema.optional(),
  /**
   * Kept as a template: the library offers it as a starting point, and using it
   * makes a new board (ADR-0040 — templates are duplication, not a new kind).
   */
  template: z.boolean().optional(),
  /**
   * Freeform labels, like a card's (ADR-0053 §6).
   * A tag never implies membership and never carries fields; the reader always
   * supplies a list, so callers never see `undefined`.
   */
  tags: z.array(entityIdSchema),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

/** One choice of a select or multi-select field. */
export const selectOptionSchema = z.object({
  id: entityIdSchema,
  label: z.string().min(1),
  color: z.string().optional(),
  /** Explicit order: Loro map iteration is not insertion order. */
  order: z.number().int(),
});

/**
 * A rating's presentation (ADR-0057 §1):
 * the value stays a number, so sorting, filtering and arithmetic keep working;
 * the scale top, the half steps and the icon set change only how it is drawn.
 */
export const ratingPresentationSchema = z.object({
  /** Marks run `1..scale`. */
  scale: z.number().int().min(1).max(20),
  /** Half steps between whole marks (0.5, 1.5, …). */
  half: z.boolean().optional(),
  /** Icon set name or glyph. A string is drawn as text until the icon set lands. */
  icon: z.string().min(1).max(40).optional(),
});

/**
 * Sub-field kinds are scalars plus a card reference. `select` and `multiSelect`
 * are left out on purpose: their options are owned by the field definition, and
 * a sub-field does not own options, so allowing them would allow a field with a
 * value nothing can label.
 */
export const subFieldKinds = ["text", "number", "date", "checkbox", "rating", "card"] as const;
export const subFieldKindSchema = z.enum(subFieldKinds);

/**
 * One named member of a `group`, or the item shape of a `list`
 * (ADR-0057 §2–4).
 * Deliberately shallow: nesting stops at one level, so a sub-field has no
 * children of its own.
 */
export const subFieldSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: subFieldKindSchema,
  order: z.number().int(),
});

/** What a `list` repeats: the scalar item itself, or a group of sub-fields. */
export const listItemKinds = ["scalar", "group"] as const;
export const listItemKindSchema = z.enum(listItemKinds);

/** A typed field owned by one type. Field ids are unique across the workspace. */
export const fieldDefinitionSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: fieldKindSchema,
  required: z.boolean(),
  order: z.number().int(),
  options: z.array(selectOptionSchema),
  /**
   * How the value reads where it is shown (see `template.ts`). Absent means the
   * value alone; it is presentation only and never changes the stored value.
   */
  display: z.string().min(1).max(160).optional(),
  /**
   * A `group`'s members, or a `list`'s item shape (ADR-0057 §6). For a list of
   * scalars it holds exactly one entry — the item's own kind, id `"item"` —
   * so "one entry" reads the same in both cases.
   */
  subFields: z.array(subFieldSchema).optional(),
  /** For a `list`: whether each item is the scalar sub-field or a group of them. */
  itemKind: listItemKindSchema.optional(),
  /** For a `rating`: the scale top, half steps and icon set. Absent means 5 marks. */
  rating: ratingPresentationSchema.optional(),
  /**
   * Types the referenced card must be one of. Only meaningful on the narrowed
   * card kinds; a field that names none narrows nothing.
   */
  allowedTypeIds: z.array(entityIdSchema).optional(),
});

/** A schema-bearing classification. Exactly one is primary on a card. */
export const cardTypeSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  /** Collection label ("Characters"); derived from the name when absent. */
  pluralName: z.string().min(1).optional(),
  /** A character, drawn when the type has no icon (or the set is missing). */
  glyph: z.string().min(1),
  /** An icon reference ("lucide:book"); the glyph is the fallback. */
  icon: iconRefSchema.optional(),
  color: z.string().optional(),
  /**
   * The default paint for every card of this type. A card's own style wins over
   * it, and those two are the only levels: there are no rules, no scopes and no
   * shell paint.
   */
  style: surfaceStyleSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  fields: z.array(fieldDefinitionSchema),
  /**
   * Cards that new cards of this type can be copied from: title, body,
   * properties, tags and connectors arrive together. References, not owned
   * copies — a trashed template simply drops out of the list (ADR-0038).
   *
   * Ordered, and the order is the whole rule: the first live template is what an
   * ordinary "new card of this type" arrives written, and the rest are offered by
   * name at creation. `templateCardId` is the single-template shape older
   * documents carry; it is read as a one-element list and never written again.
   */
  templateCardIds: z.array(entityIdSchema).optional(),
  /** The pre-list shape. Read-only for compatibility; `templateCardIds` wins. */
  templateCardId: entityIdSchema.optional(),
});

/**
 * Type names are singular wherever one card is labelled; collection labels need
 * a plural. An explicit plural wins, and the fallback stays deliberately naive
 * ("-es" after a sibilant, otherwise "-s") so the field can stay optional.
 */
export function typePluralName(type: { name: string; pluralName?: string | undefined }): string {
  const explicit = type.pluralName?.trim();
  if (explicit) return explicit;
  const name = type.name.trim();
  if (!name) return name;
  return /(?:s|x|z|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`;
}

/** A freeform label with no schema, used for retrieval only. */
export const tagSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  color: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});

/**
 * A property value. The field definition decides how to read it: text/date/
 * select/card/board are strings, number and rating are numbers, checkbox is a
 * boolean, multi-select is the list of selected option ids, a `group` is a
 * record keyed by sub-field id and a `list` is an array of its item kind
 * (ADR-0057). A `card`
 * value is a card id that may point at a card that no longer exists; it renders
 * as unavailable rather than failing validation. A `board` value is likewise a
 * board id: the same soft rule applies, so a deleted board leaves the card
 * readable.
 *
 * The type is recursive because a composite value nests one level. The schema
 * accepts any depth of well-formed scalars — the depth rule (one level, a
 * `list` of `group`s of scalars) belongs to the writer, which knows the field
 * definition and can name the offending sub-field.
 */
export type PropertyValue =
  | string
  | number
  | boolean
  | PropertyValue[]
  | { [subFieldId: string]: PropertyValue };

const scalarPropertyValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
]);

export const propertyValueSchema: z.ZodType<PropertyValue> = z.lazy(() =>
  z.union([
    scalarPropertyValueSchema,
    z.array(propertyValueSchema),
    z.record(z.string(), propertyValueSchema),
  ]),
);

const cardBase = {
  id: entityIdSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  connectors: z.array(connectorSchema),
  /** Soft delete: set when the card is in the trash, cleared on restore. */
  deletedAt: z.number().int().nonnegative().nullable().optional(),
};

/**
 * A card is a workspace-level object: it owns its content, type membership,
 * tags and property values, and exists independently of any board.
 */
export const cardSchema = z.object({
  ...cardBase,
  /** Merge-safe membership; the primary type is first in the materialised list. */
  typeIds: z.array(entityIdSchema).min(1),
  primaryTypeId: entityIdSchema,
  tags: z.array(entityIdSchema),
  properties: z.record(z.string(), propertyValueSchema),
  /** Paint for the card on the canvas (ADR-0051). */
  style: surfaceStyleSchema.optional(),
  /**
   * This card's own icon, overriding its type's. Absent means "inherit"; the
   * two are the only levels, so there is no cascade to reason about.
   */
  icon: iconRefSchema.optional(),
  /** Draw no icon at all, even though the type has one. */
  iconHidden: z.boolean().optional(),
});

/** Where a card sits on a board. One placement per (board, card) pair. */
export const placementSchema = z.object({
  boardId: entityIdSchema,
  cardId: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  /** Stacking order within the board; higher paints above lower. Fractional, so a reorder writes one placement instead of renumbering the stack. */
  z: z.number().finite(),
  createdAt: z.number().int().nonnegative(),
  /** Resized card dimensions in flow units; unset means the card's natural size. */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
});

/**
 * A labeled region on one board. Sections never own cards: membership is
 * derived from placement geometry, so deleting a section cannot delete one.
 */
export const sectionSchema = z.object({
  id: entityIdSchema,
  boardId: entityIdSchema,
  title: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Ordering among overlapping sections; cards always paint above all of them. */
  z: z.number().finite(),
  color: sectionColorSchema.optional(),
  /** An icon reference, painted beside the section's title. Optional and additive. */
  icon: iconRefSchema.optional(),
  /** Link attachment points, like a card's; a section can be a link endpoint. */
  connectors: z.array(connectorSchema).optional(),
  /** Freeform labels (ADR-0053 §6); a queryable grouping, never a membership rule. */
  tags: z.array(entityIdSchema),
  /** Whether the section automatically shrinks/fits to its member cards. Defaults to true. */
  shrinkToFit: z.boolean().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const graphEdgeSchema = z.object({
  id: entityIdSchema /** Links belong to the board they were drawn on. */,
  boardId: entityIdSchema,
  source: entityIdSchema,
  target: entityIdSchema,
  /** What `source` names. Absent means a card, so older documents stay valid. */
  sourceKind: edgeEndpointKindSchema.optional(),
  /** What `target` names. Absent means a card. */
  targetKind: edgeEndpointKindSchema.optional(),
  /** Connector ids the link attaches to, when it was drawn between connectors. */
  sourceConnector: entityIdSchema.optional(),
  targetConnector: entityIdSchema.optional(),
  kind: edgeKindSchema,
  /** How the link is drawn between its two connectors. */
  path: edgePathSchema,
  /** Renders an arrowhead at both ends when true. */
  bidirectional: z.boolean(),
  label: z.string().optional(),
  /** Where the label sits along the path, 0..1; absent means the middle. */
  labelOffset: z.number().min(0).max(1).optional(),
  /**
   * Manual route, in flow coordinates **relative to the source anchor**, so a
   * moved endpoint translates the whole route instead of stranding the bends.
   * Every path style renders these (ADR-0052).
   */
  bends: z.array(positionSchema).max(24).optional(),
  /** Paint order against the cards. Absent means beneath, the safe default (ADR-0048). */
  layer: z.enum(["below", "above"]).optional(),
  /** Stroke paint for the link (ADR-0051). */
  style: surfaceStyleSchema.optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Connector = z.infer<typeof connectorSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Card = z.infer<typeof cardSchema>;
export type CardType = z.infer<typeof cardTypeSchema>;
export type Tag = z.infer<typeof tagSchema>;
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export type FieldKind = z.infer<typeof fieldKindSchema>;
export type SubField = z.infer<typeof subFieldSchema>;
export type SubFieldKind = z.infer<typeof subFieldKindSchema>;
export type ListItemKind = z.infer<typeof listItemKindSchema>;
export type RatingPresentation = z.infer<typeof ratingPresentationSchema>;
export type SelectOption = z.infer<typeof selectOptionSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type SectionColor = z.infer<typeof sectionColorSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type EdgeKind = z.infer<typeof edgeKindSchema>;
export type EdgePath = z.infer<typeof edgePathSchema>;
export type EdgeEndpointKind = z.infer<typeof edgeEndpointKindSchema>;
