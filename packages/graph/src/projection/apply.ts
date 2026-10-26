import { LoroList, LoroMap, LoroMovableList, LoroText } from "loro-crdt";
import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";

import { isList, isMap, isMovableList, isScalar, isText } from "./containers.js";

/**
 * Owns replaying a projection into a live document: every root is replaced, so the
 * result is a rebuild rather than a merge.
 */

/** Origin of the writes that replace a live projection with a fresh rebuild. */
export const PROJECTION_APPLY_ORIGIN = "sys:projection-apply";

/** Root maps a projection owns; a rebuild replaces every one of them. */
const PROJECTION_ROOTS = WorkspaceDocument.ROOT_KEYS;

/**
 * Rewrites a map from scratch. `clear()` first frees every key, so a rebuild
 * can never leave an entry of the previous projection behind; `ensureMergeable*`
 * may hand back the container the clear just detached, so each child is cleared
 * before it is filled.
 */
function overwriteMap(source: LoroMap, target: LoroMap): void {
  target.clear();
  for (const [key, value] of source.entries()) {
    if (isMap(value)) {
      overwriteMap(value, target.ensureMergeableMap(key));
      continue;
    }
    if (isMovableList(value)) {
      overwriteMovableList(value, target.ensureMergeableMovableList(key));
      continue;
    }
    if (isList(value)) {
      overwriteList(value, target.ensureMergeableList(key));
      continue;
    }
    if (isText(value)) {
      overwriteText(value, target.ensureMergeableText(key));
      continue;
    }
    if (isScalar(value)) target.set(key, value);
  }
}

/** List items are re-created in order; the old items are gone after `clear()`. */
function overwriteList(source: LoroList, target: LoroList): void {
  target.clear();
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      overwriteMap(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isMovableList(value)) {
      overwriteMovableList(value, target.insertContainer(index, new LoroMovableList()));
      return;
    }
    if (isList(value)) {
      overwriteList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      overwriteText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (isScalar(value)) target.insert(index, value);
  });
}

/** Movable lists are rebuilt on every projection pass, order included. */
function overwriteMovableList(source: LoroMovableList, target: LoroMovableList): void {
  target.clear();
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      overwriteMap(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isMovableList(value)) {
      overwriteMovableList(value, target.insertContainer(index, new LoroMovableList()));
      return;
    }
    if (isList(value)) {
      overwriteList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      overwriteText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (isScalar(value)) target.insert(index, value);
  });
}

/** Deletes the old text before applying the delta so no stale mark survives. */
function overwriteText(source: LoroText, target: LoroText): void {
  if (target.length > 0) target.delete(0, target.length);
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
}

/**
 * Replaces a live projection document with a freshly built one, in place.
 *
 * A share room keeps one document for the life of the room, so its peer id stays
 * the same across rebuilds and each rebuild's writes win against the previous
 * ones. Everything the projection owns is cleared and rewritten, including the
 * nested containers rich text and field options live in; the source document is
 * only read. All writes land in a single commit so viewers never observe a
 * half-cleared workspace.
 */
export function applyProjection(target: WorkspaceDocument, source: WorkspaceDocument): void {
  for (const key of PROJECTION_ROOTS) {
    overwriteMap(source.doc.getMap(key), target.doc.getMap(key));
  }
  target.doc.commit({ origin: PROJECTION_APPLY_ORIGIN });
}
