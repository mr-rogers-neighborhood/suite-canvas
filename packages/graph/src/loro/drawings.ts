import type { LoroMap, Value } from "loro-crdt";
import {
  type Drawing,
  type DrawingElement,
  drawingElementSchema,
  nextDrawingVersion,
  normalizeDrawingOrder,
  sameDrawingValue,
} from "../drawings.js";
import {
  drawingElementFromMap,
  drawingOrderIds,
  readDrawingVersion,
  writeDrawingElementFields,
} from "../records/entities.js";
import { isMap, isMovableList, readNumber } from "../records/values.js";
import { entityIdSchema } from "../schema.js";
import { STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";

/**
 * Owns whiteboard drawings: one scene per card, its elements, their version and
 * z-order, and the tombstones that keep a delete undoable.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function drawingsMethods(ctx: DocContext) {
  return {
    /**
     * One card's scene, or null when the card has no drawing entry. Tombstoned
     * elements are filtered out; `order` is the live paint order, bottom-first.
     */
    drawing(cardId: string): Drawing | null {
      const fields = ctx.api.drawings.drawingEntry(cardId);
      if (!fields) return null;
      const byId = ctx.api.drawings.liveDrawingElements(fields);
      const order = normalizeDrawingOrder(
        drawingOrderIds(fields.get("order")),
        [...byId.keys()].sort(),
      );
      const elements: DrawingElement[] = [];
      for (const elementId of order) {
        const element = byId.get(elementId);
        if (element) elements.push(element);
      }
      return {
        cardId,
        elements,
        order,
        version: readDrawingVersion(fields) ?? 1,
        updatedAt: readNumber(fields, "updatedAt") ?? 0,
      };
    },

    drawingEntry(cardId: string): LoroMap | undefined {
      const value = ctx.drawings.get(cardId);
      return isMap(value) ? value : undefined;
    },

    drawingEntryForWrite(cardId: string): LoroMap {
      return ctx.api.drawings.drawingEntry(cardId) ?? ctx.drawings.ensureMergeableMap(cardId);
    },

    /** Live elements of one drawing keyed by id; tombstones are skipped. */
    liveDrawingElements(fields: LoroMap): Map<string, DrawingElement> {
      const byId = new Map<string, DrawingElement>();
      const elements = fields.get("elements");
      if (!isMap(elements)) return byId;
      for (const elementId of elements.keys()) {
        const elementFields = elements.get(elementId);
        if (!isMap(elementFields)) continue;
        const element = drawingElementFromMap(elementId, elementFields);
        if (element.deletedAt !== undefined) continue;
        byId.set(elementId, element);
      }
      return byId;
    },

    /** Marks a drawing as written: one timestamp and one version bump per call. */
    touchDrawing(fields: LoroMap, now: number): void {
      fields.set("updatedAt", now);
      fields.set("version", nextDrawingVersion(readDrawingVersion(fields)));
    },

    /**
     * Seed/import escape hatch: replaces the whole scene in one commit. Updates
     * should use `upsertDrawingElement`, which merges field by field.
     */
    setDrawing(
      cardId: string,
      elements: readonly DrawingElement[],
      order?: readonly string[],
    ): Drawing {
      const id = entityIdSchema.parse(cardId);
      const parsed = elements.map((element) => drawingElementSchema.parse(element));
      const seen = new Set<string>();
      for (const element of parsed) {
        if (element.deletedAt !== undefined) {
          throw new Error(`A seeded drawing cannot contain a tombstone: ${element.id}`);
        }
        if (seen.has(element.id)) throw new Error(`Duplicate drawing element: ${element.id}`);
        seen.add(element.id);
      }

      const elementIds = parsed.map((element) => element.id);
      const paintOrder = normalizeDrawingOrder(order ?? elementIds, elementIds);
      const fields = ctx.api.drawings.drawingEntryForWrite(id);
      const targetElements = fields.ensureMergeableMap("elements");
      targetElements.clear();
      for (const element of parsed) {
        const elementFields = targetElements.ensureMergeableMap(element.id);
        elementFields.clear();
        writeDrawingElementFields(elementFields, element);
      }
      const targetOrder = fields.ensureMergeableMovableList("order");
      targetOrder.clear();
      for (const elementId of paintOrder) targetOrder.push(elementId);
      ctx.api.drawings.touchDrawing(fields, Date.now());
      ctx.commit(`${STRUCT_ORIGIN}set-drawing`);

      const drawing = ctx.api.drawings.drawing(id);
      if (!drawing) throw new Error(`Drawing was not written: ${id}`);
      return drawing;
    },

    /**
     * Applies a full scene snapshot as a field-level diff in one commit. Elements
     * missing from `elements` are tombstoned (not purged), so a peer's concurrent
     * field edit survives and the delete stays reversible. Use this for editor
     * commits; `setDrawing` is the seed/import escape hatch.
     */
    applyDrawing(
      cardId: string,
      elements: readonly DrawingElement[],
      order?: readonly string[],
    ): Drawing | null {
      const id = entityIdSchema.parse(cardId);
      const parsed = elements.map((element) => drawingElementSchema.parse(element));
      const seen = new Set<string>();
      for (const element of parsed) {
        if (element.deletedAt !== undefined) {
          throw new Error(`An applied drawing cannot contain a tombstone: ${element.id}`);
        }
        if (seen.has(element.id)) throw new Error(`Duplicate drawing element: ${element.id}`);
        seen.add(element.id);
      }

      const fields = ctx.api.drawings.drawingEntryForWrite(id);
      const targetElements = fields.ensureMergeableMap("elements");
      let changed = false;
      const now = Date.now();
      const desiredIds = new Set(parsed.map((element) => element.id));

      for (const element of parsed) {
        const before = targetElements.get(element.id);
        const target = isMap(before) ? before : targetElements.ensureMergeableMap(element.id);
        let elementChanged = !isMap(before);
        const desired = new Map<string, unknown>();
        for (const [key, value] of Object.entries(element)) {
          if (key === "id" || value === undefined) continue;
          desired.set(key, value);
        }
        for (const [key, value] of desired) {
          const current = target.get(key);
          if (current === value || sameDrawingValue(current, value)) continue;
          target.set(key, value as Value);
          elementChanged = true;
        }
        for (const key of [...target.keys()]) {
          if (desired.has(key)) continue;
          target.delete(key);
          elementChanged = true;
        }
        if (elementChanged) changed = true;
      }

      for (const elementId of [...targetElements.keys()]) {
        if (desiredIds.has(elementId)) continue;
        const target = targetElements.get(elementId);
        if (!isMap(target) || target.get("deletedAt") !== undefined) continue;
        target.set("deletedAt", now);
        changed = true;
      }

      const live = new Set<string>();
      for (const elementId of targetElements.keys()) {
        const target = targetElements.get(elementId);
        if (isMap(target) && target.get("deletedAt") === undefined) live.add(elementId);
      }
      const liveIds = [...live];
      const rawOrder = fields.get("order");
      const targetOrder = isMovableList(rawOrder)
        ? rawOrder
        : fields.ensureMergeableMovableList("order");
      const currentOrder = drawingOrderIds(targetOrder);
      for (let index = currentOrder.length - 1; index >= 0; index -= 1) {
        const elementId = currentOrder[index];
        if (elementId !== undefined && live.has(elementId)) continue;
        targetOrder.delete(index, 1);
        changed = true;
      }
      const desiredOrder = normalizeDrawingOrder(
        order ?? parsed.map((element) => element.id),
        liveIds,
      );
      desiredOrder.forEach((elementId, index) => {
        const at = drawingOrderIds(targetOrder).indexOf(elementId);
        if (at === -1) {
          targetOrder.insert(index, elementId);
          changed = true;
        } else if (at !== index) {
          targetOrder.move(at, index);
          changed = true;
        }
      });

      if (!changed) return ctx.api.drawings.drawing(id);
      ctx.api.drawings.touchDrawing(fields, now);
      ctx.commit(`${STRUCT_ORIGIN}apply-drawing`);
      return ctx.api.drawings.drawing(id);
    },

    /**
     * Writes only the fields that changed, so two peers editing different fields
     * of one element both keep their edit. A new element is appended to the top
     * of the z-order; a tombstoned one is revived where it still stands in the
     * order, or appended when it no longer does.
     */
    upsertDrawingElement(cardId: string, element: DrawingElement): DrawingElement {
      const id = entityIdSchema.parse(cardId);
      const parsed = drawingElementSchema.parse(element);
      if (parsed.deletedAt !== undefined) {
        throw new Error("Use removeDrawingElement to tombstone a drawing element");
      }

      const fields = ctx.api.drawings.drawingEntryForWrite(id);
      const elements = fields.ensureMergeableMap("elements");
      const before = elements.get(parsed.id);
      const target = isMap(before) ? before : elements.ensureMergeableMap(parsed.id);
      let changed = !isMap(before);

      const desired = new Map<string, unknown>();
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "id" || value === undefined) continue;
        desired.set(key, value);
      }
      for (const [key, value] of desired) {
        const current = target.get(key);
        if (current === value || sameDrawingValue(current, value)) continue;
        target.set(key, value as Value);
        changed = true;
      }
      for (const key of [...target.keys()]) {
        if (desired.has(key)) continue;
        // A field the caller dropped goes away; this is also what revives a
        // tombstoned element, because `deletedAt` is never in `desired`.
        target.delete(key);
        changed = true;
      }
      const order = fields.ensureMergeableMovableList("order");
      if (!drawingOrderIds(order).includes(parsed.id)) {
        order.push(parsed.id);
        changed = true;
      }
      if (!changed) return drawingElementFromMap(parsed.id, target);

      ctx.api.drawings.touchDrawing(fields, Date.now());
      ctx.commit(`${STRUCT_ORIGIN}drawing-element`);
      return drawingElementFromMap(parsed.id, target);
    },

    /** Tombstones an element and takes it out of the paint order. */
    removeDrawingElement(cardId: string, elementId: string): void {
      const id = entityIdSchema.parse(cardId);
      const targetId = entityIdSchema.parse(elementId);
      const fields = ctx.api.drawings.drawingEntry(id);
      if (!fields) return;
      const elements = fields.get("elements");
      const target = isMap(elements) ? elements.get(targetId) : undefined;
      if (!isMap(target)) return;

      let changed = false;
      if (target.get("deletedAt") === undefined) {
        target.set("deletedAt", Date.now());
        changed = true;
      }
      if (ctx.api.drawings.dropFromDrawingOrder(fields, targetId)) changed = true;
      if (!changed) return;

      ctx.api.drawings.touchDrawing(fields, Date.now());
      ctx.commit(`${STRUCT_ORIGIN}remove-drawing-element`);
    },

    /** Removes a tombstone for good; a live element is removed outright. */
    purgeDrawingElement(cardId: string, elementId: string): void {
      const id = entityIdSchema.parse(cardId);
      const targetId = entityIdSchema.parse(elementId);
      const fields = ctx.api.drawings.drawingEntry(id);
      if (!fields) return;

      let changed = false;
      const elements = fields.get("elements");
      if (isMap(elements) && elements.get(targetId) !== undefined) {
        elements.delete(targetId);
        changed = true;
      }
      if (ctx.api.drawings.dropFromDrawingOrder(fields, targetId)) changed = true;
      if (!changed) return;

      ctx.api.drawings.touchDrawing(fields, Date.now());
      ctx.commit(`${STRUCT_ORIGIN}purge-drawing-element`);
    },

    /** Removes every occurrence of an id from the z-order list; true if it moved. */
    dropFromDrawingOrder(fields: LoroMap, elementId: string): boolean {
      const order = fields.get("order");
      if (!isMovableList(order)) return false;
      let removed = false;
      const ids = drawingOrderIds(order);
      for (let index = ids.length - 1; index >= 0; index -= 1) {
        if (ids[index] !== elementId) continue;
        order.delete(index, 1);
        removed = true;
      }
      return removed;
    },

    /**
     * Sets the whole z-order. Unknown ids are ignored and live elements the
     * caller left out keep their relative order after the listed ones. Moves are
     * Loro move operations, so concurrent reorders converge instead of forking.
     */
    setDrawingOrder(cardId: string, order: readonly string[]): void {
      const id = entityIdSchema.parse(cardId);
      const fields = ctx.api.drawings.drawingEntry(id);
      if (!fields) return;
      const list = fields.get("order");
      if (!isMovableList(list)) return;

      const live = ctx.api.drawings.liveDrawingElements(fields);
      const current = drawingOrderIds(list);
      const liveOrder = current.filter((elementId) => live.has(elementId));
      const desired = normalizeDrawingOrder(order, liveOrder);

      let changed = false;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const elementId = current[index];
        if (elementId === undefined || live.has(elementId)) continue;
        list.delete(index, 1);
        changed = true;
      }
      desired.forEach((elementId, index) => {
        const at = drawingOrderIds(list).indexOf(elementId);
        if (at === -1) {
          list.insert(index, elementId);
          changed = true;
        } else if (at !== index) {
          list.move(at, index);
          changed = true;
        }
      });
      if (!changed) return;

      ctx.api.drawings.touchDrawing(fields, Date.now());
      ctx.commit(`${STRUCT_ORIGIN}drawing-order`);
    },

    /** Drops a card's whole scene; the card itself is untouched. */
    clearDrawing(cardId: string): void {
      const id = entityIdSchema.parse(cardId);
      if (ctx.drawings.get(id) === undefined) return;
      ctx.drawings.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}clear-drawing`);
    },
  };
}
