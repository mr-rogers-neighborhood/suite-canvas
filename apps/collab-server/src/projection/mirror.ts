import { PROJECTION_APPLY_ORIGIN, WorkspaceDocument } from "@suite/graph";
import { getType, isContainer, LoroList, LoroMap, LoroMovableList, LoroText } from "loro-crdt";

/**
 * Owns writing a fresh projection into a live share room **by difference**.
 *
 * `applyProjection` (`@suite/graph`) has the right contract and the wrong cost:
 * it clears every root and rewrites it, so a save that moved one card appends a
 * whole board's worth of operations to the room document. Those operations are
 * never reclaimed — the room's document is a CRDT with history — so a share room
 * grew by ~211 KB per save round on the 200-card bench fixture (189 873 bytes
 * after the first build, 1 452 991 after seven). Everything downstream of that
 * document then grew with it: the update each viewer receives, the snapshot the
 * relay re-serialises for every inbound update, the stored row, and the join a
 * new reader waits on. Measured with `SUITE_PROJECTION_TRACE=1`, share latency
 * went 13.5 s → 45.3 s over six edits on a 219 KB board while the rebuild itself
 * stayed at ~300 ms.
 *
 * This module reaches the same end state as `applyProjection` — every root of
 * the target equals the source's, nothing of the previous projection survives —
 * while touching only the entries that actually differ. A save that moved one
 * placement writes one scalar. The projection is a *derived copy*, not document
 * truth: the worker is its only writer, so there is no merge to lose, and
 * `mirror.test.ts` pins "incremental equals from scratch" on a board that
 * changes in every way a source can change.
 */

/**
 * Origin of a mirror pass. It matches `applyProjection`'s, so the worker's draft
 * watcher recognises both write paths as the projection rather than an editor.
 */
const PROJECTION_MIRROR_ORIGIN = PROJECTION_APPLY_ORIGIN;

/** What one mirror pass wrote, removed and left alone. */
export interface MirrorStats {
  /** Map keys, list items and text runs written into the room. */
  written: number;
  /** Map keys deleted because the projection no longer has them. */
  removed: number;
  /** Entries that already matched and were not touched. */
  kept: number;
}

/** A container tree flattened to plain values, for equality only. */
type Rendered =
  | null
  | boolean
  | number
  | string
  | number[]
  | Rendered[]
  | { [key: string]: Rendered };

function isMapValue(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isListValue(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

function isMovableListValue(value: unknown): value is LoroMovableList {
  return isContainer(value) && (getType(value) as string) === "MovableList";
}

function isTextValue(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

/** The same five kinds the projection copy path recognises, and nothing else. */
function isScalarValue(value: unknown): value is string | number | boolean | null | Uint8Array {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  );
}

/** Renders a container tree to plain values, with keys ordered and marks kept. */
function render(value: unknown): Rendered {
  if (isMapValue(value)) {
    const out: { [key: string]: Rendered } = {};
    for (const key of [...value.keys()].map(String).sort()) {
      out[key] = render(value.get(key));
    }
    return out;
  }
  if (isMovableListValue(value) || isListValue(value)) {
    return value.toArray().map((item) => render(item));
  }
  if (isTextValue(value)) {
    // The delta, not the string: two bodies with the same text and different
    // marks are different projections.
    return { delta: renderDeltas(value.toDelta()) };
  }
  if (value instanceof Uint8Array) return Array.from(value);
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return null;
}

/**
 * Text marks, as a stable plain value.
 *
 * `toDelta()` hands attributes back as ordinary JS objects, not Loro containers,
 * so `render` would call them empty and two runs that differ only in a mark would
 * compare equal. A reader who bolds a word would never see it.
 */
function renderAttributes(attributes: unknown): Rendered {
  if (attributes === null || attributes === undefined) return null;
  if (Array.isArray(attributes)) return attributes.map((item) => renderAttributes(item));
  if (attributes instanceof Map) {
    const out: { [key: string]: Rendered } = {};
    for (const key of [...attributes.keys()].map(String).sort()) {
      out[key] = renderAttributes(attributes.get(key));
    }
    return out;
  }
  if (typeof attributes === "object") {
    const record = attributes as Record<string, unknown>;
    const out: { [key: string]: Rendered } = {};
    for (const key of Object.keys(record).sort()) out[key] = renderAttributes(record[key]);
    return out;
  }
  return render(attributes);
}

function renderDeltas(deltas: readonly { insert?: unknown; attributes?: unknown }[]): Rendered {
  return deltas.map((run) => ({
    insert: typeof run.insert === "string" ? run.insert : "",
    attributes: renderAttributes(run.attributes),
  }));
}

function same(left: Rendered, right: Rendered): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => same(item, right[index] ?? null));
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => key in right && same(left[key] ?? null, right[key] ?? null));
}

