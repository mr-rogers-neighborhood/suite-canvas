import { isContainer, type LoroMap, type Value } from "loro-crdt";
import { type DrawingElement, type DrawingVersion, drawingElementSchema } from "../drawings.js";
import { CONNECTORS_FIELD } from "../loro/constants.js";
import {
  type CardType,
  type Connector,
  cardTypeSchema,
  edgeEndpointKindSchema,
  type FieldDefinition,
  fieldDefinitionSchema,
  type GraphEdge,
  graphEdgeSchema,
  listItemKindSchema,
  type Placement,
  placementSchema,
  ratingPresentationSchema,
  type Section,
  type SelectOption,
  type SubField,
  sectionSchema,
  selectOptionSchema,
  subFieldSchema,
  type Tag,
  tagSchema,
} from "../schema.js";
import {
  isMap,
  isMovableList,
  readBends,
  readBoolean,
  readIdSet,
  readNumber,
  readString,
  readSurfaceStyle,
  readSurfaceStyleValue,
} from "./values.js";

/**
 * Owns the record mappers: one function per stored entity that reads a Loro map into the
 * schema type, so nothing outside this folder parses a record by hand.
 */

export function normalizeEdge(edge: GraphEdge): GraphEdge {
  const legacy = edge as GraphEdge & {
    bidirectional?: boolean;
    path?: GraphEdge["path"];
  };
  return {
    ...edge,
    bidirectional: typeof legacy.bidirectional === "boolean" ? legacy.bidirectional : false,
    path: legacy.path ?? "bezier",
  };
}

export function connectorFromMap(id: string, fields: LoroMap): Connector {
  return {
    id,
    x: readNumber(fields, "x") ?? 0,
    y: readNumber(fields, "y") ?? 0,
  };
}

/** A connector map as an ordered array; cards and sections store them alike. */
export function connectorsFromMap(fields: LoroMap): Connector[] {
  const connectorMap = fields.get(CONNECTORS_FIELD);
  if (!isMap(connectorMap)) return [];
  const ordered: Array<{ connector: Connector; order: number }> = [];
  for (const connectorId of connectorMap.keys()) {
    const connector = connectorMap.get(connectorId);
    if (!isMap(connector)) continue;
    ordered.push({
      connector: connectorFromMap(connectorId, connector),
      order: readNumber(connector, "order") ?? Number.MAX_SAFE_INTEGER,
    });
  }
  ordered.sort(
    (left, right) =>
      left.order - right.order || left.connector.id.localeCompare(right.connector.id),
  );
  return ordered.map((entry) => entry.connector);
}

export function optionFromMap(id: string, fields: LoroMap): SelectOption {
  const color = readString(fields, "color");
  return selectOptionSchema.parse({
    id,
    label: readString(fields, "label") ?? id,
    order: readNumber(fields, "order") ?? Number.MAX_SAFE_INTEGER,
    ...(color ? { color } : {}),
  });
}

export function fieldFromMap(id: string, fields: LoroMap): FieldDefinition {
  const options: SelectOption[] = [];
  const optionsMap = fields.get("options");
  if (isMap(optionsMap)) {
    for (const optionId of optionsMap.keys()) {
      const option = optionsMap.get(optionId);
      if (isMap(option)) options.push(optionFromMap(optionId, option));
    }
  }
  options.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const subFields: SubField[] = [];
  const subFieldsMap = fields.get("subFields");
  if (isMap(subFieldsMap)) {
    for (const subId of subFieldsMap.keys()) {
      const sub = subFieldsMap.get(subId);
      if (!isMap(sub)) continue;
      const parsed = subFieldSchema.safeParse({
        id: subId,
        name: readString(sub, "name") ?? "Field",
        kind: readString(sub, "kind") ?? "text",
        order: readNumber(sub, "order") ?? Number.MAX_SAFE_INTEGER,
      });
      if (parsed.success) subFields.push(parsed.data);
    }
  }
  subFields.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const itemKind = listItemKindSchema.safeParse(fields.get("itemKind"));
  const rating = ratingPresentationSchema.safeParse(fields.get("rating"));
  const display = readString(fields, "display");
  return fieldDefinitionSchema.parse({
    id,
    name: readString(fields, "name") ?? "Field",
    kind: readString(fields, "kind") ?? "text",
    required: readBoolean(fields, "required") ?? false,
    order: readNumber(fields, "order") ?? Number.MAX_SAFE_INTEGER,
    options,
    ...(display ? { display } : {}),
    ...(subFields.length > 0 ? { subFields } : {}),
    ...(itemKind.success ? { itemKind: itemKind.data } : {}),
    ...(rating.success ? { rating: rating.data } : {}),
  });
}

export function cardTypeFromMap(id: string, fields: LoroMap): CardType {
  const definitions: FieldDefinition[] = [];
  const fieldsMap = fields.get("fields");
  if (isMap(fieldsMap)) {
    for (const fieldId of fieldsMap.keys()) {
      const field = fieldsMap.get(fieldId);
      if (isMap(field)) definitions.push(fieldFromMap(fieldId, field));
    }
  }
  definitions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const color = readString(fields, "color");
  const pluralName = readString(fields, "pluralName")?.trim();
  const templateCardId = readString(fields, "templateCardId")?.trim();
  const style = readSurfaceStyleValue(fields.get("style"));
  return cardTypeSchema.parse({
    id,
    name: readString(fields, "name") ?? "Type",
    glyph: readString(fields, "glyph") ?? "\u25c7",
    createdAt: readNumber(fields, "createdAt") ?? 0,
    updatedAt: readNumber(fields, "updatedAt") ?? 0,
    fields: definitions,
    ...(templateCardId ? { templateCardId } : {}),
    ...(color ? { color } : {}),
    ...(pluralName ? { pluralName } : {}),
    ...(style ? { style } : {}),
  });
}

