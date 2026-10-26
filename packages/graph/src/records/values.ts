import {
  getType,
  isContainer,
  type LoroList,
  type LoroMap,
  type LoroMovableList,
  type LoroText,
} from "loro-crdt";
import {
  isEmptyStyle,
  type SurfaceStyle,
  surfaceStyleSchema,
  type WorkspaceTheme,
  workspaceThemeSchema,
} from "../style.js";

/**
 * Owns the Loro value seam: the guards that narrow a raw container to a typed one, and
 * the small readers and writers every record mapper uses.
 */

/** Next explicit order in a map whose entries carry an `order` field. */
export function nextOrder(map: LoroMap): number {
  let max = -1;
  for (const key of map.keys()) {
    const entry = map.get(key);
    if (!isMap(entry)) continue;
    max = Math.max(max, readNumber(entry, "order") ?? -1);
  }
  return max + 1;
}

export function observeIn(
  registry: Map<string, Set<() => void>>,
  key: string,
  listener: () => void,
): () => void {
  let listeners = registry.get(key);
  if (!listeners) {
    listeners = new Set();
    registry.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) registry.delete(key);
  };
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

export function isMovableList(value: unknown): value is LoroMovableList {
  // `getType`'s conditional return type omits "MovableList", though the runtime
  // reports it; widen to the plain string to compare.
  return isContainer(value) && (getType(value) as string) === "MovableList";
}

export function readString(map: LoroMap, key: string): string | undefined {
  const value = map.get(key);
  return typeof value === "string" ? value : undefined;
}

export function readNumber(map: LoroMap, key: string): number | undefined {
  const value = map.get(key);
  return typeof value === "number" ? value : undefined;
}

/**
 * Read a paint record back. A malformed or hand-edited style is dropped rather
 * than thrown: losing a border must never make a card unreadable.
 */
export function readBends(fields: LoroMap): { x: number; y: number }[] | undefined {
  const value = fields.get("bends");
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const bends: { x: number; y: number }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return undefined;
    const { x, y } = entry as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number") return undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    bends.push({ x, y });
  }
  return bends;
}

/** Write a paint record, or remove it when the style says nothing. */
export function writeSurfaceStyle(fields: LoroMap, style: SurfaceStyle | null): void {
  if (!style) {
    fields.delete("style");
    return;
  }
  const parsed = surfaceStyleSchema.parse(style);
  if (isEmptyStyle(parsed)) fields.delete("style");
  else fields.set("style", parsed);
}

export function readSurfaceStyle(fields: LoroMap): SurfaceStyle | undefined {
  return readSurfaceStyleValue(fields.get("style"));
}

/** A paint record from a raw value, so the workspace's own style parses like a card's. */
export function readSurfaceStyleValue(value: unknown): SurfaceStyle | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parsed = surfaceStyleSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** A workspace palette from a raw value; a hand-edited one that half parses is dropped. */
export function readWorkspaceThemeValue(value: unknown): WorkspaceTheme | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parsed = workspaceThemeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function readBoolean(map: LoroMap, key: string): boolean | undefined {
  const value = map.get(key);
  return typeof value === "boolean" ? value : undefined;
}

/** Sorted ids of a membership map (`id -> true`), so reads are deterministic. */
export function readIdSet(value: unknown): string[] {
  return isMap(value) ? value.keys().sort() : [];
}

/** Rewrites a membership map to exactly `ids`, leaving shared keys untouched. */
export function writeIdSet(target: LoroMap, ids: readonly string[]): void {
  const wanted = new Set(ids);
  for (const key of [...target.keys()]) {
    if (!wanted.has(key)) target.delete(key);
  }
  for (const id of wanted) target.set(id, true);
}
