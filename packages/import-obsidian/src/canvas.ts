import { z } from "zod";

/**
 * Owns JSON Canvas (`.canvas`), the format Obsidian writes and jsoncanvas.org
 * specifies at version 1.0: `nodes` with an id, a type, real geometry and an
 * optional colour, and `edges` naming the nodes they join.
 *
 * Unknown node or edge keys are allowed through and ignored, so a canvas written
 * by a newer Obsidian imports instead of failing.
 */

export const canvasNodeTypes = ["text", "file", "link", "group"] as const;
export const canvasSides = ["top", "right", "bottom", "left"] as const;

export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(canvasNodeTypes),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Obsidian's preset ("1".."6") or a hex colour. */
  color: z.string().min(1).optional(),
  /** The Markdown a `text` node holds. */
  text: z.string().optional(),
  /** The vault path a `file` node points at. */
  file: z.string().optional(),
  /** A heading or block inside that file, when the node links into it. */
  subpath: z.string().optional(),
  /** The address a `link` node opens. */
  url: z.string().optional(),
  /** A group's title. */
  label: z.string().optional(),
});

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  fromNode: z.string().min(1),
  toNode: z.string().min(1),
  fromSide: z.enum(canvasSides).optional(),
  toSide: z.enum(canvasSides).optional(),
  color: z.string().min(1).optional(),
  label: z.string().optional(),
});

export const canvasFileSchema = z.object({
  nodes: z.array(canvasNodeSchema).default([]),
  edges: z.array(canvasEdgeSchema).default([]),
});

export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type CanvasFile = z.infer<typeof canvasFileSchema>;

export type CanvasParseResult = { ok: true; canvas: CanvasFile } | { ok: false; reason: string };

/** Reads a `.canvas` file, naming why it could not be read when it cannot. */
export function parseCanvas(text: string): CanvasParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `The canvas is not valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
  const parsed = canvasFileSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") ?? "the file";
    return { ok: false, reason: `The canvas does not match JSON Canvas 1.0 at ${where}.` };
  }
  return { ok: true, canvas: parsed.data };
}
