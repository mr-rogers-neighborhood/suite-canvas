import { isContainer, LoroList, LoroMap, LoroText } from "loro-crdt";

import { PROPERTY_BLOCK_NODE_NAME } from "../loro/constants.js";
import { isList, isMap, isText } from "./values.js";

/**
 * Owns rich-text containers: the deep copy that keeps a subtree mergeable, the text
 * readers, and the property-block node helpers.
 */

/**
 * Deep-copies a rich-text container tree into a fresh one. This mirrors the
 * share projection's copy (`projection/containers.ts`): maps become mergeable children so
 * a repeat copy lands on the same container instead of forking it, list items
 * are inserted as new containers to keep their order, and text goes through
 * `toDelta`/`applyDelta` so marks survive.
 */
export function copyContainerTree(source: LoroMap, target: LoroMap): void {
  for (const [key, value] of source.entries()) {
    if (isMap(value)) {
      copyContainerTree(value, target.ensureMergeableMap(key));
      continue;
    }
    if (isList(value)) {
      copyContainerList(value, target.ensureMergeableList(key));
      continue;
    }
    if (isText(value)) {
      copyContainerText(value, target.ensureMergeableText(key));
      continue;
    }
    // Plain JSON values travel as-is; other container kinds are not card content.
    if (value === undefined || isContainer(value)) continue;
    target.set(key, value);
  }
}

/** Lists copy through new containers; scalars keep their position. */
export function copyContainerList(source: LoroList, target: LoroList): void {
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      copyContainerTree(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isList(value)) {
      copyContainerList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      copyContainerText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (value === undefined || isContainer(value)) return;
    target.insert(index, value);
  });
}

/** Marks live in the delta, so copying text is a delta round trip. */
export function copyContainerText(source: LoroText, target: LoroText): void {
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
}

/** Text of a `loro-prosemirror` tree, a text container, or a list of nodes. */
export function textOf(value: unknown): string {
  if (isText(value)) return value.toString();
  if (isList(value)) return value.toArray().map(textOf).join("\n");
  if (isMap(value)) {
    const children = value.get("children");
    if (children !== undefined) return textOf(children);
    const text = value.get("text");
    if (isText(text)) return text.toString();
    return "";
  }
  return typeof value === "string" ? value : "";
}

export function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * The field a property block points at. `loro-prosemirror` stores node attrs on
 * the node's own `attributes` map; reading the node's key as well tolerates
 * hand-built containers.
 */
export function propertyBlockFieldId(node: LoroMap): string | undefined {
  const attributes = node.get("attributes");
  const raw = isMap(attributes) ? attributes.get("fieldId") : node.get("fieldId");
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Children list of a `loro-prosemirror` node. Its containers are plain
 * (`getOrCreateContainer`), not mergeable, so `ensureMergeableList` would throw
 * on a body an editor already wrote.
 */
export function loroChildren(parent: LoroMap): LoroList {
  const existing = parent.get("children");
  return isList(existing) ? existing : parent.getOrCreateContainer("children", new LoroList());
}

/** Attributes map of a `loro-prosemirror` node, created the same way it does. */
export function loroAttributes(node: LoroMap): LoroMap {
  const existing = node.get("attributes");
  return isMap(existing) ? existing : node.getOrCreateContainer("attributes", new LoroMap());
}

/** Field ids of the property blocks in a ProseMirror tree, in document order. */
export function propertyBlockFieldIds(root: unknown, out: string[] = []): string[] {
  if (isList(root)) {
    for (const child of root.toArray()) propertyBlockFieldIds(child, out);
    return out;
  }
  if (!isMap(root)) return out;
  if (root.get("nodeName") === PROPERTY_BLOCK_NODE_NAME) {
    const fieldId = propertyBlockFieldId(root);
    if (fieldId !== undefined && !out.includes(fieldId)) out.push(fieldId);
  }
  const children = root.get("children");
  if (children !== undefined) propertyBlockFieldIds(children, out);
  return out;
}
