import { z } from "zod";
import { entityIdSchema } from "./schema.js";

/**
 * Scene state for a whiteboard card (Excalidraw).
 *
 * A drawing is not a card field: it is a root map keyed by card id, exactly
 * like `content` and `titles`, so the scene syncs with the card but never
 * bloats its record. Elements are stored one map per element and one key per
 * field, so two peers editing different fields of the same element merge
 * instead of overwriting each other. `order` is the z-order.
 */

/** Deepest nesting an element field may have; a guard against cyclic payloads. */
const MAX_VALUE_DEPTH = 16;

function jsonValueProblem(value: unknown, depth = 0): string | null {
  if (depth > MAX_VALUE_DEPTH) return "nested too deeply to store";
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "must be a finite number";
  if (Array.isArray(value)) {
    for (const entry of value) {
      const problem = jsonValueProblem(entry, depth + 1);
      if (problem) return problem;
    }
    return null;
  }
  if (typeof value !== "object") return `a ${typeof value} is not JSON`;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return "must be a plain object";
  for (const entry of Object.values(value)) {
    const problem = jsonValueProblem(entry, depth + 1);
    if (problem) return problem;
  }
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One Excalidraw element. The shape is deliberately permissive: the fields the
 * graph reasons about (identity, type and the bounding box) are required and
 * typed, every other Excalidraw field travels through untouched as long as it
 * is JSON the CRDT can store.
 */
export const drawingElementSchema = z
  .object({
    id: entityIdSchema,
    type: z.string().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    /** Tombstone set by a delete; a purge removes it with the element. */
    deletedAt: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .superRefine((element, ctx) => {
    for (const [key, value] of Object.entries(element)) {
      if (key === "id") continue;
      if (value === undefined) {
        // Absent optional fields are omitted by callers; an explicit
        // `undefined` is not storable and would be dropped on write.
        ctx.addIssue({ code: "custom", path: [key], message: `${key} is not a JSON value` });
        continue;
      }
      const problem = jsonValueProblem(value);
      if (problem) ctx.addIssue({ code: "custom", path: [key], message: `${key} ${problem}` });
    }
  });

/** The scene version: Excalidraw's own version, or a counter we keep. */
export const drawingVersionSchema = z.union([z.string().min(1), z.number().finite()]);

export type DrawingElement = z.infer<typeof drawingElementSchema>;
export type DrawingVersion = z.infer<typeof drawingVersionSchema>;

/** One card's scene, in the shape readers consume. */
export interface Drawing {
  cardId: string;
  /** Live elements, bottom-most first (tombstones are filtered out). */
  elements: DrawingElement[];
  /** Ids in paint order, bottom-most first. */
  order: string[];
  version: DrawingVersion;
  updatedAt: number;
}

/** The version a write leaves behind: counters advance, imported strings stay. */
export function nextDrawingVersion(version: DrawingVersion | undefined): DrawingVersion {
  if (typeof version === "number") return version + 1;
  return version ?? 1;
}

/**
 * A usable paint order: only known ids, no duplicates, and every element the
 * caller forgot appended in its current relative order. Unknown ids are
 * dropped rather than kept as dangling order entries.
 */
export function normalizeDrawingOrder(
  order: readonly string[],
  elementIds: readonly string[],
): string[] {
  const known = new Set(elementIds);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const id of order) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (const id of elementIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

/**
 * Structural equality for stored JSON values, so a field-granular write can
 * skip fields that did not change. `===` alone would rewrite every array and
 * object field on each gesture.
 */
export function sameDrawingValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameDrawingValue(value, right[index]));
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && sameDrawingValue(left[key], right[key]),
  );
}
