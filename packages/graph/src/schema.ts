import { z } from "zod";

export const edgeKinds = ["references", "relates-to", "tagged"] as const;
export const edgePaths = ["bezier", "straight", "step", "smoothstep"] as const;
export const fieldKinds = ["text", "number", "date", "select", "multiSelect", "checkbox"] as const;
export const sectionColors = ["slate", "blue", "green", "amber", "rose", "violet"] as const;

export const edgeKindSchema = z.enum(edgeKinds);
export const edgePathSchema = z.enum(edgePaths);
export const fieldKindSchema = z.enum(fieldKinds);
export const sectionColorSchema = z.enum(sectionColors);

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

/** A typed field owned by one type. Field ids are unique across the workspace. */
export const fieldDefinitionSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  kind: fieldKindSchema,
  required: z.boolean(),
  order: z.number().int(),
  options: z.array(selectOptionSchema),
});

/** A schema-bearing classification. Exactly one is primary on a card. */
export const cardTypeSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  glyph: z.string().min(1),
  color: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  fields: z.array(fieldDefinitionSchema),
});

/** A freeform label with no schema, used for retrieval only. */
export const tagSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  color: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
});

/**
 * A property value. The field definition decides how to read it: text/date/
 * select are strings, number is a number, checkbox is a boolean, and
 * multi-select is the list of selected option ids.
 */
export const propertyValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
]);

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
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const graphEdgeSchema = z.object({
  id: entityIdSchema /** Links belong to the board they were drawn on. */,
  boardId: entityIdSchema,
  source: entityIdSchema,
  target: entityIdSchema,
  /** Connector ids the link attaches to, when it was drawn between connectors. */
  sourceConnector: entityIdSchema.optional(),
  targetConnector: entityIdSchema.optional(),
  kind: edgeKindSchema,
  /** How the link is drawn between its two connectors. */
  path: edgePathSchema,
  /** Renders an arrowhead at both ends when true. */
  bidirectional: z.boolean(),
  label: z.string().optional(),
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
export type SelectOption = z.infer<typeof selectOptionSchema>;
export type PropertyValue = z.infer<typeof propertyValueSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type SectionColor = z.infer<typeof sectionColorSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type EdgeKind = z.infer<typeof edgeKindSchema>;
export type EdgePath = z.infer<typeof edgePathSchema>;
