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

const entityBase = {
  id: entityIdSchema,
  position: positionSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** Stacking order; higher paints above lower. */
  z: z.number().int(),
  connectors: z.array(connectorSchema),
};

export const graphNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), ...entityBase, data: noteDataSchema }),
]);

export const graphEdgeSchema = z.object({
  id: entityIdSchema,
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
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type NodeKind = z.infer<typeof nodeKindSchema>;
export type EdgeKind = z.infer<typeof edgeKindSchema>;
export type EdgePath = z.infer<typeof edgePathSchema>;
