import type { LoroMap } from "loro-crdt";
import { unique } from "remeda";
import { defaultConnectors } from "../connectors.js";
import { CONNECTORS_FIELD } from "../loro/constants.js";
import {
  type Card,
  type Connector,
  cardSchema,
  DEFAULT_TYPE_ID,
  type PropertyValue,
} from "../schema.js";
import { connectorFromMap } from "./entities.js";
import { readStoredValue } from "./propertyValues.js";
import { isMap, readIdSet, readNumber, readString, readSurfaceStyle } from "./values.js";

/**
 * Owns card records: the schema mapper and the normaliser every card read goes through,
 * so a card stored before a field existed still reads as a complete one.
 */

/** Backfills fields added after a document was created. */
export function normalizeCard(card: Card): Card {
  const typeIds = unique(card.typeIds.length > 0 ? card.typeIds : [DEFAULT_TYPE_ID]);
  const primaryTypeId = typeIds.includes(card.primaryTypeId) ? card.primaryTypeId : typeIds[0];
  return {
    ...card,
    typeIds: primaryTypeId
      ? [primaryTypeId, ...typeIds.filter((id) => id !== primaryTypeId)]
      : typeIds,
    primaryTypeId: primaryTypeId ?? DEFAULT_TYPE_ID,
    tags: unique(card.tags),
    connectors:
      Array.isArray(card.connectors) && card.connectors.length > 0
        ? card.connectors
        : [...defaultConnectors()],
    deletedAt: card.deletedAt ?? null,
  };
}

export function cardFromMap(id: string, fields: LoroMap): Card {
  const connectors: Array<{ connector: Connector; order: number }> = [];
  const connectorMap = fields.get(CONNECTORS_FIELD);
  if (isMap(connectorMap)) {
    for (const connectorId of connectorMap.keys()) {
      const connector = connectorMap.get(connectorId);
      if (isMap(connector)) {
        connectors.push({
          connector: connectorFromMap(connectorId, connector),
          order: readNumber(connector, "order") ?? Number.MAX_SAFE_INTEGER,
        });
      }
    }
  }
  connectors.sort(
    (left, right) =>
      left.order - right.order || left.connector.id.localeCompare(right.connector.id),
  );

  const primaryTypeId = readString(fields, "primaryTypeId") ?? DEFAULT_TYPE_ID;
  const typesMap = fields.get("types");
  const rawTypes = isMap(typesMap) ? typesMap.keys() : [];
  const membership = rawTypes.length > 0 ? rawTypes : [primaryTypeId];
  const typeIds = membership.includes(primaryTypeId)
    ? [primaryTypeId, ...membership.filter((id) => id !== primaryTypeId).sort()]
    : [...membership].sort();

  const tags = readIdSet(fields.get("tags"));

  const properties: Record<string, PropertyValue> = {};
  const propertiesMap = fields.get("properties");
  if (isMap(propertiesMap)) {
    for (const fieldId of propertiesMap.keys()) {
      const value = readStoredValue(propertiesMap.get(fieldId));
      if (value !== undefined) properties[fieldId] = value;
    }
  }

  const style = readSurfaceStyle(fields);
  const icon = readString(fields, "icon")?.trim();
  const iconHidden = fields.get("iconHidden");

  return cardSchema.parse({
    id,
    createdAt: readNumber(fields, "createdAt") ?? 0,
    updatedAt: readNumber(fields, "updatedAt") ?? 0,
    connectors: connectors.map((entry) => entry.connector),
    deletedAt: readNumber(fields, "deletedAt") ?? null,
    typeIds,
    primaryTypeId,
    tags,
    properties,
    ...(style ? { style } : {}),
    ...(icon ? { icon } : {}),
    ...(iconHidden === true ? { iconHidden } : {}),
  });
}
