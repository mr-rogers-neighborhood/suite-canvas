import { z } from "zod";

export const nodeKinds = ["note"] as const;
export const edgeKinds = ["references", "relates-to", "tagged"] as const;
export const edgePaths = ["bezier", "straight", "step", "smoothstep"] as const;

export const nodeKindSchema = z.enum(nodeKinds);
export const edgeKindSchema = z.enum(edgeKinds);
export const edgePathSchema = z.enum(edgePaths);

export const entityIdSchema = z.string().min(1);

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

export const noteDataSchema = z.object({});

export const boardSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const cardBase = {
  id: entityIdSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  connectors: z.array(connectorSchema),
  /** Soft delete: set when the card is in the trash, cleared on restore. */
  deletedAt: z.number().int().nonnegative().nullable().optional(),
};

/**
 * A card is a workspace-level object: it owns its content and connectors and
 * exists independently of any board. Where it *appears* is a placement.
 */
export const cardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), ...cardBase, data: noteDataSchema }),
]);

/** Where a card sits on a board. One placement per (board, card) pair. */
export const placementSchema = z.object({
  boardId: entityIdSchema,
  cardId: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  /** Stacking order within the board; higher paints above lower. */
  z: z.number().int(),
  createdAt: z.number().int().nonnegative(),
});

export const graphEdgeSchema = z.object({
  id: entityIdSchema,
  /** Links belong to the board they were drawn on. */
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
export type Placement = z.infer<typeof placementSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type NodeKind = z.infer<typeof nodeKindSchema>;
export type EdgeKind = z.infer<typeof edgeKindSchema>;
export type EdgePath = z.infer<typeof edgePathSchema>;
