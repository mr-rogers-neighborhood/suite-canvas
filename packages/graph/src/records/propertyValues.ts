import { LoroMap, type LoroMovableList } from "loro-crdt";
import { compositeValueError, GROUP_VALUE_TAG, isValueRecord, storedEquals } from "../composite.js";
import { isCalendarDate } from "../property.js";
import type { FieldDefinition, PropertyValue } from "../schema.js";

import { isList, isMap, isMovableList } from "./values.js";

/**
 * Owns property values on a record: reading a stored value back into a typed
 * `PropertyValue`, writing one into a map, and the check a write must pass first.
 */

/**
 * One stored property slot read back as a value. Scalars are themselves, a
 * `list` is its ordered entries, a `group` is its map (recognised by its tag, so
 * a dormant value still reads back as a group), and any other map is a
 * multi-select's membership set (`id -> true`). Containers are checked before
 * plain records because a Loro handler is an object too.
 */
export function readStoredValue(value: unknown): PropertyValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (isMap(value)) {
    return value.get(GROUP_VALUE_TAG) === true ? readRecord(value.entries()) : value.keys().sort();
  }
  if (isMovableList(value) || isList(value)) return readListItems(value.toArray());
  if (Array.isArray(value)) return readListItems(value);
  if (isValueRecord(value)) return readRecord(Object.entries(value));
  return undefined;
}

/**
 * One list entry. A map entry inside a list is always a group item — a list
 * never holds a membership set — so it reads as a record even when the field
 * definition is gone, which is what keeps a dormant list recoverable.
 */
export function readListItem(entry: unknown): PropertyValue | undefined {
  return isMap(entry) ? readRecord(entry.entries()) : readStoredValue(entry);
}

export function readListItems(entries: readonly unknown[]): PropertyValue[] {
  const items: PropertyValue[] = [];
  for (const entry of entries) {
    const read = readListItem(entry);
    if (read !== undefined) items.push(read);
  }
  return items;
}