export function tagFromMap(id: string, fields: LoroMap): Tag {
  const color = readString(fields, "color");
  return tagSchema.parse({
    id,
    name: readString(fields, "name") ?? id,
    createdAt: readNumber(fields, "createdAt") ?? 0,
    ...(color ? { color } : {}),
  });
}

export function sectionFromMap(id: string, fields: LoroMap): Section {
  const color = readString(fields, "color");
  const style = readSurfaceStyle(fields);
  return sectionSchema.parse({
    id,
    boardId: readString(fields, "boardId") ?? "",
    title: readString(fields, "title") ?? "",
    x: readNumber(fields, "x") ?? 0,
    y: readNumber(fields, "y") ?? 0,
    width: Math.max(1, readNumber(fields, "width") ?? 320),
    height: Math.max(1, readNumber(fields, "height") ?? 240),
    z: readNumber(fields, "z") ?? 0,
    connectors: connectorsFromMap(fields),
    tags: readIdSet(fields.get("tags")),
    createdAt: readNumber(fields, "createdAt") ?? 0,
    updatedAt: readNumber(fields, "updatedAt") ?? 0,
    ...(color ? { color } : {}),
    ...(style ? { style } : {}),
  });
}

export function placementFromMap(key: string, fields: LoroMap): Placement {
  const [boardId, cardId] = key.split("/");
  const width = readNumber(fields, "width");
  const height = readNumber(fields, "height");
  return placementSchema.parse({
    boardId: readString(fields, "boardId") ?? boardId ?? "",
    cardId: readString(fields, "cardId") ?? cardId ?? "",
    x: readNumber(fields, "x") ?? 0,
    y: readNumber(fields, "y") ?? 0,
    z: readNumber(fields, "z") ?? 0,
    createdAt: readNumber(fields, "createdAt") ?? 0,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  });
}

export function edgeFromMap(id: string, fields: LoroMap): GraphEdge {
  const sourceConnector = readString(fields, "sourceConnector");
  const targetConnector = readString(fields, "targetConnector");
  const label = readString(fields, "label");
  const labelOffset = readNumber(fields, "labelOffset");
  const style = readSurfaceStyle(fields);
  const bends = readBends(fields);
  const layer = fields.get("layer");
  const sourceKind = edgeEndpointKindSchema.safeParse(readString(fields, "sourceKind"));
  const targetKind = edgeEndpointKindSchema.safeParse(readString(fields, "targetKind"));
  return normalizeEdge(
    graphEdgeSchema.parse({
      id,
      boardId: readString(fields, "boardId") ?? "",
      source: readString(fields, "source") ?? "",
      target: readString(fields, "target") ?? "",
      ...(sourceKind.success ? { sourceKind: sourceKind.data } : {}),
      ...(targetKind.success ? { targetKind: targetKind.data } : {}),
      ...(sourceConnector ? { sourceConnector } : {}),
      ...(targetConnector ? { targetConnector } : {}),
      kind: readString(fields, "kind") ?? "references",
      path: readString(fields, "path") ?? "bezier",
      bidirectional: readBoolean(fields, "bidirectional") ?? false,
      ...(label ? { label } : {}),
      ...(typeof labelOffset === "number" ? { labelOffset } : {}),
      ...(bends ? { bends } : {}),
      ...(layer === "above" || layer === "below" ? { layer } : {}),
      ...(style ? { style } : {}),
      createdAt: readNumber(fields, "createdAt") ?? 0,
      updatedAt: readNumber(fields, "updatedAt") ?? 0,
    }),
  );
}

export function sortByLayer(placements: Placement[]): Placement[] {
  return [...placements].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId),
  );
}

/** One element's field map as a validated element; `id` is the map key. */
export function drawingElementFromMap(id: string, fields: LoroMap): DrawingElement {
  const raw: Record<string, unknown> = { id };
  for (const key of fields.keys()) {
    const value = fields.get(key);
    if (value === undefined || isContainer(value)) continue;
    raw[key] = value;
  }
  return drawingElementSchema.parse(raw);
}

/** Writes only the element's own fields; the key already carries its id. */
export function writeDrawingElementFields(fields: LoroMap, element: DrawingElement): void {
  for (const [key, value] of Object.entries(element)) {
    if (key === "id" || value === undefined) continue;
    fields.set(key, value as Value);
  }
}

export function readDrawingVersion(fields: LoroMap): DrawingVersion | undefined {
  const value = fields.get("version");
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

/** Ids in a movable list, ignoring anything a hand-edited doc left behind. */
export function drawingOrderIds(list: unknown): string[] {
  if (!isMovableList(list)) return [];
  return list.toArray().filter((value): value is string => typeof value === "string");
}
