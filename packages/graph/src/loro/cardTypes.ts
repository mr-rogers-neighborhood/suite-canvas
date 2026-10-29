import type { LoroMap } from "loro-crdt";
import { DEFAULT_RATING_SCALE, LIST_ITEM_SUB_FIELD_ID } from "../composite.js";
import { cardTypeFromMap, fieldFromMap, optionFromMap } from "../records/entities.js";
import { isMap, nextOrder, readString } from "../records/values.js";
import {
  type CardType,
  cardTypeSchema,
  DEFAULT_TYPE_ID,
  type FieldDefinition,
  type SelectOption,
} from "../schema.js";
import { isEmptyStyle, type SurfaceStyle, surfaceStyleSchema } from "../style.js";
import { normalizeTemplate } from "../template.js";
import {
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  SCHEMA_VERSION,
  STRUCT_ORIGIN,
} from "./constants.js";
import type { DocContext } from "./context.js";
import type { CreateFieldInput, CreateTypeInput } from "./model.js";

/**
 * Owns card types: their CRUD, the fields and select options a type declares, the
 * portal type, and the built-in defaults every workspace starts with.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
/** The built-in types, which every workspace has whether or not it stored them. */
const BUILT_IN_TYPES: readonly CreateTypeInput[] = [
  { id: DEFAULT_TYPE_ID, name: "Note", glyph: "\u25a1" },
  { id: "concept", name: "Concept", glyph: "\u25c6" },
  { id: "source", name: "Source", glyph: "\u25a4" },
];

function builtInType(id: string): CardType | undefined {
  const definition = BUILT_IN_TYPES.find((entry) => entry.id === id);
  if (!definition) return undefined;
  const now = Date.now();
  return {
    id,
    name: definition.name ?? id,
    glyph: definition.glyph ?? "\u25c7",
    createdAt: now,
    updatedAt: now,
    fields: [],
  };
}