/** A record keyed by sub-field id, in a stable order; the group tag is not a value. */
export function readRecord(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, PropertyValue> {
  const record: Record<string, PropertyValue> = {};
  const sorted = [...entries].sort(([left], [right]) => left.localeCompare(right));
  for (const [subId, entry] of sorted) {
    if (subId === GROUP_VALUE_TAG) continue;
    const read = readStoredValue(entry);
    if (read !== undefined) record[subId] = read;
  }
  return record;
}

/**
 * Writes one property slot in the storage shape its kind asks for
 * (ADR-0057 §5). Nothing
 * composite is last-write-wins over a whole collection:
 *
 * - `multiSelect` is a membership map, so concurrent picks both survive;
 * - `group` is a mergeable map keyed by sub-field id, and only *changed*
 *   sub-values are written, so a concurrent edit to a different sub-value is not
 *   overwritten by a stale copy of it;
 * - `list` is a mergeable movable list, so concurrent appends both survive and
 *   order converges. The editor commits a whole array; the writer diffs it
 *   against what is stored (common prefix and suffix, replace the middle) and
 *   issues only the inserts and deletes that difference implies.
 */
export function writePropertyValue(
  properties: LoroMap,
  fieldId: string,
  field: FieldDefinition | undefined,
  value: PropertyValue,
): void {
  if (field?.kind === "multiSelect" && Array.isArray(value)) {
    writeIdMembership(
      properties,
      fieldId,
      value.filter((entry) => typeof entry === "string"),
    );
    return;
  }
  if (field?.kind === "group" && isValueRecord(value)) {
    writeGroupValue(properties, fieldId, value);
    return;
  }
  if (field?.kind === "list" && Array.isArray(value)) {
    writeListValue(properties, fieldId, value);
    return;
  }
  if (Array.isArray(value)) {
    // An array with no field definition is a legacy multi-select membership set.
    writeIdMembership(
      properties,
      fieldId,
      value.filter((entry) => typeof entry === "string"),
    );
    return;
  }
  properties.set(fieldId, value);
}

/** A membership map (`id -> true`), which keeps two people's picks. */
export function writeIdMembership(parent: LoroMap, key: string, ids: readonly string[]): void {
  const stored = parent.get(key);
  if (stored !== undefined && !isMap(stored)) parent.delete(key);
  const selected = parent.ensureMergeableMap(key);
  const wanted = new Set(ids);
  for (const id of [...selected.keys()]) {
    if (!wanted.has(id)) selected.delete(id);
  }
  for (const id of wanted) {
    if (!selected.get(id)) selected.set(id, true);
  }
}

/** A group: mergeable map keyed by sub-field id, so sub-values merge on their own. */
export function writeGroupValue(
  parent: LoroMap,
  key: string,
  value: Record<string, PropertyValue>,
): void {
  const stored = parent.get(key);
  if (stored !== undefined && !isMap(stored)) parent.delete(key);
  const group = parent.ensureMergeableMap(key);
  if (group.get(GROUP_VALUE_TAG) !== true) group.set(GROUP_VALUE_TAG, true);
  const wanted = new Set(Object.keys(value));
  for (const subId of [...group.keys()]) {
    if (subId !== GROUP_VALUE_TAG && !wanted.has(subId)) group.delete(subId);
  }
  for (const [subId, entry] of Object.entries(value)) {
    if (storedEquals(group.get(subId), entry)) continue;
    group.set(subId, entry);
  }
}

/** A list: mergeable movable list, diffed against what is stored. */
export function writeListValue(
  parent: LoroMap,
  key: string,
  value: readonly PropertyValue[],
): void {
  const stored = parent.get(key);
  if (stored !== undefined && !isMovableList(stored)) parent.delete(key);
  syncMovableList(parent.ensureMergeableMovableList(key), value);
}

export function syncMovableList(list: LoroMovableList, next: readonly PropertyValue[]): void {
  // `toArray()` hands back container handlers for group items; compare the
  // values they resolve to, or every commit would rewrite every item.
  const current = readListItems(list.toArray());
  let head = 0;
  while (
    head < current.length &&
    head < next.length &&
    sameStoredValue(current[head], next[head])
  ) {
    head += 1;
  }
  let tailCurrent = current.length;
  let tailNext = next.length;
  while (
    tailCurrent > head &&
    tailNext > head &&
    sameStoredValue(current[tailCurrent - 1], next[tailNext - 1])
  ) {
    tailCurrent -= 1;
    tailNext -= 1;
  }
  const removed = tailCurrent - head;
  if (removed > 0) list.delete(head, removed);
  for (let index = head; index < tailNext; index += 1) {
    const item = next[index];
    if (item === undefined) break;
    if (isValueRecord(item)) {
      const entry = list.insertContainer(index, new LoroMap());
      for (const [subId, subValue] of Object.entries(item)) entry.set(subId, subValue);
    } else {
      list.insert(index, item);
    }
  }
}

export function sameStoredValue(stored: unknown, expected: PropertyValue | undefined): boolean {
  return expected !== undefined && storedEquals(stored, expected);
}

/** Writers validate against the type's own field definition. */
export function assertPropertyValue(field: FieldDefinition, value: PropertyValue): void {
  function fail(expected: string): never {
    throw new Error(`Field "${field.name}" expects ${expected}`);
  }
  switch (field.kind) {
    case "text":
      if (typeof value !== "string") fail("a string");
      return;
    case "date":
      if (typeof value !== "string" || !isCalendarDate(value)) fail("a date (YYYY-MM-DD)");
      return;
    case "card":
      // Soft validation: the target may be trashed or purged already.
      if (typeof value !== "string" || value.trim().length === 0) fail("a card id");
      return;
    case "board":
      // Soft validation too: a deleted board must not make the card unwritable
      // or unreadable, so only the shape of the id is checked here.
      if (typeof value !== "string" || value.trim().length === 0) fail("a board id");
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) fail("a finite number");
      return;
    case "checkbox":
      if (typeof value !== "boolean") fail("a boolean");
      return;
    case "select": {
      if (typeof value !== "string") fail("an option id");
      if (!field.options.some((option) => option.id === value)) fail("one of its options");
      return;
    }
    case "multiSelect": {
      if (!Array.isArray(value)) fail("a list of option ids");
      if (value.some((entry) => !field.options.some((option) => option.id === entry))) {
        fail("only its options");
      }
      return;
    }
    case "rating":
    case "group":
    case "list": {
      // One rule set, shared with the publish validator: shapes, declared
      // sub-field ids, the item kind, and one level of nesting (ADR-0057 §4).
      const error = compositeValueError(field, value);
      if (error) throw new Error(error);
      return;
    }
  }
}
