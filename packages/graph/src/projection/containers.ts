import {
  getType,
  isContainer,
  type LoroDoc,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
} from "loro-crdt";
import { SCHEMA_VERSION, WorkspaceDocument } from "../loro/WorkspaceDocument.js";

/**
 * Owns copying a container tree into a fresh document: maps stay mergeable, list items
 * are inserted in order, and text keeps its marks.
 */

export function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

export function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

export function isMovableList(value: unknown): value is LoroMovableList {
  // `getType`'s conditional return type omits "MovableList" even though the
  // runtime reports it, so widen before comparing.
  return isContainer(value) && (getType(value) as string) === "MovableList";
}

export function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

/** A value Loro stores inline rather than as a child container. */
export function isScalar(value: unknown): value is string | number | boolean | null | Uint8Array {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  );
}

/**
 * Copy one map's entries into another map, including the container structure
 * rich text depends on. Containers become mergeable children so copying the
 * same key twice lands on the same child instead of forking it.
 */
function copyMap(source: LoroMap, target: LoroMap): void {
  for (const [key, value] of source.entries()) {
    if (isMap(value)) {
      copyMap(value, target.ensureMergeableMap(key));
      continue;
    }
    if (isMovableList(value)) {
      copyMovableList(value, target.ensureMergeableMovableList(key));
      continue;
    }
    if (isList(value)) {
      copyList(value, target.ensureMergeableList(key));
      continue;
    }
    if (isText(value)) {
      copyText(value, target.ensureMergeableText(key));
      continue;
    }
    if (isScalar(value)) target.set(key, value);
  }
}

/** List items are inserted as new containers so their order is preserved. */
function copyList(source: LoroList, target: LoroList): void {
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      copyMap(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isMovableList(value)) {
      copyMovableList(value, target.insertContainer(index, new LoroMovableList()));
      return;
    }
    if (isList(value)) {
      copyList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      copyText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (isScalar(value)) target.insert(index, value);
  });
}

/** Movable lists copy like lists: the order is the valuable part. */
function copyMovableList(source: LoroMovableList, target: LoroMovableList): void {
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      copyMap(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isMovableList(value)) {
      copyMovableList(value, target.insertContainer(index, new LoroMovableList()));
      return;
    }
    if (isList(value)) {
      copyList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      copyText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (isScalar(value)) target.insert(index, value);
  });
}

/** Text carries marks in its delta; attributes survive the round trip. */
function copyText(source: LoroText, target: LoroText): void {
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
}

/** Copy the map stored under `key`, skipping keys that hold nothing copyable. */
export function copyEntry(source: LoroMap, target: LoroMap, key: string): void {
  const value = source.get(key);
  if (isMap(value)) copyMap(value, target.ensureMergeableMap(key));
}

function orderedIds(value: unknown): string[] {
  if (!isMovableList(value)) return [];
  return value.toArray().filter((entry): entry is string => typeof entry === "string");
}

/**
 * Copies a card's scene without its tombstones: a viewer never needs a deleted
 * element, and leaving one behind would carry its last geometry into the share.
 * Order and version travel untouched.
 */
export function copyDrawing(source: LoroMap, target: LoroMap, cardId: string): void {
  const from = source.get(cardId);
  if (!isMap(from)) return;
  const to = target.ensureMergeableMap(cardId);
  for (const key of ["version", "updatedAt"]) {
    const value = from.get(key);
    if (isScalar(value)) to.set(key, value);
  }

  const live = new Set<string>();
  const fromElements = from.get("elements");
  const toElements = to.ensureMergeableMap("elements");
  if (isMap(fromElements)) {
    for (const elementId of fromElements.keys()) {
      const fields = fromElements.get(elementId);
      if (!isMap(fields)) continue;
      if (fields.get("deletedAt") !== undefined) continue;
      live.add(elementId);
      copyMap(fields, toElements.ensureMergeableMap(elementId));
    }
  }

  const seen = new Set<string>();
  const toOrder = to.ensureMergeableMovableList("order");
  for (const elementId of orderedIds(from.get("order"))) {
    if (!live.has(elementId) || seen.has(elementId)) continue;
    seen.add(elementId);
    toOrder.push(elementId);
  }
  for (const elementId of [...live].sort()) {
    if (seen.has(elementId)) continue;
    toOrder.push(elementId);
  }
}

export function copyMeta(source: LoroDoc, target: LoroDoc): void {
  const from = source.getMap(WorkspaceDocument.META_KEY);
  const to = target.getMap(WorkspaceDocument.META_KEY);
  for (const [key, value] of from.entries()) {
    if (isScalar(value)) to.set(key, value);
  }
  if (to.get("schemaVersion") === undefined) to.set("schemaVersion", SCHEMA_VERSION);
}
