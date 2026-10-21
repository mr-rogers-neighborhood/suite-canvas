import { z } from "zod";

export const nodeKinds = ["note", "document", "tag"] as const;
export const edgeKinds = ["references", "relates-to", "tagged"] as const;

export const nodeKindSchema = z.enum(nodeKinds);
export const edgeKindSchema = z.enum(edgeKinds);

export const entityIdSchema = z.string().min(1);

export const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const noteDataSchema = z.object({
  text: z.string(),
});

export const documentDataSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export const tagDataSchema = z.object({
  label: z.string(),
  color: z.string(),
});

const entityBase = {
  id: entityIdSchema,
  position: positionSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};

export const graphNodeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), ...entityBase, data: noteDataSchema }),
  z.object({ kind: z.literal("document"), ...entityBase, data: documentDataSchema }),
  z.object({ kind: z.literal("tag"), ...entityBase, data: tagDataSchema }),
]);

export const graphEdgeSchema = z.object({
  id: entityIdSchema,
  source: entityIdSchema,
  target: entityIdSchema,
  kind: edgeKindSchema,
  label: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type NodeKind = z.infer<typeof nodeKindSchema>;
export type EdgeKind = z.infer<typeof edgeKindSchema>;