export function cardTypesMethods(ctx: DocContext) {
  return {
    cachedType(id: string): CardType | undefined {
      const cached = ctx.typeCache.get(id);
      if (cached) return cached;
      const value = ctx.types.get(id);
      if (!isMap(value)) return undefined;
      const type = cardTypeFromMap(id, value);
      ctx.typeCache.set(id, type);
      return type;
    },

    listTypes(): CardType[] {
      return ctx.types
        .keys()
        .map((id) => ctx.api.cardTypes.cachedType(id))
        .filter((type): type is CardType => type !== undefined)
        .sort(
          (a, b) =>
            Number(b.id === DEFAULT_TYPE_ID) - Number(a.id === DEFAULT_TYPE_ID) ||
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id),
        );
    },

    getType(id: string): CardType | undefined {
      return ctx.api.cardTypes.cachedType(id);
    },

    writeType(type: CardType, commit: boolean): void {
      const fields = ctx.types.ensureMergeableMap(type.id);
      fields.set("name", type.name);
      fields.set("glyph", type.glyph);
      if (type.pluralName) fields.set("pluralName", type.pluralName);
      else if (fields.get("pluralName") !== undefined) fields.delete("pluralName");
      if (type.icon) fields.set("icon", type.icon);
      else if (fields.get("icon") !== undefined) fields.delete("icon");
      if (type.color) fields.set("color", type.color);
      else if (fields.get("color") !== undefined) fields.delete("color");
      const templates = type.templateCardIds ?? (type.templateCardId ? [type.templateCardId] : []);
      const ranked = fields.ensureMergeableMap("templates");
      // Rank by position, so the list a reader sees is the list the document stores. A
      // removed template is deleted rather than left behind at rank 0: "the first one is
      // the default" has to survive the first one being taken away.
      const keep = new Set(templates);
      for (const id of ranked.keys()) if (!keep.has(id)) ranked.delete(id);
      for (const [index, id] of templates.entries()) ranked.set(id, index);
      // The old single field is not written any more; it is read, never produced.
      if (fields.get("templateCardId") !== undefined) fields.delete("templateCardId");
      fields.set("createdAt", type.createdAt);
      fields.set("updatedAt", type.updatedAt);
      fields.ensureMergeableMap("fields");
      if (commit) ctx.commit(`${STRUCT_ORIGIN}type`);
    },

    createType(input: CreateTypeInput): CardType {
      return ctx.api.cardTypes.createTypeInternal(input, true);
    },

    createTypeInternal(input: CreateTypeInput, commit: boolean): CardType {
      const now = Date.now();
      const type = cardTypeSchema.parse({
        id: input.id ?? crypto.randomUUID(),
        name: input.name.trim() || "Type",
        glyph: input.glyph ?? "\u25c7",
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        createdAt: now,
        updatedAt: now,
        fields: [],
        ...(input.color ? { color: input.color } : {}),
        ...(input.pluralName?.trim() ? { pluralName: input.pluralName.trim() } : {}),
      });
      ctx.api.cardTypes.writeType(type, commit);
      ctx.typeCache.set(type.id, type);
      return type;
    },

    updateType(
      id: string,
      patch: {
        name?: string;
        pluralName?: string | null;
        glyph?: string;
        /** An icon reference; `null` clears it and the glyph draws instead. */
        icon?: string | null;
        color?: string | null;
        /** `null` clears the type's paint, so its cards read the theme. */
        style?: SurfaceStyle | null;
        /** `null` clears the template; a card id points at the template card. */
        templateCardId?: string | null;
        /**
         * The whole list, in order. Each id must name a card; a clearing `null` empties it.
         * This is the field the editor writes; `templateCardId` stays for callers that
         * mean "one template" and is applied as a one-element list.
         */
        templateCardIds?: string[] | null;
      },
    ): void {
      // A built-in type is virtual until something edits it: a card names `note`
      // and no record exists. Editing it is the moment the record is made, which
      // is also what makes "make this the default for Note cards" land.
      const existing = ctx.api.cardTypes.getType(id);
      const type = existing ?? builtInType(id);
      if (!type) return;
      const fields = ctx.types.ensureMergeableMap(id);
      if (existing === undefined) {
        fields.set("name", type.name);
        fields.set("glyph", type.glyph);
        fields.set("createdAt", Date.now());
        fields.set("updatedAt", Date.now());
        fields.ensureMergeableMap("fields");
      }
      if (patch.name !== undefined) fields.set("name", patch.name.trim() || type.name);
      if (patch.pluralName !== undefined) {
        const pluralName = patch.pluralName?.trim();
        if (pluralName) fields.set("pluralName", pluralName);
        else if (fields.get("pluralName") !== undefined) fields.delete("pluralName");
      }
      if (patch.glyph !== undefined) fields.set("glyph", patch.glyph || type.glyph);
      if (patch.icon !== undefined) {
        const icon = patch.icon?.trim();
        if (icon) fields.set("icon", icon);
        else if (fields.get("icon") !== undefined) fields.delete("icon");
      }
      if (patch.color !== undefined) {
        if (patch.color) fields.set("color", patch.color);
        else if (fields.get("color") !== undefined) fields.delete("color");
      }
      if (patch.style !== undefined) {
        if (patch.style === null) {
          if (fields.get("style") !== undefined) fields.delete("style");
        } else {
          const parsed = surfaceStyleSchema.parse(patch.style);
          if (isEmptyStyle(parsed)) fields.delete("style");
          else fields.set("style", parsed);
        }
      }
      if (patch.templateCardId !== undefined || patch.templateCardIds !== undefined) {
        const asked =
          patch.templateCardIds !== undefined
            ? (patch.templateCardIds ?? [])
            : patch.templateCardId === null || patch.templateCardId === undefined
              ? []
              : [patch.templateCardId];
        // A template must be a card; clearing is always allowed. Unknown ids are dropped
        // rather than thrown, because the alternative is a dialog that refuses to save a
        // list because one card was deleted in another tab.
        const known = [...new Set(asked.map((id) => id.trim()).filter(Boolean))].filter(
          (id) => ctx.api.cards.getCard(id) !== undefined,
        );
        const ranked = fields.ensureMergeableMap("templates");
        const keep = new Set(known);
        for (const id of ranked.keys()) if (!keep.has(id)) ranked.delete(id);
        for (const [index, id] of known.entries()) ranked.set(id, index);
        if (fields.get("templateCardId") !== undefined) fields.delete("templateCardId");
      }
      fields.set("updatedAt", Date.now());
      ctx.typeCache.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}type`);
    },

    /**
     * Deletes a type and reassigns the cards that used it. One commit, so the
     * whole command is one undo step. The built-in note and portal types cannot
     * be deleted: the portal's board field is the only handle a portal has on its
     * target board.
     */
    deleteType(id: string, options: { reassignTo?: string } = {}): number {
      if (id === DEFAULT_TYPE_ID) {
        throw new Error("The note type cannot be deleted");
      }
      if (id === PORTAL_TYPE_ID) {
        throw new Error("The portal type cannot be deleted");
      }
      const type = ctx.api.cardTypes.getType(id);
      if (!type) return 0;
      const reassignTo = options.reassignTo ?? DEFAULT_TYPE_ID;
      if (reassignTo === id) {
        throw new Error("A type cannot be reassigned to itself");
      }
      if (!ctx.api.cardTypes.getType(reassignTo)) {
        throw new Error(`Unknown replacement type: ${reassignTo}`);
      }

      let reassigned = 0;
      for (const cardId of ctx.cards.keys()) {
        const fields = ctx.cards.get(cardId);
        if (!isMap(fields)) continue;
        const memberships = fields.get("types");
        if (!isMap(memberships) || !memberships.get(id)) continue;
        memberships.delete(id);
        if (!memberships.get(reassignTo)) memberships.set(reassignTo, true);
        if ((readString(fields, "primaryTypeId") ?? DEFAULT_TYPE_ID) === id) {
          fields.set("primaryTypeId", reassignTo);
        }
        fields.set("updatedAt", Date.now());
        reassigned += 1;
      }

      ctx.types.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}delete-type`);
      return reassigned;
    },

    /** Idempotent: the starter types, including the built-in portal, exist in every workspace. */
    ensureDefaultTypes(): void {
      let changed = false;
      for (const definition of BUILT_IN_TYPES) {
        if (ctx.api.cardTypes.getType(definition.id ?? "")) continue;
        ctx.api.cardTypes.createTypeInternal(definition, false);
        changed = true;
      }
      if (ctx.api.cardTypes.seedPortalType()) changed = true;
      if (ctx.meta.get("schemaVersion") !== SCHEMA_VERSION) {
        ctx.meta.set("schemaVersion", SCHEMA_VERSION);
        changed = true;
      }
      if (changed) ctx.commit(`${STRUCT_ORIGIN}seed`);
    },

    /**
     * Seeds the built-in portal type with its single board field. Idempotent and
     * deliberately shallow: an existing portal type is left exactly as it is,
     * renames included, so a user's edit is never clobbered on load. Writes no
     * commit of its own; the caller commits once for the whole seed.
     */
    seedPortalType(): boolean {
      if (ctx.api.cardTypes.getType(PORTAL_TYPE_ID)) return false;
      ctx.api.cardTypes.createTypeInternal(
        {
          id: PORTAL_TYPE_ID,
          name: "Portal",
          pluralName: "Portals",
          glyph: "\u25c9",
        },
        false,
      );
      const fields = ctx.api.cardTypes.typeFields(PORTAL_TYPE_ID);
      if (fields) {
        const board = fields.ensureMergeableMap(PORTAL_BOARD_FIELD_ID);
        board.set("name", "Board");
        board.set("kind", "board");
        board.set("required", true);
        board.set("order", 0);
      }
      // `createTypeInternal` cached an empty field list; the new field is already
      // in the document, but the cached type would keep lying until a commit.
      ctx.typeCache.delete(PORTAL_TYPE_ID);
      return true;
    },

    typeFields(typeId: string): LoroMap | undefined {
      const type = ctx.types.get(typeId);
      if (!isMap(type)) return undefined;
      const fields = type.get("fields");
      return isMap(fields) ? fields : undefined;
    },

    touchType(typeId: string): void {
      const type = ctx.types.get(typeId);
      if (isMap(type)) type.set("updatedAt", Date.now());
    },

    addField(typeId: string, input: CreateFieldInput): FieldDefinition {
      const fields = ctx.api.cardTypes.typeFields(typeId);
      if (!fields) throw new Error(`Unknown type: ${typeId}`);
      const id = crypto.randomUUID();
      const order = nextOrder(fields);
      const field = fields.ensureMergeableMap(id);
      field.set("name", input.name.trim() || "Field");
      field.set("kind", input.kind);
      field.set("required", input.required ?? false);
      field.set("order", order);
      if (input.kind === "select" || input.kind === "multiSelect") {
        const options = field.ensureMergeableMap("options");
        (input.options ?? []).forEach((label, index) => {
          const optionId = crypto.randomUUID();
          const option = options.ensureMergeableMap(optionId);
          option.set("label", label);
          option.set("order", index);
        });
      }
      if (input.kind === "group" || input.kind === "list") {
        // A list with no declared item is a list of text: the kind picker can add
        // one, and it must not fail for not having asked about a sub-schema yet.
        const subFields =
          input.subFields && input.subFields.length > 0
            ? input.subFields
            : input.kind === "list"
              ? [{ id: LIST_ITEM_SUB_FIELD_ID, name: "Item", kind: "text" as const }]
              : [];
        const subFieldMap = field.ensureMergeableMap("subFields");
        // A list of scalars has exactly one entry, and its id is the fixed `item`
        // id so a value written by any replica lands on the same sub-field.
        const defaultListItemId = subFields.length === 1 ? LIST_ITEM_SUB_FIELD_ID : null;
        subFields.forEach((sub, index) => {
          const subId = sub.id?.trim() || defaultListItemId || crypto.randomUUID();
          const entry = subFieldMap.ensureMergeableMap(subId);
          entry.set("name", sub.name.trim() || "Field");
          entry.set("kind", sub.kind);
          entry.set("order", index);
        });
        if (input.kind === "list") field.set("itemKind", input.itemKind ?? "scalar");
      }
      if (input.kind === "rating") {
        const presentation = input.rating;
        field.set("rating", {
          scale: presentation?.scale ?? DEFAULT_RATING_SCALE,
          ...(presentation?.half !== undefined ? { half: presentation.half } : {}),
          ...(presentation?.icon ? { icon: presentation.icon } : {}),
        });
      }
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
      return fieldFromMap(id, field);
    },

    /** The kind is immutable: deleting and recreating a field is the migration. */
    updateField(
      typeId: string,
      fieldId: string,
      patch: { name?: string; required?: boolean; display?: string | null },
    ): void {
      const field = ctx.api.cardTypes.typeFields(typeId)?.get(fieldId);
      if (!isMap(field)) return;
      if (patch.name !== undefined) field.set("name", patch.name.trim() || "Field");
      if (patch.required !== undefined) field.set("required", patch.required);
      if (patch.display !== undefined) {
        const display = normalizeTemplate(patch.display);
        if (display) field.set("display", display);
        else if (field.get("display") !== undefined) field.delete("display");
      }
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
    },

    /**
     * Removes the definition only; card values stay dormant and can be revived.
     * The portal's board field is refused: without it a portal has nothing to
     * point at, and the built-in type is a single-field type by design.
     */
    removeField(typeId: string, fieldId: string): void {
      if (typeId === PORTAL_TYPE_ID && fieldId === PORTAL_BOARD_FIELD_ID) {
        throw new Error("The portal board field cannot be removed");
      }
      const fields = ctx.api.cardTypes.typeFields(typeId);
      if (!fields || fields.get(fieldId) === undefined) return;
      fields.delete(fieldId);
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
    },

    moveField(typeId: string, fieldId: string, toIndex: number): void {
      const fields = ctx.api.cardTypes.typeFields(typeId);
      const type = ctx.api.cardTypes.getType(typeId);
      if (!fields || !type) return;
      const ordered = type.fields.filter((field) => field.id !== fieldId);
      const moved = type.fields.find((field) => field.id === fieldId);
      if (!moved) return;
      ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, moved);
      ordered.forEach((field, index) => {
        const target = fields.get(field.id);
        if (isMap(target)) target.set("order", index);
      });
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
    },

    addSelectOption(
      typeId: string,
      fieldId: string,
      input: { label: string; color?: string },
    ): SelectOption {
      const options = ctx.api.cardTypes.fieldOptions(typeId, fieldId);
      if (!options) throw new Error(`Field ${fieldId} has no options`);
      const id = crypto.randomUUID();
      const option = options.ensureMergeableMap(id);
      option.set("label", input.label.trim() || "Option");
      if (input.color) option.set("color", input.color);
      option.set("order", nextOrder(options));
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
      return optionFromMap(id, option);
    },

    updateSelectOption(
      typeId: string,
      fieldId: string,
      optionId: string,
      patch: { label?: string; color?: string | null },
    ): void {
      const option = ctx.api.cardTypes.fieldOptions(typeId, fieldId)?.get(optionId);
      if (!isMap(option)) return;
      if (patch.label !== undefined) option.set("label", patch.label.trim() || "Option");
      if (patch.color !== undefined) {
        if (patch.color) option.set("color", patch.color);
        else if (option.get("color") !== undefined) option.delete("color");
      }
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
    },

    removeSelectOption(typeId: string, fieldId: string, optionId: string): void {
      const options = ctx.api.cardTypes.fieldOptions(typeId, fieldId);
      if (!options || options.get(optionId) === undefined) return;
      options.delete(optionId);
      ctx.api.cardTypes.touchType(typeId);
      ctx.commit(`${STRUCT_ORIGIN}field`);
    },

    fieldOptions(typeId: string, fieldId: string): LoroMap | undefined {
      const field = ctx.api.cardTypes.typeFields(typeId)?.get(fieldId);
      if (!isMap(field)) return undefined;
      const options = field.get("options");
      return isMap(options) ? options : undefined;
    },
  };
}