/** Replaces a text container's runs, marks included. */
function overwriteText(source: LoroText, target: LoroText, stats: MirrorStats): void {
  if (target.length > 0) target.delete(0, target.length);
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
  stats.written += 1;
}

/** Rebuilds a list in place; only reached when the list already differs. */
function overwriteListArray(
  source: LoroList | LoroMovableList,
  target: LoroList | LoroMovableList,
  stats: MirrorStats,
): void {
  target.clear();
  source.toArray().forEach((value, index) => {
    if (isMapValue(value)) {
      mirrorMap(value, target.insertContainer(index, new LoroMap()), stats);
      return;
    }
    if (isMovableListValue(value)) {
      mirrorMovableList(value, target.insertContainer(index, new LoroMovableList()), stats);
      return;
    }
    if (isListValue(value)) {
      mirrorList(value, target.insertContainer(index, new LoroList()), stats);
      return;
    }
    if (isTextValue(value)) {
      overwriteText(value, target.insertContainer(index, new LoroText()), stats);
      return;
    }
    if (isScalarValue(value)) {
      target.insert(index, value);
      stats.written += 1;
    }
  });
}

function mirrorList(source: LoroList, target: LoroList, stats: MirrorStats): void {
  if (same(render(source), render(target))) {
    stats.kept += 1;
    return;
  }
  overwriteListArray(source, target, stats);
}

function mirrorMovableList(
  source: LoroMovableList,
  target: LoroMovableList,
  stats: MirrorStats,
): void {
  if (same(render(source), render(target))) {
    stats.kept += 1;
    return;
  }
  overwriteListArray(source, target, stats);
}

/**
 * Makes `target` equal `source` key by key.
 *
 * A key the projection dropped is deleted, a key whose container changed type is
 * replaced (a value can move between a map, a list and a text without the key
 * changing), and a key that already matches is not written at all. That last
 * case is the whole point: on the bench fixture it is every key but one.
 */
function mirrorMap(source: LoroMap, target: LoroMap, stats: MirrorStats): void {
  for (const key of [...target.keys()].map(String)) {
    if (source.get(key) !== undefined) continue;
    target.delete(key);
    stats.removed += 1;
  }

  for (const [key, value] of source.entries()) {
    const current = target.get(key);
    if (isMapValue(value)) {
      if (isMapValue(current)) mirrorMap(value, current, stats);
      else {
        if (current !== undefined) target.delete(key);
        mirrorMap(value, target.ensureMergeableMap(key), stats);
      }
      continue;
    }
    if (isMovableListValue(value)) {
      if (isMovableListValue(current)) mirrorMovableList(value, current, stats);
      else {
        if (current !== undefined) target.delete(key);
        mirrorMovableList(value, target.ensureMergeableMovableList(key), stats);
      }
      continue;
    }
    if (isListValue(value)) {
      if (isListValue(current)) mirrorList(value, current, stats);
      else {
        if (current !== undefined) target.delete(key);
        mirrorList(value, target.ensureMergeableList(key), stats);
      }
      continue;
    }
    if (isTextValue(value)) {
      if (isTextValue(current)) {
        if (same(render(value), render(current))) stats.kept += 1;
        else overwriteText(value, current, stats);
      } else {
        if (current !== undefined) target.delete(key);
        overwriteText(value, target.ensureMergeableText(key), stats);
      }
      continue;
    }
    if (!isScalarValue(value)) continue;
    if (current !== undefined && same(render(value), render(current))) {
      stats.kept += 1;
      continue;
    }
    target.set(key, value);
    stats.written += 1;
  }
}

/**
 * Rewrites a live projection document into the shape of a fresh one, writing
 * only the difference. The end state is exactly what `applyProjection` produces:
 * every root of `target` is replaced by `source`'s, in a single commit, so a
 * viewer never observes a half-updated workspace. A pass that changes nothing
 * commits nothing, so a source save that does not move a share costs it zero
 * bytes.
 */
export function mirrorWorkspace(target: WorkspaceDocument, source: WorkspaceDocument): MirrorStats {
  const stats: MirrorStats = { written: 0, removed: 0, kept: 0 };
  for (const key of WorkspaceDocument.ROOT_KEYS) {
    mirrorMap(source.doc.getMap(key), target.doc.getMap(key), stats);
  }
  // A commit with no writes is still an op on the room's history, and it would
  // mark the room dirty for a save that carries nothing. An unchanged
  // projection must cost the room document nothing at all.
  if (stats.written > 0 || stats.removed > 0) {
    target.doc.commit({ origin: PROJECTION_MIRROR_ORIGIN });
  }
  return stats;
}
