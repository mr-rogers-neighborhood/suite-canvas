import {
  type ContainerID,
  getType,
  isContainer,
  LoroDoc,
  LoroList,
  LoroMap,
  type LoroMovableList,
  LoroText,
  UndoManager,
  type Value,
} from "loro-crdt";
import {
  createConnectorId,
  defaultConnectors,
  nextFreeAnchor,
  snapToAnchor,
} from "../connectors.js";
import {
  type Drawing,
  type DrawingElement,
  type DrawingVersion,
  drawingElementSchema,
  nextDrawingVersion,
  normalizeDrawingOrder,
  sameDrawingValue,
} from "../drawings.js";
import {
  type ApplyLayoutPlanOptions,
  clampLayoutCoordinate,
  LAYOUT_APPLY_ORIGIN,
  type LayoutPlan,
  LayoutPlanError,
  type LayoutPlanSummary,
  layoutPlanIssues,
  MIN_LAYOUT_SECTION_HEIGHT,
  MIN_LAYOUT_SECTION_WIDTH,
  parseLayoutPlan,
} from "../layoutPlan.js";
import { edgeEndpoints, edgeTouches, isSelfLink, type LinkEndpoint, linkKey } from "../links.js";
import { isCalendarDate } from "../property.js";
import { mentionTargets, sameTargets } from "../references.js";
import {
  type Board,
  boardSchema,
  type Card,
  type CardType,
  type Connector,
  cardSchema,
  cardTypeSchema,
  DEFAULT_TYPE_ID,
  type EdgeEndpointKind,
  edgeEndpointKindSchema,
  entityIdSchema,
  type FieldDefinition,
  fieldDefinitionSchema,
  type GraphEdge,
  graphEdgeSchema,
  type Placement,
  type PropertyValue,
  placementSchema,
  type Section,
  type SelectOption,
  sectionSchema,
  selectOptionSchema,
  type Tag,
  tagSchema,
} from "../schema.js";
import { normalizeTemplate } from "../template.js";
import { expandTitleTemplate, hasTitleToken, titleTemplateValues } from "../templateTitle.js";
import type { SavedView, ViewQuery } from "../views.js";
import { savedViewSchema } from "../views.js";

export type WorkspaceSection =
  | "boards"
  | "cards"
  | "placements"
  | "edges"
  | "types"
  | "tags"
  | "sections"
  | "references";
export type WorkspaceAction = "add" | "update" | "delete";
export type LayerAction = "forward" | "front" | "backward" | "back";

export interface WorkspaceChange {
  section: WorkspaceSection;
  action: WorkspaceAction;
  key: string;
  /** `references` changes carry the card's sorted target ids instead of a record. */
  value: Board | Card | Placement | GraphEdge | CardType | Tag | Section | string[] | null;
}

/** Shared text containers for one card, stable until the cards map changes. */
export interface CardContainers {
  contentId: ContainerID | null;
  titleId: ContainerID | null;
}

export interface CreateCardInput {
  id?: string;
  /** Primary type; defaults to the built-in note type. */
  typeId?: string;
  /** Place the card on this board straight away; omit to create it in the inbox. */
  boardId?: string;
  position?: { x: number; y: number };
  /** Preserve an existing connector layout; defaults to a fresh card layout. */
  connectors?: Connector[];
  /**
   * Copy the type's template card, if it has one. Defaults to true, so every
   * ordinary "new card of this type" arrives written. Pass false to build the
   * template itself, or when the caller wants an empty card.
   */
  fromTemplate?: boolean;
}

/**
 * What `WorkspaceDocument.createPortalCard` needs: the board the portal sits on
 * and the board it opens.
 */
export interface CreatePortalCardInput {
  /** Board that holds the portal card. */
  boardId: string;
  /** Board the portal points at; the `board` value stores this id. */
  targetBoardId: string;
  /** Placement on `boardId`; defaults to the top-left corner. */
  position?: { x: number; y: number };
  /**
   * Card size in flow units. A portal opens a real board, so its card is sized
   * to that board's shape when the caller can measure it; omitting this leaves
   * the card at its natural size, exactly like any other card.
   */
  size?: { width: number; height: number };
  id?: string;
}

export interface DuplicateCardOptions {
  /** Board for the copy's placement; omit to create the copy in the inbox. */
  boardId?: string;
  /** Offset from the source card's position on that board; defaults to 24, 24. */
  offset?: { x: number; y: number };
  /**
   * Connector layout for the copy. Omit for a fresh card layout; pass the
   * source's connectors when links will be re-attached to the copy, since a
   * link names its connectors by id.
   */
  connectors?: Connector[];
}

export interface DuplicateBoardOptions {
  /** Name for the new board; defaults to the source's name plus " copy". */
  name?: string;
}

export interface CreateTypeInput {
  id?: string;
  name: string;
  pluralName?: string;
  glyph?: string;
  color?: string;
}

export interface CreateFieldInput {
  name: string;
  kind: FieldDefinition["kind"];
  required?: boolean;
  /** Initial labels for select and multi-select fields. */
  options?: string[];
}

export interface CardFieldView {
  typeId: string;
  field: FieldDefinition;
}

export interface CreateEdgeInput {
  boardId: string;
  source: string;
  target: string;
  /** Defaults to a card, so existing callers keep working unchanged. */
  sourceKind?: EdgeEndpointKind | undefined;
  targetKind?: EdgeEndpointKind | undefined;
  sourceConnector?: string | undefined;
  targetConnector?: string | undefined;
  kind?: GraphEdge["kind"];
}

export interface PlacementMoveInput {
  cardId: string;
  x: number;
  y: number;
}

const placementMoveSchema = placementSchema.pick({ cardId: true, x: true, y: true });

/** Shared empty target list; reference arrays are read-only to callers. */
const NO_REFERENCES: string[] = [];

export interface CreateSectionInput {
  id?: string;
  boardId: string;
  title?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: Section["color"];
  /** Defaults to the same four side midpoints every new card starts with. */
  connectors?: Connector[];
}

/** A saved query, plus where it sits in the Views menu. */
export interface CreateViewInput {
  id?: string;
  name: string;
  /** Defaults to the end of the list. */
  position?: number;
  query: ViewQuery;
}

/** Deterministic id so every client seeds the same default board. */
export const DEFAULT_BOARD_ID = "board-1";
/** The built-in type of a card that stands for another board. */
export const PORTAL_TYPE_ID = "portal";
/** Stable field id for the portal's board value; the UI and seeds rely on it. */
export const PORTAL_BOARD_FIELD_ID = "portal-board";
/** Spatial sections start at version 4. */
export const SCHEMA_VERSION = 4;
/** Shown for a workspace that has never been named and has no board to borrow from. */
export const DEFAULT_WORKSPACE_NAME = "Untitled workspace";
export const WORKSPACE_NAME_MAX_LENGTH = 80;

/**
 * A readable reason the name cannot be used, or `null` when it can. Control
 * characters are refused because the name is a one-line label everywhere it
 * appears (launcher, recovery file names).
 */
export function workspaceNameProblem(name: string): string | null {
  if (/\p{Cc}/u.test(name)) return "A workspace name cannot contain control characters.";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "A workspace name cannot be empty.";
  if (trimmed.length > WORKSPACE_NAME_MAX_LENGTH) {
    return `A workspace name can be at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/** The trimmed name, or a thrown reason when it is not usable. */
export function cleanWorkspaceName(name: string): string {
  const problem = workspaceNameProblem(name);
  if (problem) throw new Error(problem);
  return name.trim();
}

/** Below this gap two ranks are one float step apart; the board renumbers. */
const MIN_RANK_GAP = 1e-7;

export const CONNECTORS_FIELD = "connectors";

/** The ProseMirror node name of an inline property block. */
export const PROPERTY_BLOCK_NODE_NAME = "propertyBlock";

/**
 * Origin of body property-block writes. `text:body` keeps the insertion in the
 * same Loro history as the body editor's own edits, so a mounted editor can
 * undo "Show in body" with Cmd-Z; a `struct:` origin is excluded from the
 * editor's undo stack and would leave an edit that cannot be reverted there.
 */
const BODY_BLOCK_ORIGIN = "text:body";

/** Origin prefixes that keep text/editor history out of the structural undo stack. */
export const TEXT_ORIGIN_PREFIX = "loroSyncPlugin";
export const INIT_ORIGIN = "sys:init";
/**
 * Origin of derived reference-index writes. Excluded from both undo stacks: the
 * index is rebuilt from content, so reverting it would make it lie.
 */
export const INDEX_ORIGIN = "struct:index-refs";
const STRUCT_ORIGIN = "struct:";

export function placementKey(boardId: string, cardId: string): string {
  return `${boardId}/${cardId}`;
}

/** Backfills fields added after a document was created. */
export function normalizeCard(card: Card): Card {
  const typeIds = [...new Set(card.typeIds.length > 0 ? card.typeIds : [DEFAULT_TYPE_ID])];
  const primaryTypeId = typeIds.includes(card.primaryTypeId) ? card.primaryTypeId : typeIds[0];
  return {
    ...card,
    typeIds: primaryTypeId
      ? [primaryTypeId, ...typeIds.filter((id) => id !== primaryTypeId)]
      : typeIds,
    primaryTypeId: primaryTypeId ?? DEFAULT_TYPE_ID,
    tags: [...new Set(card.tags)],
    connectors:
      Array.isArray(card.connectors) && card.connectors.length > 0
        ? card.connectors
        : [...defaultConnectors()],
    deletedAt: card.deletedAt ?? null,
  };
}

function normalizeEdge(edge: GraphEdge): GraphEdge {
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

/** Next explicit order in a map whose entries carry an `order` field. */
function nextOrder(map: LoroMap): number {
  let max = -1;
  for (const key of map.keys()) {
    const entry = map.get(key);
    if (!isMap(entry)) continue;
    max = Math.max(max, readNumber(entry, "order") ?? -1);
  }
  return max + 1;
}

function observeIn(
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

function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

function isMovableList(value: unknown): value is LoroMovableList {
  // `getType`'s conditional return type omits "MovableList", though the runtime
  // reports it; widen to the plain string to compare.
  return isContainer(value) && (getType(value) as string) === "MovableList";
}

function readString(map: LoroMap, key: string): string | undefined {
  const value = map.get(key);
  return typeof value === "string" ? value : undefined;
}

function readNumber(map: LoroMap, key: string): number | undefined {
  const value = map.get(key);
  return typeof value === "number" ? value : undefined;
}

function readBoolean(map: LoroMap, key: string): boolean | undefined {
  const value = map.get(key);
  return typeof value === "boolean" ? value : undefined;
}

/** Sorted ids of a membership map (`id -> true`), so reads are deterministic. */
function readIdSet(value: unknown): string[] {
  return isMap(value) ? value.keys().sort() : [];
}

/** Rewrites a membership map to exactly `ids`, leaving shared keys untouched. */
function writeIdSet(target: LoroMap, ids: readonly string[]): void {
  const wanted = new Set(ids);
  for (const key of [...target.keys()]) {
    if (!wanted.has(key)) target.delete(key);
  }
  for (const id of wanted) target.set(id, true);
}

/**
 * Deep-copies a rich-text container tree into a fresh one. This mirrors the
 * share projection's copy (`projection.ts`): maps become mergeable children so
 * a repeat copy lands on the same container instead of forking it, list items
 * are inserted as new containers to keep their order, and text goes through
 * `toDelta`/`applyDelta` so marks survive.
 */
function copyContainerTree(source: LoroMap, target: LoroMap): void {
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
function copyContainerList(source: LoroList, target: LoroList): void {
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
function copyContainerText(source: LoroText, target: LoroText): void {
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
}

/** Text of a `loro-prosemirror` tree, a text container, or a list of nodes. */
function textOf(value: unknown): string {
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

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

/**
 * The field a property block points at. `loro-prosemirror` stores node attrs on
 * the node's own `attributes` map; reading the node's key as well tolerates
 * hand-built containers.
 */
function propertyBlockFieldId(node: LoroMap): string | undefined {
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
function loroChildren(parent: LoroMap): LoroList {
  const existing = parent.get("children");
  return isList(existing) ? existing : parent.getOrCreateContainer("children", new LoroList());
}

/** Attributes map of a `loro-prosemirror` node, created the same way it does. */
function loroAttributes(node: LoroMap): LoroMap {
  const existing = node.get("attributes");
  return isMap(existing) ? existing : node.getOrCreateContainer("attributes", new LoroMap());
}

/** Field ids of the property blocks in a ProseMirror tree, in document order. */
function propertyBlockFieldIds(root: unknown, out: string[] = []): string[] {
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

function connectorFromMap(id: string, fields: LoroMap): Connector {
  return {
    id,
    x: readNumber(fields, "x") ?? 0,
    y: readNumber(fields, "y") ?? 0,
  };
}

/** A connector map as an ordered array; cards and sections store them alike. */
function connectorsFromMap(fields: LoroMap): Connector[] {
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

  const tagsMap = fields.get("tags");
  const tags = isMap(tagsMap) ? tagsMap.keys().sort() : [];

  const properties: Record<string, PropertyValue> = {};
  const propertiesMap = fields.get("properties");
  if (isMap(propertiesMap)) {
    for (const fieldId of propertiesMap.keys()) {
      const value = propertiesMap.get(fieldId);
      if (isMap(value)) properties[fieldId] = value.keys().sort();
      else if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        properties[fieldId] = value;
      }
    }
  }

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
  });
}

function optionFromMap(id: string, fields: LoroMap): SelectOption {
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

  const display = readString(fields, "display");
  return fieldDefinitionSchema.parse({
    id,
    name: readString(fields, "name") ?? "Field",
    kind: readString(fields, "kind") ?? "text",
    required: readBoolean(fields, "required") ?? false,
    order: readNumber(fields, "order") ?? Number.MAX_SAFE_INTEGER,
    options,
    ...(display ? { display } : {}),
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
    createdAt: readNumber(fields, "createdAt") ?? 0,
    updatedAt: readNumber(fields, "updatedAt") ?? 0,
    ...(color ? { color } : {}),
  });
}

/** Writers validate against the type's own field definition. */
function assertPropertyValue(field: FieldDefinition, value: PropertyValue): void {
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
  }
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
      createdAt: readNumber(fields, "createdAt") ?? 0,
      updatedAt: readNumber(fields, "updatedAt") ?? 0,
    }),
  );
}

function sortByLayer(placements: Placement[]): Placement[] {
  return [...placements].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId),
  );
}

/** One element's field map as a validated element; `id` is the map key. */
function drawingElementFromMap(id: string, fields: LoroMap): DrawingElement {
  const raw: Record<string, unknown> = { id };
  for (const key of fields.keys()) {
    const value = fields.get(key);
    if (value === undefined || isContainer(value)) continue;
    raw[key] = value;
  }
  return drawingElementSchema.parse(raw);
}

/** Writes only the element's own fields; the key already carries its id. */
function writeDrawingElementFields(fields: LoroMap, element: DrawingElement): void {
  for (const [key, value] of Object.entries(element)) {
    if (key === "id" || value === undefined) continue;
    fields.set(key, value as Value);
  }
}

function readDrawingVersion(fields: LoroMap): DrawingVersion | undefined {
  const value = fields.get("version");
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

/** Ids in a movable list, ignoring anything a hand-edited doc left behind. */
function drawingOrderIds(list: unknown): string[] {
  if (!isMovableList(list)) return [];
  return list.toArray().filter((value): value is string => typeof value === "string");
}

export class WorkspaceDocument {
  static readonly BOARDS_KEY = "boards";
  static readonly CARDS_KEY = "cards";
  static readonly PLACEMENTS_KEY = "placements";
  static readonly EDGES_KEY = "edges";
  static readonly TYPES_KEY = "types";
  static readonly TAGS_KEY = "tags";
  static readonly SECTIONS_KEY = "sections";
  static readonly CONTENT_KEY = "content";
  static readonly TITLES_KEY = "titles";
  static readonly REFERENCES_KEY = "references";
  static readonly META_KEY = "meta";
  static readonly VIEWS_KEY = "views";
  static readonly DRAWINGS_KEY = "drawings";

  readonly doc: LoroDoc;
  private readonly boards: LoroMap;
  private readonly cards: LoroMap;
  private readonly placements: LoroMap;
  private readonly edges: LoroMap;
  private readonly types: LoroMap;
  private readonly tags: LoroMap;
  private readonly sections: LoroMap;
  private readonly content: LoroMap;
  private readonly titles: LoroMap;
  private readonly references: LoroMap;
  private readonly meta: LoroMap;
  private readonly viewsMap: LoroMap;
  private readonly drawings: LoroMap;
  private readonly cardCache = new Map<string, Card>();
  private readonly placementCache = new Map<string, Placement>();
  private readonly edgeCache = new Map<string, GraphEdge>();
  private readonly boardCache = new Map<string, Board>();
  private readonly typeCache = new Map<string, CardType>();
  private readonly tagCache = new Map<string, Tag>();
  private readonly sectionCache = new Map<string, Section>();
  private readonly viewCache = new Map<string, SavedView>();
  private readonly referenceCache = new Map<string, string[]>();
  private readonly pendingReferences = new Set<string>();
  private referencesScheduled = false;
  /** Set while `batch()` is open; setter-level commits are skipped. */
  private batchOrigin: string | null = null;
  private readonly undoManager: UndoManager;
  private readonly known: Record<WorkspaceSection, Set<string>>;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  private readonly viewListeners = new Set<() => void>();
  private viewRevision = 0;
  private readonly containerCache = new Map<string, CardContainers>();
  private readonly containerListeners = new Map<string, Set<() => void>>();
  private readonly titleListeners = new Map<string, Set<() => void>>();

  constructor(doc: LoroDoc = new LoroDoc()) {
    this.doc = doc;
    this.boards = doc.getMap(WorkspaceDocument.BOARDS_KEY);
    this.cards = doc.getMap(WorkspaceDocument.CARDS_KEY);
    this.placements = doc.getMap(WorkspaceDocument.PLACEMENTS_KEY);
    this.edges = doc.getMap(WorkspaceDocument.EDGES_KEY);
    this.types = doc.getMap(WorkspaceDocument.TYPES_KEY);
    this.tags = doc.getMap(WorkspaceDocument.TAGS_KEY);
    this.sections = doc.getMap(WorkspaceDocument.SECTIONS_KEY);
    this.content = doc.getMap(WorkspaceDocument.CONTENT_KEY);
    this.titles = doc.getMap(WorkspaceDocument.TITLES_KEY);
    this.references = doc.getMap(WorkspaceDocument.REFERENCES_KEY);
    this.meta = doc.getMap(WorkspaceDocument.META_KEY);
    this.viewsMap = doc.getMap(WorkspaceDocument.VIEWS_KEY);
    this.drawings = doc.getMap(WorkspaceDocument.DRAWINGS_KEY);
    this.known = {
      boards: new Set(this.boards.keys()),
      cards: new Set(this.cards.keys()),
      placements: new Set(this.placements.keys()),
      edges: new Set(this.edges.keys()),
      types: new Set(this.types.keys()),
      tags: new Set(this.tags.keys()),
      sections: new Set(this.sections.keys()),
      references: new Set(this.references.keys()),
    };

    doc.subscribe((batch) => {
      const touched = new Map<WorkspaceSection, Set<string>>();
      const containers = new Set<string>();
      const savedViews = new Set<string>();
      for (const event of batch.events) {
        const root = event.path[0];
        if (typeof root !== "string") continue;
        if (root === WorkspaceDocument.CONTENT_KEY || root === WorkspaceDocument.TITLES_KEY) {
          if (typeof event.path[1] === "string") containers.add(event.path[1]);
          else if (event.diff.type === "map") {
            for (const key of Object.keys(event.diff.updated)) containers.add(key);
          }
          continue;
        }
        if (root === WorkspaceDocument.VIEWS_KEY) {
          if (typeof event.path[1] === "string") savedViews.add(event.path[1]);
          else if (event.diff.type === "map") {
            for (const key of Object.keys(event.diff.updated)) savedViews.add(key);
          }
          continue;
        }
        if (
          root !== WorkspaceDocument.BOARDS_KEY &&
          root !== WorkspaceDocument.CARDS_KEY &&
          root !== WorkspaceDocument.PLACEMENTS_KEY &&
          root !== WorkspaceDocument.EDGES_KEY &&
          root !== WorkspaceDocument.TYPES_KEY &&
          root !== WorkspaceDocument.TAGS_KEY &&
          root !== WorkspaceDocument.SECTIONS_KEY &&
          root !== WorkspaceDocument.REFERENCES_KEY
        ) {
          continue;
        }
        const section = root as WorkspaceSection;
        const keys = touched.get(section) ?? new Set<string>();
        if (typeof event.path[1] === "string") {
          keys.add(event.path[1]);
        } else if (event.diff.type === "map") {
          for (const key of Object.keys(event.diff.updated)) keys.add(key);
        }
        touched.set(section, keys);
      }
      for (const cardId of containers) {
        const before = this.containerCache.get(cardId);
        this.containerCache.delete(cardId);
        const after = this.cardContainers(cardId);
        // Text edits also land here; only a container appearing or disappearing
        // changes what an editor needs to mount.
        if (before && before.contentId === after.contentId && before.titleId === after.titleId) {
          this.containerCache.set(cardId, before);
        } else {
          const listeners = this.containerListeners.get(cardId);
          if (listeners) for (const listener of listeners) listener();
        }
        const titles = this.titleListeners.get(cardId);
        if (titles) for (const listener of titles) listener();
      }
      // Derived index: re-parse every card whose text changed. Our own index
      // writes are skipped so a write cannot schedule another one.
      if (containers.size > 0 && batch.origin !== INDEX_ORIGIN) {
        for (const cardId of containers) this.pendingReferences.add(cardId);
        this.scheduleReferences();
      }
      if (savedViews.size > 0) {
        for (const viewId of savedViews) this.viewCache.delete(viewId);
        this.viewRevision += 1;
        for (const listener of this.viewListeners) listener();
      }
      if (touched.size === 0) return;
      for (const [section, keys] of touched) {
        for (const key of keys) {
          const existed = this.known[section].has(key);
          this.invalidate(section, key);
          const value = this.readSection(section, key);
          if (value === null) this.known[section].delete(key);
          else this.known[section].add(key);
          const change: WorkspaceChange = {
            section,
            action: value === null ? "delete" : existed ? "update" : "add",
            key,
            value,
          };
          for (const listener of this.listeners) listener(change);
        }
      }
    });

    this.undoManager = new UndoManager(doc, {
      mergeInterval: 0,
      maxUndoSteps: 100,
      excludeOriginPrefixes: [TEXT_ORIGIN_PREFIX, INIT_ORIGIN, "text:", INDEX_ORIGIN],
    });
  }

  /**
   * Runs `fn` as one Loro commit with `origin`, deferring every setter's own
   * commit to the end. A publish writes many fields at once and must land as a
   * single event and a single undo step; nested calls join the outer batch.
   */
  batch<T>(origin: string, fn: () => T): T {
    if (this.batchOrigin !== null) return fn();
    this.batchOrigin = origin;
    try {
      return fn();
    } finally {
      this.batchOrigin = null;
      this.doc.commit({ origin });
    }
  }

  private commit(origin = `${STRUCT_ORIGIN}write`): void {
    if (this.batchOrigin !== null) return;
    this.doc.commit({ origin });
  }

  private invalidate(section: WorkspaceSection, key: string): void {
    switch (section) {
      case "boards":
        this.boardCache.delete(key);
        break;
      case "cards":
        this.cardCache.delete(key);
        break;
      case "placements":
        this.placementCache.delete(key);
        break;
      case "edges":
        this.edgeCache.delete(key);
        break;
      case "types":
        this.typeCache.delete(key);
        break;
      case "tags":
        this.tagCache.delete(key);
        break;
      case "sections":
        this.sectionCache.delete(key);
        break;
      case "references":
        this.referenceCache.delete(key);
        break;
    }
  }

  private readSection(section: WorkspaceSection, key: string): WorkspaceChange["value"] {
    switch (section) {
      case "boards":
        return this.getBoard(key) ?? null;
      case "cards":
        return this.getCard(key) ?? null;
      case "placements":
        return this.getPlacementByKey(key) ?? null;
      case "edges":
        return this.getEdge(key) ?? null;
      case "types":
        return this.getType(key) ?? null;
      case "tags":
        return this.getTag(key) ?? null;
      case "sections":
        return this.getSection(key) ?? null;
      case "references": {
        const targets = this.referencesFor(key);
        return targets.length > 0 ? targets : null;
      }
    }
  }
  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /** Each commit is already a separate undo item. */
  stopCapturing(): void {}

  hasSeeded(): boolean {
    return this.meta.get("seeded") === true;
  }

  markSeeded(): void {
    this.meta.set("seeded", true);
    this.commit(`${STRUCT_ORIGIN}seed`);
  }

  // -------------------------------------------------------- workspace name

  /** True when the document stores a name of its own, not a derived fallback. */
  hasWorkspaceName(): boolean {
    const stored = this.meta.get("name");
    return typeof stored === "string" && stored.trim().length > 0;
  }

  /**
   * The workspace's own name. A document from before workspace names existed
   * borrows its first board's name, so it never renders blank; "Untitled
   * workspace" is the last resort.
   */
  workspaceName(): string {
    const stored = this.meta.get("name");
    if (typeof stored === "string") {
      const trimmed = stored.trim();
      if (trimmed.length > 0) return trimmed;
    }
    const first = this.listBoards()[0]?.name.trim();
    return first && first.length > 0 ? first : DEFAULT_WORKSPACE_NAME;
  }

  /** Renames the workspace; a name that fails validation throws its reason. */
  renameWorkspace(name: string): void {
    const trimmed = cleanWorkspaceName(name);
    if (this.meta.get("name") === trimmed) return;
    this.meta.set("name", trimmed);
    this.commit(`${STRUCT_ORIGIN}rename-workspace`);
  }

  // ---------------------------------------------------------------- boards

  private cachedBoard(id: string): Board | undefined {
    const cached = this.boardCache.get(id);
    if (cached) return cached;
    const value = this.boards.get(id);
    if (!isMap(value)) return undefined;
    const color = readString(value, "color");
    const coverAttachmentId = readString(value, "coverAttachmentId");
    const template = value.get("template");
    const board = boardSchema.parse({
      id,
      name: readString(value, "name") ?? "Board",
      createdAt: readNumber(value, "createdAt") ?? 0,
      updatedAt: readNumber(value, "updatedAt") ?? 0,
      // Both have been in the schema since boards became identities; nothing read
      // them back, so a colour write was invisible after the next cache fill.
      ...(color ? { color } : {}),
      ...(coverAttachmentId ? { coverAttachmentId } : {}),
      ...(template === true ? { template } : {}),
    });
    this.boardCache.set(id, board);
    return board;
  }

  listBoards(): Board[] {
    return this.boards
      .keys()
      .map((id) => this.cachedBoard(id))
      .filter((board): board is Board => board !== undefined)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  getBoard(id: string): Board | undefined {
    return this.cachedBoard(id);
  }

  createBoard(input: { id?: string; name?: string } = {}): Board {
    const now = Date.now();
    const board: Board = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name ?? `Board ${this.boards.size + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    const fields = this.boards.ensureMergeableMap(board.id);
    fields.set("name", board.name);
    fields.set("createdAt", board.createdAt);
    fields.set("updatedAt", board.updatedAt);
    this.commit(`${STRUCT_ORIGIN}create-board`);
    return board;
  }

  renameBoard(id: string, name: string): void {
    const board = this.getBoard(id);
    if (!board) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const fields = this.boards.get(id);
    if (!isMap(fields)) return;
    fields.set("name", trimmed);
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}rename-board`);
  }

  /** A board's colour, or null to go back to the default. Boards are identities. */
  setBoardColor(id: string, color: Board["color"] | null): void {
    const fields = this.boards.get(id);
    if (!isMap(fields)) return;
    if (color) fields.set("color", color);
    else fields.delete("color");
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}board-color`);
  }

  /** Whether a board is offered as a template. Never changes what it holds. */
  setBoardTemplate(id: string, template: boolean): void {
    const fields = this.boards.get(id);
    if (!isMap(fields)) return;
    if (template) fields.set("template", true);
    else fields.delete("template");
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}board-template`);
  }

  /** A board's cover image; null returns the portal to its live miniature. */
  setBoardCover(id: string, attachmentId: string | null): void {
    const fields = this.boards.get(id);
    if (!isMap(fields)) return;
    if (attachmentId) fields.set("coverAttachmentId", attachmentId);
    else fields.delete("coverAttachmentId");
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}board-cover`);
  }

  /**
   * Points a portal card at another board, or at none. This is how a portal whose
   * source board is gone is repaired instead of deleted.
   */
  setPortalTarget(cardId: string, boardId: string | null): void {
    const card = this.getCard(cardId);
    if (!card || card.deletedAt) return;
    this.batch(`${STRUCT_ORIGIN}portal-target`, () => {
      this.setProperty(cardId, PORTAL_BOARD_FIELD_ID, boardId ?? null);
    });
  }

  deleteBoard(id: string, options: { cards?: "keep" | "trash" } = {}): void {
    const cardsOption = options.cards ?? "keep";
    // Scoped before the placements go: only cards that were on *this* board are
    // candidates for the trash, and only if they have nowhere else to live.
    const onThisBoard = new Set(this.listBoardCards(id).map((card) => card.id));
    for (const key of [...this.placements.keys()]) {
      const fields = this.placements.get(key);
      if (isMap(fields) && readString(fields, "boardId") === id) this.placements.delete(key);
    }
    for (const edgeId of [...this.edges.keys()]) {
      const fields = this.edges.get(edgeId);
      if (isMap(fields) && readString(fields, "boardId") === id) this.edges.delete(edgeId);
    }
    // Links drawn elsewhere may point at the board itself; they go with it.
    this.deleteLinksTo({ kind: "board", id });
    for (const sectionId of [...this.sections.keys()]) {
      const fields = this.sections.get(sectionId);
      if (isMap(fields) && readString(fields, "boardId") === id) this.sections.delete(sectionId);
    }
    this.boards.delete(id);

    if (cardsOption === "trash") {
      const now = Date.now();
      for (const cardId of onThisBoard) {
        const card = this.getCard(cardId);
        if (!card || card.deletedAt) continue;
        if (this.listCardPlacements(cardId).length > 0) continue;
        this.mutateCard(cardId, (fields) => fields.set("deletedAt", now), false);
      }
    }
    this.commit(`${STRUCT_ORIGIN}delete-board`);
  }

  ensureBoard(): Board {
    const [first] = this.listBoards();
    if (first) return first;
    return this.createBoard({ id: DEFAULT_BOARD_ID, name: "Board 1" });
  }

  /**
   * Copies a board and everything drawn on it: sections, the cards placed
   * there, their placements and the links between them.
   *
   * Cards are workspace objects, so each one is copied once even when it also
   * sits on other boards — only its placement on the new board is added. Links
   * are board-scoped, so an edge comes along only when both ends are reproduced
   * here; a link whose far end lives elsewhere stays behind with the source.
   *
   * Everything lands in one commit, so a single undo removes the whole board.
   */
  duplicateBoard(sourceId: string, options: DuplicateBoardOptions = {}): Board | null {
    const source = this.getBoard(sourceId);
    if (!source) return null;

    const requested = options.name?.trim() ?? "";
    const name = requested.length > 0 ? requested : `${source.name} copy`;
    const now = Date.now();

    return this.batch(`${STRUCT_ORIGIN}duplicate-board`, () => {
      const board = this.createBoard({ name });
      // Connector ids are what links name, so copies keep the source layout
      // and every id is minted here, giving the old→new map edges remap with.
      const cardIds = new Map<string, string>();
      const sectionIds = new Map<string, string>();
      const connectorIds = new Map<string, string>();
      const copyConnectors = (connectors: readonly Connector[]): Connector[] =>
        connectors.map((connector) => {
          const id = createConnectorId();
          connectorIds.set(connector.id, id);
          return { id, x: connector.x, y: connector.y };
        });

      for (const section of this.listSections(sourceId)) {
        const copy = sectionSchema.parse({
          ...section,
          id: crypto.randomUUID(),
          boardId: board.id,
          connectors: copyConnectors(section.connectors ?? []),
          createdAt: now,
          updatedAt: now,
        });
        this.writeSection(copy);
        sectionIds.set(section.id, copy.id);
      }

      for (const placement of this.listBoardPlacements(sourceId)) {
        const card = this.getCard(placement.cardId);
        if (!card || card.deletedAt || cardIds.has(card.id)) continue;
        const copy = this.duplicateCard(card.id, { connectors: copyConnectors(card.connectors) });
        cardIds.set(card.id, copy.id);
        const placed = this.placeCardInternal(board.id, copy.id, {
          x: placement.x,
          y: placement.y,
        });
        if (placed) this.copyPlacementLayout(board.id, copy.id, placement);
      }

      for (const edge of this.listBoardEdges(sourceId)) {
        const ends = edgeEndpoints(edge);
        const sourceEnd = this.remapEndpoint(ends.source, cardIds, sectionIds);
        const targetEnd = this.remapEndpoint(ends.target, cardIds, sectionIds);
        if (!sourceEnd || !targetEnd) continue;
        const sourceConnector = edge.sourceConnector
          ? connectorIds.get(edge.sourceConnector)
          : undefined;
        const targetConnector = edge.targetConnector
          ? connectorIds.get(edge.targetConnector)
          : undefined;
        // A connector that was not copied would leave a dangling attachment.
        if (edge.sourceConnector && !sourceConnector) continue;
        if (edge.targetConnector && !targetConnector) continue;

        const copy = graphEdgeSchema.parse({
          ...edge,
          id: crypto.randomUUID(),
          boardId: board.id,
          source: sourceEnd.id,
          target: targetEnd.id,
          sourceKind: sourceEnd.kind,
          targetKind: targetEnd.kind,
          ...(sourceConnector ? { sourceConnector } : {}),
          ...(targetConnector ? { targetConnector } : {}),
          createdAt: now,
          updatedAt: now,
        });
        this.applyEdge(copy);
        // `applyEdge` persists the label but not its offset, which the copy keeps.
        if (copy.labelOffset !== undefined) {
          const fields = this.edges.get(copy.id);
          if (isMap(fields)) fields.set("labelOffset", copy.labelOffset);
        }
      }

      return board;
    });
  }

  /** A link endpoint on the copied board, or null when it was not reproduced. */
  private remapEndpoint(
    endpoint: LinkEndpoint,
    cardIds: ReadonlyMap<string, string>,
    sectionIds: ReadonlyMap<string, string>,
  ): LinkEndpoint | null {
    if (endpoint.kind === "card") {
      const id = cardIds.get(endpoint.id);
      return id ? { kind: "card", id } : null;
    }
    if (endpoint.kind === "section") {
      const id = sectionIds.get(endpoint.id);
      return id ? { kind: "section", id } : null;
    }
    // Boards are not copied: a board endpoint is drawn through the portal card,
    // which came along, and keeps naming the same board.
    return { kind: "board", id: endpoint.id };
  }

  /** Keeps the copied placement's layer rank and size, computed fresh by `placeCard`. */
  private copyPlacementLayout(boardId: string, cardId: string, source: Placement): void {
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isMap(fields)) return;
    fields.set("z", source.z);
    if (source.width !== undefined) fields.set("width", source.width);
    if (source.height !== undefined) fields.set("height", source.height);
  }

  // ---------------------------------------------------------------- views

  private cachedView(id: string): SavedView | undefined {
    const cached = this.viewCache.get(id);
    if (cached) return cached;
    const fields = this.viewsMap.get(id);
    if (!isMap(fields)) return undefined;
    const query = fields.get("query");
    const text = isMap(query) ? readString(query, "text") : undefined;
    const parsed = savedViewSchema.safeParse({
      id,
      name: readString(fields, "name") ?? "",
      position: readNumber(fields, "position") ?? 0,
      query: {
        ...(text !== undefined ? { text } : {}),
        typeIds: isMap(query) ? readIdSet(query.get("typeIds")) : [],
        tagIds: isMap(query) ? readIdSet(query.get("tagIds")) : [],
        sectionIds: isMap(query) ? readIdSet(query.get("sectionIds")) : [],
        scope: isMap(query) ? query.get("scope") : undefined,
        groupBySection: isMap(query) ? query.get("groupBySection") : undefined,
        order: isMap(query) ? query.get("order") : undefined,
        ...(isMap(query) && query.get("textScope") !== undefined
          ? { textScope: query.get("textScope") }
          : {}),
        ...(isMap(query) && query.get("groupBy") !== undefined
          ? { groupBy: query.get("groupBy") }
          : {}),
        ...(isMap(query) && query.get("groups") !== undefined
          ? { groups: query.get("groups") }
          : {}),
        ...(isMap(query) && query.get("sorts") !== undefined ? { sorts: query.get("sorts") } : {}),
      },
    });
    // A hand-edited or corrupt view is skipped, not thrown on: the rest of the
    // document still opens.
    if (!parsed.success) return undefined;
    this.viewCache.set(id, parsed.data);
    return parsed.data;
  }

  /** Saved views in menu order: position, then id so every client agrees. */
  listViews(): SavedView[] {
    return this.viewsMap
      .keys()
      .map((id) => this.cachedView(id))
      .filter((view): view is SavedView => view !== undefined)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  }

  getView(id: string): SavedView | undefined {
    return this.cachedView(id);
  }

  createView(input: CreateViewInput): SavedView {
    const name = input.name.trim();
    if (!name) throw new Error("A view needs a name");
    const id = input.id ?? crypto.randomUUID();
    if (this.viewsMap.get(id) !== undefined) throw new Error(`View already exists: ${id}`);
    const existing = this.listViews();
    const last = existing.at(-1);
    const view = savedViewSchema.parse({
      id,
      name,
      position: input.position ?? (last ? last.position + 1 : 0),
      query: input.query,
    });
    this.writeView(view);
    this.commit(`${STRUCT_ORIGIN}create-view`);
    return view;
  }

  /**
   * Renames a view and/or replaces its query. The query is a whole record: a
   * view is one saved query, so a facet edit is a new query, not a merge.
   */
  updateView(id: string, patch: { name?: string; query?: ViewQuery }): SavedView | undefined {
    const current = this.getView(id);
    if (!current) return undefined;
    const name = patch.name === undefined ? current.name : patch.name.trim();
    if (!name) throw new Error("A view needs a name");
    const view = savedViewSchema.parse({
      ...current,
      name,
      query: patch.query ?? current.query,
    });
    this.writeView(view);
    this.commit(`${STRUCT_ORIGIN}update-view`);
    return view;
  }

  /** Removes the saved query; no card is touched. */
  deleteView(id: string): void {
    if (this.viewsMap.get(id) === undefined) return;
    this.viewsMap.delete(id);
    this.commit(`${STRUCT_ORIGIN}delete-view`);
  }

  /** Moves a view to `position` in the menu, renumbering the rest in one commit. */
  moveView(id: string, position: number): void {
    if (!Number.isFinite(position)) return;
    const views = this.listViews();
    const from = views.findIndex((view) => view.id === id);
    const moving = views[from];
    if (!moving) return;
    views.splice(from, 1);
    views.splice(Math.max(0, Math.min(Math.trunc(position), views.length)), 0, moving);
    views.forEach((view, index) => {
      if (view.position === index) return;
      const fields = this.viewsMap.get(view.id);
      if (isMap(fields)) fields.set("position", index);
    });
    this.commit(`${STRUCT_ORIGIN}move-view`);
  }

  private writeView(view: SavedView): void {
    const fields = this.viewsMap.ensureMergeableMap(view.id);
    fields.set("name", view.name);
    fields.set("position", view.position);
    const query = fields.ensureMergeableMap("query");
    if (view.query.text === undefined) query.delete("text");
    else query.set("text", view.query.text);
    query.set("scope", view.query.scope);
    query.set("groupBySection", view.query.groupBySection);
    query.set("order", view.query.order);
    writeIdSet(query.ensureMergeableMap("typeIds"), view.query.typeIds);
    writeIdSet(query.ensureMergeableMap("tagIds"), view.query.tagIds);
    writeIdSet(query.ensureMergeableMap("sectionIds"), view.query.sectionIds);
    // v2 fields. A query is replaced whole (`updateView` takes a new record), so
    // the predicate and sort lists travel as JSON values: one last-writer-wins
    // slot is exactly the semantics a saved query has.
    for (const key of ["textScope", "groupBy"] as const) {
      const value = view.query[key];
      if (value === undefined) query.delete(key);
      else query.set(key, value);
    }
    for (const key of ["groups", "sorts"] as const) {
      const value = view.query[key];
      if (value === undefined || value.length === 0) query.delete(key);
      else query.set(key, value);
    }
  }

  /**
   * Saved views live outside `WorkspaceSection` on purpose: they are workspace
   * configuration that no board, card or paragraph mutation touches, so the
   * snapshot stream and every content subscriber stay as they were.
   */
  observeViews(listener: () => void): () => void {
    this.viewListeners.add(listener);
    return () => {
      this.viewListeners.delete(listener);
    };
  }

  /** Monotonic count of views-map changes, the snapshot for `useSyncExternalStore`. */
  get viewsRevision(): number {
    return this.viewRevision;
  }

  // ----------------------------------------------------------------- types

  private cachedType(id: string): CardType | undefined {
    const cached = this.typeCache.get(id);
    if (cached) return cached;
    const value = this.types.get(id);
    if (!isMap(value)) return undefined;
    const type = cardTypeFromMap(id, value);
    this.typeCache.set(id, type);
    return type;
  }

  listTypes(): CardType[] {
    return this.types
      .keys()
      .map((id) => this.cachedType(id))
      .filter((type): type is CardType => type !== undefined)
      .sort(
        (a, b) =>
          Number(b.id === DEFAULT_TYPE_ID) - Number(a.id === DEFAULT_TYPE_ID) ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id),
      );
  }

  getType(id: string): CardType | undefined {
    return this.cachedType(id);
  }

  private writeType(type: CardType, commit: boolean): void {
    const fields = this.types.ensureMergeableMap(type.id);
    fields.set("name", type.name);
    fields.set("glyph", type.glyph);
    if (type.pluralName) fields.set("pluralName", type.pluralName);
    else if (fields.get("pluralName") !== undefined) fields.delete("pluralName");
    if (type.color) fields.set("color", type.color);
    else if (fields.get("color") !== undefined) fields.delete("color");
    if (type.templateCardId) fields.set("templateCardId", type.templateCardId);
    else if (fields.get("templateCardId") !== undefined) fields.delete("templateCardId");
    fields.set("createdAt", type.createdAt);
    fields.set("updatedAt", type.updatedAt);
    fields.ensureMergeableMap("fields");
    if (commit) this.commit(`${STRUCT_ORIGIN}type`);
  }

  createType(input: CreateTypeInput): CardType {
    return this.createTypeInternal(input, true);
  }

  private createTypeInternal(input: CreateTypeInput, commit: boolean): CardType {
    const now = Date.now();
    const type = cardTypeSchema.parse({
      id: input.id ?? crypto.randomUUID(),
      name: input.name.trim() || "Type",
      glyph: input.glyph ?? "\u25c7",
      createdAt: now,
      updatedAt: now,
      fields: [],
      ...(input.color ? { color: input.color } : {}),
      ...(input.pluralName?.trim() ? { pluralName: input.pluralName.trim() } : {}),
    });
    this.writeType(type, commit);
    this.typeCache.set(type.id, type);
    return type;
  }

  updateType(
    id: string,
    patch: {
      name?: string;
      pluralName?: string | null;
      glyph?: string;
      color?: string | null;
      /** `null` clears the template; a card id points at the template card. */
      templateCardId?: string | null;
    },
  ): void {
    const type = this.getType(id);
    if (!type) return;
    const fields = this.types.get(id);
    if (!isMap(fields)) return;
    if (patch.name !== undefined) fields.set("name", patch.name.trim() || type.name);
    if (patch.pluralName !== undefined) {
      const pluralName = patch.pluralName?.trim();
      if (pluralName) fields.set("pluralName", pluralName);
      else if (fields.get("pluralName") !== undefined) fields.delete("pluralName");
    }
    if (patch.glyph !== undefined) fields.set("glyph", patch.glyph || type.glyph);
    if (patch.color !== undefined) {
      if (patch.color) fields.set("color", patch.color);
      else if (fields.get("color") !== undefined) fields.delete("color");
    }
    if (patch.templateCardId !== undefined) {
      const template = patch.templateCardId?.trim();
      // A template must be a live card; clearing it is always allowed.
      if (template && this.getCard(template)) fields.set("templateCardId", template);
      else if (fields.get("templateCardId") !== undefined) fields.delete("templateCardId");
    }
    fields.set("updatedAt", Date.now());
    this.typeCache.delete(id);
    this.commit(`${STRUCT_ORIGIN}type`);
  }

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
    const type = this.getType(id);
    if (!type) return 0;
    const reassignTo = options.reassignTo ?? DEFAULT_TYPE_ID;
    if (reassignTo === id) {
      throw new Error("A type cannot be reassigned to itself");
    }
    if (!this.getType(reassignTo)) {
      throw new Error(`Unknown replacement type: ${reassignTo}`);
    }

    let reassigned = 0;
    for (const cardId of this.cards.keys()) {
      const fields = this.cards.get(cardId);
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

    this.types.delete(id);
    this.commit(`${STRUCT_ORIGIN}delete-type`);
    return reassigned;
  }

  /** Idempotent: the starter types, including the built-in portal, exist in every workspace. */
  ensureDefaultTypes(): void {
    const defaults: CreateTypeInput[] = [
      { id: DEFAULT_TYPE_ID, name: "Note", glyph: "\u25a1" },
      { id: "concept", name: "Concept", glyph: "\u25c6" },
      { id: "source", name: "Source", glyph: "\u25a4" },
    ];
    let changed = false;
    for (const definition of defaults) {
      if (this.getType(definition.id ?? "")) continue;
      this.createTypeInternal(definition, false);
      changed = true;
    }
    if (this.seedPortalType()) changed = true;
    if (this.meta.get("schemaVersion") !== SCHEMA_VERSION) {
      this.meta.set("schemaVersion", SCHEMA_VERSION);
      changed = true;
    }
    if (changed) this.commit(`${STRUCT_ORIGIN}seed`);
  }

  /**
   * Seeds the built-in portal type with its single board field. Idempotent and
   * deliberately shallow: an existing portal type is left exactly as it is,
   * renames included, so a user's edit is never clobbered on load. Writes no
   * commit of its own; the caller commits once for the whole seed.
   */
  private seedPortalType(): boolean {
    if (this.getType(PORTAL_TYPE_ID)) return false;
    this.createTypeInternal(
      {
        id: PORTAL_TYPE_ID,
        name: "Portal",
        pluralName: "Portals",
        glyph: "\u25c9",
      },
      false,
    );
    const fields = this.typeFields(PORTAL_TYPE_ID);
    if (fields) {
      const board = fields.ensureMergeableMap(PORTAL_BOARD_FIELD_ID);
      board.set("name", "Board");
      board.set("kind", "board");
      board.set("required", true);
      board.set("order", 0);
    }
    // `createTypeInternal` cached an empty field list; the new field is already
    // in the document, but the cached type would keep lying until a commit.
    this.typeCache.delete(PORTAL_TYPE_ID);
    return true;
  }

  private typeFields(typeId: string): LoroMap | undefined {
    const type = this.types.get(typeId);
    if (!isMap(type)) return undefined;
    const fields = type.get("fields");
    return isMap(fields) ? fields : undefined;
  }

  private touchType(typeId: string): void {
    const type = this.types.get(typeId);
    if (isMap(type)) type.set("updatedAt", Date.now());
  }

  addField(typeId: string, input: CreateFieldInput): FieldDefinition {
    const fields = this.typeFields(typeId);
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
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
    return fieldFromMap(id, field);
  }

  /** The kind is immutable: deleting and recreating a field is the migration. */
  updateField(
    typeId: string,
    fieldId: string,
    patch: { name?: string; required?: boolean; display?: string | null },
  ): void {
    const field = this.typeFields(typeId)?.get(fieldId);
    if (!isMap(field)) return;
    if (patch.name !== undefined) field.set("name", patch.name.trim() || "Field");
    if (patch.required !== undefined) field.set("required", patch.required);
    if (patch.display !== undefined) {
      const display = normalizeTemplate(patch.display);
      if (display) field.set("display", display);
      else if (field.get("display") !== undefined) field.delete("display");
    }
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
  }

  /**
   * Removes the definition only; card values stay dormant and can be revived.
   * The portal's board field is refused: without it a portal has nothing to
   * point at, and the built-in type is a single-field type by design.
   */
  removeField(typeId: string, fieldId: string): void {
    if (typeId === PORTAL_TYPE_ID && fieldId === PORTAL_BOARD_FIELD_ID) {
      throw new Error("The portal board field cannot be removed");
    }
    const fields = this.typeFields(typeId);
    if (!fields || fields.get(fieldId) === undefined) return;
    fields.delete(fieldId);
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
  }

  moveField(typeId: string, fieldId: string, toIndex: number): void {
    const fields = this.typeFields(typeId);
    const type = this.getType(typeId);
    if (!fields || !type) return;
    const ordered = type.fields.filter((field) => field.id !== fieldId);
    const moved = type.fields.find((field) => field.id === fieldId);
    if (!moved) return;
    ordered.splice(Math.max(0, Math.min(toIndex, ordered.length)), 0, moved);
    ordered.forEach((field, index) => {
      const target = fields.get(field.id);
      if (isMap(target)) target.set("order", index);
    });
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
  }

  addSelectOption(
    typeId: string,
    fieldId: string,
    input: { label: string; color?: string },
  ): SelectOption {
    const options = this.fieldOptions(typeId, fieldId);
    if (!options) throw new Error(`Field ${fieldId} has no options`);
    const id = crypto.randomUUID();
    const option = options.ensureMergeableMap(id);
    option.set("label", input.label.trim() || "Option");
    if (input.color) option.set("color", input.color);
    option.set("order", nextOrder(options));
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
    return optionFromMap(id, option);
  }

  updateSelectOption(
    typeId: string,
    fieldId: string,
    optionId: string,
    patch: { label?: string; color?: string | null },
  ): void {
    const option = this.fieldOptions(typeId, fieldId)?.get(optionId);
    if (!isMap(option)) return;
    if (patch.label !== undefined) option.set("label", patch.label.trim() || "Option");
    if (patch.color !== undefined) {
      if (patch.color) option.set("color", patch.color);
      else if (option.get("color") !== undefined) option.delete("color");
    }
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
  }

  removeSelectOption(typeId: string, fieldId: string, optionId: string): void {
    const options = this.fieldOptions(typeId, fieldId);
    if (!options || options.get(optionId) === undefined) return;
    options.delete(optionId);
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
  }

  private fieldOptions(typeId: string, fieldId: string): LoroMap | undefined {
    const field = this.typeFields(typeId)?.get(fieldId);
    if (!isMap(field)) return undefined;
    const options = field.get("options");
    return isMap(options) ? options : undefined;
  }

  // ------------------------------------------------------------------ tags

  private cachedTag(id: string): Tag | undefined {
    const cached = this.tagCache.get(id);
    if (cached) return cached;
    const value = this.tags.get(id);
    if (!isMap(value)) return undefined;
    const tag = tagFromMap(id, value);
    this.tagCache.set(id, tag);
    return tag;
  }

  listTags(): Tag[] {
    return this.tags
      .keys()
      .map((id) => this.cachedTag(id))
      .filter((tag): tag is Tag => tag !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  getTag(id: string): Tag | undefined {
    return this.cachedTag(id);
  }

  findTagByName(name: string): Tag | undefined {
    const needle = name.trim().toLocaleLowerCase();
    if (!needle) return undefined;
    return this.listTags().find((tag) => tag.name.toLocaleLowerCase() === needle);
  }

  createTag(input: { name: string; color?: string }): Tag {
    const name = input.name.trim();
    if (!name) throw new Error("A tag needs a name");
    if (this.findTagByName(name)) throw new Error(`Tag already exists: ${name}`);
    return this.writeNewTag(name, input.color);
  }

  /** Returns the existing tag when the name matches case-insensitively. */
  ensureTag(name: string): Tag {
    return this.findTagByName(name) ?? this.createTag({ name });
  }

  private writeNewTag(name: string, color?: string): Tag {
    const tag = tagSchema.parse({
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      ...(color ? { color } : {}),
    });
    const fields = this.tags.ensureMergeableMap(tag.id);
    fields.set("name", tag.name);
    fields.set("createdAt", tag.createdAt);
    if (tag.color) fields.set("color", tag.color);
    this.commit(`${STRUCT_ORIGIN}tag`);
    return tag;
  }

  renameTag(id: string, name: string): void {
    const next = name.trim();
    if (!next) throw new Error("A tag needs a name");
    const existing = this.findTagByName(next);
    if (existing && existing.id !== id) throw new Error(`Tag already exists: ${next}`);
    const fields = this.tags.get(id);
    if (!isMap(fields)) return;
    fields.set("name", next);
    this.commit(`${STRUCT_ORIGIN}tag`);
  }

  /** Removes the record; card memberships stay dormant until the tag returns. */
  deleteTag(id: string): void {
    if (this.tags.get(id) === undefined) return;
    this.tags.delete(id);
    this.commit(`${STRUCT_ORIGIN}tag`);
  }

  // -------------------------------------------------------------- sections

  private cachedSection(id: string): Section | undefined {
    const cached = this.sectionCache.get(id);
    if (cached) return cached;
    const value = this.sections.get(id);
    if (!isMap(value)) return undefined;
    const section = sectionFromMap(id, value);
    this.sectionCache.set(id, section);
    return section;
  }

  listSections(boardId?: string): Section[] {
    return this.sections
      .keys()
      .map((id) => this.cachedSection(id))
      .filter((section): section is Section => section !== undefined)
      .filter((section) => boardId === undefined || section.boardId === boardId)
      .sort((a, b) => a.z - b.z || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  getSection(id: string): Section | undefined {
    return this.cachedSection(id);
  }

  createSection(input: CreateSectionInput): Section {
    if (!this.boards.get(input.boardId)) {
      throw new Error(`Unknown board: ${input.boardId}`);
    }
    const now = Date.now();
    const existing = this.listSections(input.boardId);
    const section = sectionSchema.parse({
      id: input.id ?? crypto.randomUUID(),
      boardId: input.boardId,
      title: input.title ?? "",
      x: input.x,
      y: input.y,
      width: Math.max(80, input.width ?? 360),
      height: Math.max(60, input.height ?? 260),
      z: existing.length > 0 ? (existing.at(-1)?.z ?? 0) + 1 : 0,
      connectors: input.connectors ?? defaultConnectors(),
      createdAt: now,
      updatedAt: now,
      ...(input.color ? { color: input.color } : {}),
    });
    this.writeSection(section);
    this.commit(`${STRUCT_ORIGIN}create-section`);
    return section;
  }

  renameSection(id: string, title: string): void {
    const fields = this.sections.get(id);
    if (!isMap(fields)) return;
    fields.set("title", title);
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}rename-section`);
  }

  setSectionColor(id: string, color: Section["color"] | null): void {
    const fields = this.sections.get(id);
    if (!isMap(fields)) return;
    if (color) fields.set("color", color);
    else fields.delete("color");
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}section-color`);
  }

  updateSectionGeometry(id: string, rect: Pick<Section, "x" | "y" | "width" | "height">): void {
    const fields = this.sections.get(id);
    if (!isMap(fields)) return;
    fields.set("x", rect.x);
    fields.set("y", rect.y);
    fields.set("width", Math.max(80, rect.width));
    fields.set("height", Math.max(60, rect.height));
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}resize-section`);
  }

  /**
   * One commit for a section drag: the region, any sections contained by it and
   * every member placement. Members are supplied by the caller from stored
   * geometry so peers and the drag leader agree without extra presence payload.
   */
  moveSectionsBatch(input: {
    sections: {
      id: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
    }[];
    placements?: { boardId: string; cardId: string; x: number; y: number }[];
  }): void {
    const now = Date.now();
    for (const next of input.sections) {
      const fields = this.sections.get(next.id);
      if (!isMap(fields)) continue;
      fields.set("x", next.x);
      fields.set("y", next.y);
      if (next.width !== undefined) fields.set("width", Math.max(80, next.width));
      if (next.height !== undefined) fields.set("height", Math.max(60, next.height));
      fields.set("updatedAt", now);
    }
    for (const next of input.placements ?? []) {
      const fields = this.placements.get(placementKey(next.boardId, next.cardId));
      if (!isMap(fields)) continue;
      fields.set("x", next.x);
      fields.set("y", next.y);
    }
    this.commit(`${STRUCT_ORIGIN}move-section`);
  }

  deleteSection(id: string): void {
    if (this.sections.get(id) === undefined) return;
    this.deleteLinksTo({ kind: "section", id });
    this.sections.delete(id);
    this.commit(`${STRUCT_ORIGIN}delete-section`);
  }

  /** Links pointing at a deleted container go with it; a dangling id is not a link. */
  private deleteLinksTo(endpoint: LinkEndpoint): void {
    for (const edge of this.listLinksTo(endpoint.kind, endpoint.id)) {
      this.edges.delete(edge.id);
    }
  }

  addSectionConnector(sectionId: string, position?: { x: number; y: number }): Connector | null {
    const section = this.getSection(sectionId);
    if (!section) return null;

    const connectors = section.connectors ?? [];
    const anchor = position ?? nextFreeAnchor(connectors);
    const connector: Connector = { id: createConnectorId(), ...anchor };
    const fields = this.sections.get(sectionId);
    if (!isMap(fields)) return null;
    const map = fields.ensureMergeableMap(CONNECTORS_FIELD);
    const entry = map.ensureMergeableMap(connector.id);
    entry.set("x", connector.x);
    entry.set("y", connector.y);
    entry.set("order", connectors.length);
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}add-section-connector`);
    return connector;
  }

  removeSectionConnector(sectionId: string, connectorId: string): void {
    const section = this.getSection(sectionId);
    if (!section) return;

    for (const edge of this.listEdges()) {
      const ends = edgeEndpoints(edge);
      const attached =
        (ends.source.kind === "section" &&
          ends.source.id === sectionId &&
          edge.sourceConnector === connectorId) ||
        (ends.target.kind === "section" &&
          ends.target.id === sectionId &&
          edge.targetConnector === connectorId);
      if (attached) this.edges.delete(edge.id);
    }

    const fields = this.sections.get(sectionId);
    if (!isMap(fields)) return;
    const map = fields.get(CONNECTORS_FIELD);
    if (isMap(map)) map.delete(connectorId);
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}remove-section-connector`);
  }

  moveSectionConnector(
    sectionId: string,
    connectorId: string,
    position: { x: number; y: number },
    options: { snap?: boolean } = {},
  ): void {
    const section = this.getSection(sectionId);
    if (!section) return;
    const fields = this.sections.get(sectionId);
    if (!isMap(fields)) return;
    const map = fields.get(CONNECTORS_FIELD);
    if (!isMap(map)) return;
    const entry = map.get(connectorId);
    if (!isMap(entry)) return;

    const next = options.snap ? snapToAnchor(position) : position;
    entry.set("x", next.x);
    entry.set("y", next.y);
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}move-section-connector`);
  }

  private writeSection(section: Section): void {
    const fields = this.sections.ensureMergeableMap(section.id);
    fields.set("boardId", section.boardId);
    fields.set("title", section.title);
    fields.set("x", section.x);
    fields.set("y", section.y);
    fields.set("width", section.width);
    fields.set("height", section.height);
    fields.set("z", section.z);
    fields.set("createdAt", section.createdAt);
    fields.set("updatedAt", section.updatedAt);
    if (section.color) fields.set("color", section.color);
    this.writeSectionConnectors(fields, section.connectors ?? []);
  }

  private writeSectionConnectors(fields: LoroMap, connectors: readonly Connector[]): void {
    const map = fields.ensureMergeableMap(CONNECTORS_FIELD);
    const keep = new Set(connectors.map((connector) => connector.id));
    for (const id of [...map.keys()]) {
      if (!keep.has(id)) map.delete(id);
    }
    connectors.forEach((connector, order) => {
      const entry = map.ensureMergeableMap(connector.id);
      entry.set("x", connector.x);
      entry.set("y", connector.y);
      entry.set("order", order);
    });
  }

  // ----------------------------------------------------------------- cards

  private cachedCard(id: string): Card | undefined {
    const cached = this.cardCache.get(id);
    if (cached) return cached;
    const value = this.cards.get(id);
    if (!isMap(value)) return undefined;
    const card = cardFromMap(id, value);
    this.cardCache.set(id, card);
    return card;
  }

  listCards(): Card[] {
    return this.cards
      .keys()
      .map((id) => this.cachedCard(id))
      .filter((card): card is Card => card !== undefined);
  }

  getCard(id: string): Card | undefined {
    return this.cachedCard(id);
  }

  /** Full write. Prefer the field-level operations below for concurrent edits. */
  setCard(card: Card): void {
    const parsed = cardSchema.parse(normalizeCard(card));
    this.applyCard(parsed);
    this.commit(`${STRUCT_ORIGIN}set-card`);
  }

  private applyCard(card: Card): void {
    const fields = this.cards.ensureMergeableMap(card.id);
    fields.set("createdAt", card.createdAt);
    fields.set("updatedAt", card.updatedAt);
    fields.set("deletedAt", card.deletedAt ?? null);
    fields.set("primaryTypeId", card.primaryTypeId);

    const types = fields.ensureMergeableMap("types");
    const wantedTypes = new Set(card.typeIds);
    for (const typeId of types.keys()) {
      if (!wantedTypes.has(typeId)) types.delete(typeId);
    }
    for (const typeId of card.typeIds) {
      if (!types.get(typeId)) types.set(typeId, true);
    }

    const tags = fields.ensureMergeableMap("tags");
    const wantedTags = new Set(card.tags);
    for (const tagId of tags.keys()) {
      if (!wantedTags.has(tagId)) tags.delete(tagId);
    }
    for (const tagId of card.tags) {
      if (!tags.get(tagId)) tags.set(tagId, true);
    }

    const properties = fields.ensureMergeableMap("properties");
    const wantedProperties = new Set(Object.keys(card.properties));
    for (const fieldId of properties.keys()) {
      if (!wantedProperties.has(fieldId)) properties.delete(fieldId);
    }
    for (const [fieldId, value] of Object.entries(card.properties)) {
      if (Array.isArray(value)) {
        const selected = properties.ensureMergeableMap(fieldId);
        const wanted = new Set(value);
        for (const optionId of selected.keys()) {
          if (!wanted.has(optionId)) selected.delete(optionId);
        }
        for (const optionId of value) {
          if (!selected.get(optionId)) selected.set(optionId, true);
        }
      } else {
        properties.set(fieldId, value);
      }
    }

    const connectors = fields.ensureMergeableMap(CONNECTORS_FIELD);
    const wanted = new Set(card.connectors.map((connector) => connector.id));
    card.connectors.forEach((connector, order) => {
      const connectorFields = connectors.ensureMergeableMap(connector.id);
      connectorFields.set("x", connector.x);
      connectorFields.set("y", connector.y);
      connectorFields.set("order", order);
    });
    for (const connectorId of [...connectors.keys()]) {
      if (!wanted.has(connectorId)) connectors.delete(connectorId);
    }

    // Legacy card shapes wrote a closed kind and an empty data bag.
    if (fields.get("kind") !== undefined) fields.delete("kind");
    if (fields.get("data") !== undefined) fields.delete("data");
  }

  private mutateCard(cardId: string, mutate: (fields: LoroMap) => void, commit = true): void {
    const fields = this.cards.get(cardId);
    if (!isMap(fields)) return;
    mutate(fields);
    fields.set("updatedAt", Date.now());
    if (commit) this.commit(`${STRUCT_ORIGIN}card`);
  }

  private connectorFields(cardId: string, connectorId: string): LoroMap | undefined {
    const cardFields = this.cards.get(cardId);
    if (!isMap(cardFields)) return undefined;
    const connectors = cardFields.get(CONNECTORS_FIELD);
    if (!isMap(connectors)) return undefined;
    const fields = connectors.get(connectorId);
    return isMap(fields) ? fields : undefined;
  }

  createCard(input: CreateCardInput = {}): Card {
    const now = Date.now();
    const typeId = input.typeId ?? DEFAULT_TYPE_ID;
    const template = input.fromTemplate === false ? undefined : this.liveTemplateCard(typeId);
    const card = cardSchema.parse({
      id: input.id ?? crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      connectors: input.connectors ?? template?.connectors ?? defaultConnectors(),
      deletedAt: null,
      typeIds: template ? [...template.typeIds] : [typeId],
      primaryTypeId: typeId,
      tags: template ? [...template.tags] : [],
      properties: template ? structuredClone(template.properties) : {},
    });

    this.applyCard(card);
    const content = this.content.ensureMergeableMap(card.id);
    const title = this.titles.ensureMergeableMap(card.id);
    if (template) {
      const sourceContent = this.peekContent(template.id);
      const sourceTitle = this.peekTitle(template.id);
      if (sourceContent) copyContainerTree(sourceContent, content);
      if (sourceTitle) copyContainerTree(sourceTitle, title);
      this.expandCopiedTitle(card, title);
    }
    if (input.boardId) {
      this.placeCardInternal(input.boardId, card.id, input.position ?? { x: 0, y: 0 });
    }
    this.commit(`${STRUCT_ORIGIN}create-card`);
    return card;
  }

  /**
   * The type's template card, if it names one that still exists and is not in
   * the trash. A missing or trashed template is "no template", never an error:
   * a card the user deleted must not break creating cards of that type.
   */
  templateCard(typeId: string): Card | undefined {
    return this.liveTemplateCard(typeId);
  }

  private liveTemplateCard(typeId: string): Card | undefined {
    const templateId = this.getType(typeId)?.templateCardId;
    if (!templateId) return undefined;
    const template = this.getCard(templateId);
    return template && !template.deletedAt ? template : undefined;
  }

  /**
   * A copied title is rich text, so mentions and formatting already travel.
   * `{{Field}}` tokens are filled once, here, and only for a plain title: a
   * formatted or mentioned title is left exactly as the template wrote it.
   */
  private expandCopiedTitle(card: Card, title: LoroMap): void {
    const children = title.get("children");
    if (!isList(children) || children.length !== 1) return;
    const only = children.get(0);
    if (!isText(only)) return;
    const text: string = only.toString();
    if (!hasTitleToken(text)) return;
    const expanded = expandTitleTemplate(text, titleTemplateValues(card, this.listTypes()));
    if (expanded === text) return;
    only.delete(0, only.length);
    if (expanded.length > 0) only.insert(0, expanded);
  }

  /**
   * Creates a portal: a card of the built-in portal type whose board field
   * points at `targetBoardId`, placed on `boardId`.
   *
   * `createCard` and `setProperty` each commit on their own, so the two writes
   * are wrapped in one batch: the portal lands as a single commit and is never
   * observable without its target board.
   */
  createPortalCard(input: CreatePortalCardInput): Card {
    if (!this.getBoard(input.targetBoardId)) {
      throw new Error(`Unknown board: ${input.targetBoardId}`);
    }
    if (!this.getBoard(input.boardId)) {
      throw new Error(`Unknown board: ${input.boardId}`);
    }
    const id = input.id ?? crypto.randomUUID();
    this.batch(`${STRUCT_ORIGIN}create-portal`, () => {
      // A document that has not been seeded yet still gets a usable portal.
      this.seedPortalType();
      this.createCard({
        id,
        typeId: PORTAL_TYPE_ID,
        boardId: input.boardId,
        position: input.position ?? { x: 0, y: 0 },
      });
      this.setProperty(id, PORTAL_BOARD_FIELD_ID, input.targetBoardId);
      if (input.size) {
        this.updatePlacementGeometry(input.boardId, id, {
          ...(input.position ?? { x: 0, y: 0 }),
          width: input.size.width,
          height: input.size.height,
        });
      }
    });
    const card = this.getCard(id);
    if (!card) throw new Error(`Unknown card: ${id}`);
    return card;
  }

  /**
   * Copies a card into a new object with a fresh id. Type, tags, properties and
   * the title/body rich-text trees come along — the containers are deep-copied,
   * marks included — while the original's placements stay behind because they
   * are per-board chrome, not card content. Connectors start fresh unless the
   * caller supplies a layout, which board duplication does so links keep their
   * attachment points. The copy can land on a board, offset from where the
   * source sits there.
   */
  duplicateCard(cardId: string, options: DuplicateCardOptions = {}): Card {
    const source = this.getCard(cardId);
    if (!source) throw new Error(`Unknown card: ${cardId}`);
    if (source.deletedAt) throw new Error(`Cannot duplicate a trashed card: ${cardId}`);
    if (options.boardId && !this.getBoard(options.boardId)) {
      throw new Error(`Unknown board: ${options.boardId}`);
    }

    const now = Date.now();
    // `cardSchema.parse` rebuilds every array and record, so the copy shares no
    // mutable structure with the source.
    const card = cardSchema.parse({
      ...source,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      connectors: options.connectors ?? defaultConnectors(),
    });

    return this.batch(`${STRUCT_ORIGIN}duplicate-card`, () => {
      this.applyCard(card);
      const content = this.content.ensureMergeableMap(card.id);
      const title = this.titles.ensureMergeableMap(card.id);
      const sourceContent = this.peekContent(cardId);
      const sourceTitle = this.peekTitle(cardId);
      if (sourceContent) copyContainerTree(sourceContent, content);
      if (sourceTitle) copyContainerTree(sourceTitle, title);

      const boardId = options.boardId;
      if (boardId) {
        // Offset from the source on the target board, else from its home board.
        const origin = this.getPlacement(boardId, cardId) ?? this.listCardPlacements(cardId)[0];
        const offset = options.offset ?? { x: 24, y: 24 };
        this.placeCardInternal(boardId, card.id, {
          x: (origin?.x ?? 0) + offset.x,
          y: (origin?.y ?? 0) + offset.y,
        });
      }
      return card;
    });
  }

  /**
   * Moves a card onto another board by rewriting placements only: the card keeps
   * its identity, title, body, tags and properties, and every placement it held
   * on another board is removed. Without a position it keeps the coordinates it
   * had there (or on its home board).
   *
   * Links are board-scoped and never deleted here. An edge whose other endpoint
   * only lives on the old board goes dormant — `listBoardEdges` stops returning
   * it while the endpoint is elsewhere — and revives when that card returns,
   * exactly like the trash rule. Deleting it instead would lose a link the user
   * can still restore by moving the card back.
   */
  moveCardToBoard(cardId: string, boardId: string, position?: { x: number; y: number }): Placement {
    if (!this.getCard(cardId)) throw new Error(`Unknown card: ${cardId}`);
    if (!this.getBoard(boardId)) throw new Error(`Unknown board: ${boardId}`);

    const existing = this.getPlacement(boardId, cardId);
    const home = this.listCardPlacements(cardId)[0];
    const target = position ?? {
      x: existing?.x ?? home?.x ?? 0,
      y: existing?.y ?? home?.y ?? 0,
    };
    const others = this.listCardPlacements(cardId).filter(
      (placement) => placement.boardId !== boardId,
    );
    const moved =
      others.length > 0 || !existing || existing.x !== target.x || existing.y !== target.y;
    if (!moved) return existing;

    for (const placement of others) {
      this.placements.delete(placementKey(placement.boardId, placement.cardId));
    }
    const placed = this.placeCardInternal(boardId, cardId, target);
    if (!placed) throw new Error(`Cannot place card ${cardId} on board ${boardId}`);
    this.commit(`${STRUCT_ORIGIN}move-card-to-board`);
    return placed;
  }

  isTrashed(cardId: string): boolean {
    return Boolean(this.getCard(cardId)?.deletedAt);
  }

  trashCard(id: string): void {
    const card = this.getCard(id);
    if (!card || card.deletedAt) return;
    this.mutateCard(id, (fields) => fields.set("deletedAt", Date.now()));
  }

  restoreCard(id: string): void {
    const card = this.getCard(id);
    if (!card?.deletedAt) return;
    this.mutateCard(id, (fields) => fields.set("deletedAt", null));
  }

  purgeCard(id: string): void {
    const placements = this.listCardPlacements(id);
    const edges = this.listEdges().filter((edge) => edge.source === id || edge.target === id);
    this.cards.delete(id);
    for (const placement of placements) {
      this.placements.delete(placementKey(placement.boardId, placement.cardId));
    }
    for (const edge of edges) this.edges.delete(edge.id);
    this.content.delete(id);
    this.titles.delete(id);
    this.drawings.delete(id);
    // The card's own outgoing refs are derived from content that is gone;
    // other cards keep their dangling ids on purpose.
    this.references.delete(id);
    this.commit(`${STRUCT_ORIGIN}purge-card`);
  }

  emptyTrash(): void {
    for (const card of this.listCards()) {
      if (card.deletedAt) this.purgeCard(card.id);
    }
  }

  /** Existing body container, or null. Reads never create shared state. */
  peekContent(cardId: string): LoroMap | null {
    const value = this.content.get(cardId);
    return isMap(value) ? value : null;
  }

  /** Existing title container, or null. Reads never create shared state. */
  peekTitle(cardId: string): LoroMap | null {
    const value = this.titles.get(cardId);
    return isMap(value) ? value : null;
  }

  /** Creates the body container if it is missing. Only writers should call this. */
  getContent(cardId: string): LoroMap {
    const existing = this.peekContent(cardId);
    if (existing) return existing;
    const created = this.content.ensureMergeableMap(cardId);
    this.commit(`${STRUCT_ORIGIN}create-content`);
    return created;
  }

  /** Creates the title container if it is missing. Only writers should call this. */
  getTitle(cardId: string): LoroMap {
    const existing = this.peekTitle(cardId);
    if (existing) return existing;
    const created = this.titles.ensureMergeableMap(cardId);
    this.commit(`${STRUCT_ORIGIN}create-title`);
    return created;
  }

  /** Stable container ids for the editor bindings. */
  contentId(cardId: string): ContainerID | null {
    return this.peekContent(cardId)?.id ?? null;
  }

  titleId(cardId: string): ContainerID | null {
    return this.peekTitle(cardId)?.id ?? null;
  }

  /**
   * True when a title container exists for this id, even if it only holds a
   * reference stub. Inside a projection that means "referenced but not shared",
   * as opposed to `peekTitle` returning null for a card that is truly gone.
   */
  hasTitle(cardId: string): boolean {
    return this.peekTitle(cardId) !== null;
  }

  /**
   * Both text container ids for a card, in one identity-stable object. Editors
   * need this to adopt containers created by a peer after they mounted.
   */
  cardContainers(cardId: string): CardContainers {
    const cached = this.containerCache.get(cardId);
    if (cached) return cached;
    const next: CardContainers = {
      contentId: this.contentId(cardId),
      titleId: this.titleId(cardId),
    };
    this.containerCache.set(cardId, next);
    return next;
  }

  /** Fires when either text container for one card appears or disappears. */
  observeContainers(cardId: string, listener: () => void): () => void {
    return observeIn(this.containerListeners, cardId, listener);
  }

  /** Fires when the card's title (or the body it falls back to) changes. */
  observeTitle(cardId: string, listener: () => void): () => void {
    return observeIn(this.titleListeners, cardId, listener);
  }

  /** Title text, falling back to the body's first line, then "Untitled". */
  displayTitle(cardId: string): string {
    const title = firstLine(textOf(this.peekTitle(cardId)));
    if (title) return title;
    const body = firstLine(textOf(this.peekContent(cardId)));
    return body || "Untitled";
  }

  // ----------------------------------------------------------- references

  /**
   * Outgoing reference ids for a card, sorted. Identity-stable until the set
   * changes; callers must not mutate the returned array.
   */
  referencesFor(cardId: string): string[] {
    const cached = this.referenceCache.get(cardId);
    if (cached) return cached;
    const value = this.references.get(cardId);
    const targets = isMap(value) ? value.keys().sort() : NO_REFERENCES;
    this.referenceCache.set(cardId, targets);
    return targets;
  }

  /** The derived index in the shape the snapshot consumes. */
  listReferences(): Record<string, string[]> {
    const index: Record<string, string[]> = {};
    for (const cardId of this.references.keys()) {
      const targets = this.referencesFor(cardId);
      if (targets.length > 0) index[cardId] = targets;
    }
    return index;
  }

  /** Plain text of a card's body, for backlink snippets. Never indexed. */
  cardText(cardId: string): string {
    return textOf(this.peekContent(cardId));
  }

  // ------------------------------------------------- property blocks in body

  /**
   * Field ids that already have a property block in the body, in document
   * order. Drives the panel's Show/Remove toggle; never stored separately.
   */
  bodyPropertyBlocks(cardId: string): string[] {
    const content = this.peekContent(cardId);
    return content ? propertyBlockFieldIds(content) : [];
  }

  /**
   * Appends a `propertyBlock` view to the end of the card's body, followed by
   * an empty paragraph so typing can continue. Idempotent per field, and a
   * no-op for a card or field that does not exist: the block is only a view,
   * so pointing it at a missing field would render nothing useful.
   */
  appendPropertyBlock(cardId: string, fieldId: string): boolean {
    const card = this.getCard(cardId);
    if (!card) return false;
    if (!this.fieldForCard(card, fieldId)) return false;
    if (this.bodyPropertyBlocks(cardId).includes(fieldId)) return false;

    const content = this.getContent(cardId);
    if (content.get("nodeName") == null) content.set("nodeName", "doc");
    const paragraph = this.appendBodyNode(content, "paragraph");
    const block = this.appendBodyNode(paragraph, PROPERTY_BLOCK_NODE_NAME);
    loroAttributes(block).set("fieldId", fieldId);
    this.appendBodyNode(content, "paragraph");
    this.doc.commit({ origin: BODY_BLOCK_ORIGIN });
    return true;
  }

  /**
   * Drops the block for one field and the paragraph that held it, since the
   * block was that paragraph's whole content. The property value itself is
   * untouched: deleting a view never deletes the value. Idempotent.
   */
  removePropertyBlock(cardId: string, fieldId: string): boolean {
    const content = this.peekContent(cardId);
    if (!content) return false;
    const blocks = content.get("children");
    if (!isList(blocks)) return false;

    const blockNodes = blocks.toArray();
    let removed = false;
    for (let index = blockNodes.length - 1; index >= 0; index -= 1) {
      const paragraph = blockNodes[index];
      if (!isMap(paragraph)) continue;
      const inline = paragraph.get("children");
      if (!isList(inline)) continue;

      const inlineNodes = inline.toArray();
      let removedHere = false;
      for (let position = inlineNodes.length - 1; position >= 0; position -= 1) {
        const node = inlineNodes[position];
        if (!isMap(node) || node.get("nodeName") !== PROPERTY_BLOCK_NODE_NAME) continue;
        if (propertyBlockFieldId(node) !== fieldId) continue;
        inline.delete(position, 1);
        removedHere = true;
        removed = true;
      }
      if (removedHere && inline.length === 0) blocks.delete(index, 1);
    }
    if (!removed) return false;
    // A body must keep one block so the ProseMirror document stays valid.
    if (blocks.length === 0) this.appendBodyNode(content, "paragraph");
    this.doc.commit({ origin: BODY_BLOCK_ORIGIN });
    return true;
  }

  /** Appends one `loro-prosemirror` node (and its containers) to a parent. */
  private appendBodyNode(parent: LoroMap, nodeName: string): LoroMap {
    const children = loroChildren(parent);
    const node = children.insertContainer(children.length, new LoroMap());
    node.set("nodeName", nodeName);
    loroAttributes(node);
    loroChildren(node);
    return node;
  }

  /** What the card's title and body mention right now, ignoring the index. */
  private contentTargets(cardId: string): string[] {
    return mentionTargets([this.peekTitle(cardId), this.peekContent(cardId)]);
  }

  private storedTargets(cardId: string): string[] {
    const value = this.references.get(cardId);
    return isMap(value) ? value.keys() : NO_REFERENCES;
  }

  /**
   * Repairs entries whose stored set disagrees with their content. Idempotent:
   * a second call writes nothing. Safe to run on every client after the first
   * sync, which is what makes the index converge without coordination.
   */
  ensureReferences(): number {
    const changed: Array<[string, string[]]> = [];
    for (const card of this.listCards()) {
      const targets = this.contentTargets(card.id);
      if (!sameTargets(this.storedTargets(card.id), targets)) changed.push([card.id, targets]);
    }
    if (changed.length === 0) return 0;
    this.writeReferences(changed);
    return changed.length;
  }

  /** Rewrites every card's entry and drops entries for cards that are gone. */
  rebuildReferences(): number {
    const entries = this.listCards().map(
      (card) => [card.id, this.contentTargets(card.id)] as [string, string[]],
    );
    const wanted = new Set(entries.map(([cardId]) => cardId));
    const stale = this.references.keys().filter((cardId) => !wanted.has(cardId));
    this.writeReferences(entries, stale);
    return entries.length;
  }

  /** One commit for any number of cards, so the index is never half-written. */
  private writeReferences(entries: Array<[string, string[]]>, remove: string[] = []): void {
    for (const cardId of remove) {
      if (this.references.get(cardId) !== undefined) this.references.delete(cardId);
    }
    for (const [cardId, targets] of entries) {
      if (targets.length === 0) {
        if (this.references.get(cardId) !== undefined) this.references.delete(cardId);
        continue;
      }
      const map = this.references.ensureMergeableMap(cardId);
      const wanted = new Set(targets);
      for (const key of map.keys()) {
        if (!wanted.has(key)) map.delete(key);
      }
      for (const key of targets) {
        if (!map.get(key)) map.set(key, true);
      }
    }
    this.doc.commit({ origin: INDEX_ORIGIN });
  }

  /** Coalesces a burst of text edits into one re-parse per card. */
  private scheduleReferences(): void {
    if (this.referencesScheduled) return;
    this.referencesScheduled = true;
    queueMicrotask(() => {
      this.referencesScheduled = false;
      const pending = [...this.pendingReferences];
      this.pendingReferences.clear();
      const changed: Array<[string, string[]]> = [];
      for (const cardId of pending) {
        if (!this.getCard(cardId)) continue;
        const targets = this.contentTargets(cardId);
        if (!sameTargets(this.storedTargets(cardId), targets)) changed.push([cardId, targets]);
      }
      if (changed.length > 0) this.writeReferences(changed);
    });
  }

  private cardMemberships(
    cardId: string,
    key: "types" | "tags" | "properties",
  ): LoroMap | undefined {
    const fields = this.cards.get(cardId);
    if (!isMap(fields)) return undefined;
    const memberships = fields.get(key);
    return isMap(memberships) ? memberships : undefined;
  }

  /**
   * Replaces the whole type membership. The primary type is kept when it is
   * still a member, otherwise the first remaining type becomes primary.
   */
  setCardTypes(cardId: string, typeIds: string[], primaryTypeId?: string): void {
    const unique = [...new Set(typeIds)];
    if (unique.length === 0) {
      throw new Error("A card needs at least one type");
    }
    const primary = primaryTypeId && unique.includes(primaryTypeId) ? primaryTypeId : unique[0];
    if (!primary) return;
    this.mutateCard(cardId, (fields) => {
      fields.set("primaryTypeId", primary);
      const memberships = fields.ensureMergeableMap("types");
      const wanted = new Set(unique);
      for (const typeId of memberships.keys()) {
        if (!wanted.has(typeId)) memberships.delete(typeId);
      }
      for (const typeId of unique) {
        if (!memberships.get(typeId)) memberships.set(typeId, true);
      }
    });
  }

  addCardType(cardId: string, typeId: string): void {
    const card = this.getCard(cardId);
    if (!card || card.typeIds.includes(typeId)) return;
    this.mutateCard(cardId, (fields) => {
      const memberships = fields.ensureMergeableMap("types");
      if (!memberships.get(typeId)) memberships.set(typeId, true);
      if (!readString(fields, "primaryTypeId")) fields.set("primaryTypeId", typeId);
    });
  }

  /** Removing the last type falls back to the built-in note type. */
  removeCardType(cardId: string, typeId: string): void {
    const card = this.getCard(cardId);
    if (!card?.typeIds.includes(typeId)) return;
    const remaining = card.typeIds.filter((id) => id !== typeId);
    const next = remaining.length > 0 ? remaining : [DEFAULT_TYPE_ID];
    const primary = card.primaryTypeId === typeId ? next[0] : card.primaryTypeId;
    if (!primary) return;
    this.setCardTypes(cardId, next, primary);
  }

  setPrimaryType(cardId: string, typeId: string): void {
    const card = this.getCard(cardId);
    if (!card) return;
    const typeIds = card.typeIds.includes(typeId) ? card.typeIds : [typeId, ...card.typeIds];
    this.setCardTypes(cardId, typeIds, typeId);
  }

  addCardTag(cardId: string, tagId: string): void {
    const card = this.getCard(cardId);
    if (!card || card.tags.includes(tagId)) return;
    this.mutateCard(cardId, (fields) => {
      const memberships = fields.ensureMergeableMap("tags");
      if (!memberships.get(tagId)) memberships.set(tagId, true);
    });
  }

  removeCardTag(cardId: string, tagId: string): void {
    const memberships = this.cardMemberships(cardId, "tags");
    if (!memberships?.get(tagId)) return;
    this.mutateCard(cardId, (fields) => {
      const tags = fields.ensureMergeableMap("tags");
      if (tags.get(tagId)) tags.delete(tagId);
    });
  }

  /** Fields of the card's types, primary first, then each type's own order. */
  viewCardFields(card: Card): CardFieldView[] {
    const views: CardFieldView[] = [];
    const seen = new Set<string>();
    for (const typeId of card.typeIds) {
      const type = this.getType(typeId);
      if (!type) continue;
      for (const field of type.fields) {
        if (seen.has(field.id)) continue;
        seen.add(field.id);
        views.push({ typeId, field });
      }
    }
    return views;
  }

  private fieldForCard(card: Card, fieldId: string): FieldDefinition | undefined {
    for (const typeId of card.typeIds) {
      const field = this.getType(typeId)?.fields.find((entry) => entry.id === fieldId);
      if (field) return field;
    }
    return undefined;
  }

  /**
   * Writes one property value. `null` clears the key, the same as
   * `clearProperty`, so a picker can commit either gesture with one call.
   */
  setProperty(cardId: string, fieldId: string, value: PropertyValue | null): void {
    const card = this.getCard(cardId);
    if (!card) throw new Error(`Unknown card: ${cardId}`);
    const field = this.fieldForCard(card, fieldId);
    if (!field) throw new Error(`Unknown field on this card: ${fieldId}`);
    if (value === null) {
      this.clearProperty(cardId, fieldId);
      return;
    }
    if (field.kind === "card" && value === cardId) {
      throw new Error(`Field "${field.name}" cannot point at its own card`);
    }
    assertPropertyValue(field, value);
    this.mutateCard(cardId, (fields) => {
      const properties = fields.ensureMergeableMap("properties");
      if (Array.isArray(value)) {
        const selected = properties.ensureMergeableMap(fieldId);
        const wanted = new Set(value);
        for (const optionId of selected.keys()) {
          if (!wanted.has(optionId)) selected.delete(optionId);
        }
        for (const optionId of value) {
          if (!selected.get(optionId)) selected.set(optionId, true);
        }
      } else {
        properties.set(fieldId, value);
      }
    });
  }

  /** Clears the displayed value; the property key disappears from the card. */
  clearProperty(cardId: string, fieldId: string): void {
    const properties = this.cardMemberships(cardId, "properties");
    if (!properties?.get(fieldId)) return;
    this.mutateCard(cardId, (fields) => {
      const map = fields.ensureMergeableMap("properties");
      if (map.get(fieldId) !== undefined) map.delete(fieldId);
    });
  }

  listCardsOfType(typeId: string): Card[] {
    if (!this.getType(typeId)) return [];
    return this.listCards().filter((card) => !card.deletedAt && card.typeIds.includes(typeId));
  }

  listCardsWithTag(tagId: string): Card[] {
    if (!this.getTag(tagId)) return [];
    return this.listCards().filter((card) => !card.deletedAt && card.tags.includes(tagId));
  }

  // ------------------------------------------------------------ placements

  private cachedPlacement(key: string): Placement | undefined {
    const cached = this.placementCache.get(key);
    if (cached) return cached;
    const value = this.placements.get(key);
    if (!isMap(value)) return undefined;
    const placement = placementFromMap(key, value);
    this.placementCache.set(key, placement);
    return placement;
  }

  listPlacements(): Placement[] {
    return this.placements
      .keys()
      .map((key) => this.cachedPlacement(key))
      .filter((placement): placement is Placement => placement !== undefined);
  }

  getPlacementByKey(key: string): Placement | undefined {
    return this.cachedPlacement(key);
  }

  listCardPlacements(cardId: string): Placement[] {
    return this.listPlacements()
      .filter((placement) => placement.cardId === cardId)
      .sort((a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId));
  }

  getPlacement(boardId: string, cardId: string): Placement | undefined {
    return this.cachedPlacement(placementKey(boardId, cardId));
  }

  homeBoardId(cardId: string): string | null {
    return this.listCardPlacements(cardId)[0]?.boardId ?? null;
  }

  listBoardPlacements(boardId: string): Placement[] {
    return sortByLayer(this.listPlacements().filter((placement) => placement.boardId === boardId));
  }

  listBoardCards(boardId: string): Card[] {
    return this.listBoardPlacements(boardId).flatMap((placement) => {
      const card = this.getCard(placement.cardId);
      return card && !card.deletedAt ? [card] : [];
    });
  }

  listInboxCards(): Card[] {
    return this.listCards()
      .filter((card) => !card.deletedAt && this.listCardPlacements(card.id).length === 0)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  listTrashedCards(): Card[] {
    return this.listCards()
      .filter((card) => Boolean(card.deletedAt))
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || a.id.localeCompare(b.id));
  }

  private nextPlacementTime(): number {
    const latest = this.listPlacements().reduce(
      (max, placement) => Math.max(max, placement.createdAt),
      0,
    );
    return Math.max(Date.now(), latest + 1);
  }

  private placeCardInternal(
    boardId: string,
    cardId: string,
    position: { x: number; y: number },
  ): Placement | null {
    if (!this.cards.get(cardId) || !this.boards.get(boardId)) return null;

    const existing = this.getPlacement(boardId, cardId);
    if (existing) {
      const fields = this.placements.get(placementKey(boardId, cardId));
      if (isMap(fields)) {
        fields.set("x", position.x);
        fields.set("y", position.y);
      }
      return { ...existing, ...position };
    }

    const placements = this.listBoardPlacements(boardId);
    const top = placements.length > 0 ? (placements.at(-1)?.z ?? 0) + 1 : 0;
    const placement: Placement = {
      boardId,
      cardId,
      x: position.x,
      y: position.y,
      z: top,
      createdAt: this.nextPlacementTime(),
    };
    const fields = this.placements.ensureMergeableMap(placementKey(boardId, cardId));
    fields.set("boardId", boardId);
    fields.set("cardId", cardId);
    fields.set("x", placement.x);
    fields.set("y", placement.y);
    fields.set("z", placement.z);
    fields.set("createdAt", placement.createdAt);
    return placement;
  }

  placeCard(boardId: string, cardId: string, position: { x: number; y: number }): Placement | null {
    const placement = this.placeCardInternal(boardId, cardId, position);
    if (placement) this.commit(`${STRUCT_ORIGIN}place-card`);
    return placement;
  }

  unplaceCard(boardId: string, cardId: string): void {
    this.placements.delete(placementKey(boardId, cardId));
    this.commit(`${STRUCT_ORIGIN}unplace-card`);
  }

  updatePlacementPosition(
    boardId: string,
    cardId: string,
    position: { x: number; y: number },
  ): void {
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isMap(fields)) return;
    fields.set("x", position.x);
    fields.set("y", position.y);
    this.commit(`${STRUCT_ORIGIN}move-card`);
  }

  /**
   * One commit for a multi-card drag, mirroring `moveSectionsBatch`: only `x`/`y`
   * are written, unknown placements and moves that change nothing are skipped,
   * and a batch with no effective change produces no commit (so no empty undo
   * step). The result does not depend on the order of `moves`.
   */
  movePlacements(boardId: string, moves: PlacementMoveInput[]): void {
    let changed = false;
    for (const move of moves) {
      const parsed = placementMoveSchema.safeParse(move);
      if (!parsed.success) continue;
      const fields = this.placements.get(placementKey(boardId, parsed.data.cardId));
      if (!isMap(fields)) continue;
      if (readNumber(fields, "x") === parsed.data.x && readNumber(fields, "y") === parsed.data.y) {
        continue;
      }
      fields.set("x", parsed.data.x);
      fields.set("y", parsed.data.y);
      changed = true;
    }
    if (changed) this.commit(`${STRUCT_ORIGIN}move-cards`);
  }

  updatePlacementSize(
    boardId: string,
    cardId: string,
    size: { width: number; height: number },
  ): void {
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isMap(fields)) return;
    fields.set("width", size.width);
    fields.set("height", size.height);
    this.commit(`${STRUCT_ORIGIN}resize-card`);
  }

  /** Commits position and size together so a corner drag is one undo step. */
  updatePlacementGeometry(
    boardId: string,
    cardId: string,
    geometry: { x: number; y: number; width: number; height: number },
  ): void {
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isMap(fields)) return;
    fields.set("x", geometry.x);
    fields.set("y", geometry.y);
    fields.set("width", geometry.width);
    fields.set("height", geometry.height);
    this.commit(`${STRUCT_ORIGIN}resize-card`);
  }

  /**
   * Applies a one-shot layout plan: positions, sizes and section geometry, all
   * in one batch so the whole command is a single undo step. The plan is
   * validated up front; nothing is written when it has issues or would not
   * change anything, and only changed fields are set.
   */
  applyLayoutPlan(plan: LayoutPlan, options: ApplyLayoutPlanOptions = {}): LayoutPlanSummary {
    const parsed = parseLayoutPlan(plan);
    const issues = layoutPlanIssues(parsed, {
      hasBoard: (id) => this.boards.get(id) !== undefined,
      hasCard: (id) => this.cards.get(id) !== undefined,
      hasSection: (id) => this.sections.get(id) !== undefined,
      placedBoards: (cardId) => this.listCardPlacements(cardId).map((entry) => entry.boardId),
    });
    if (issues.length > 0) throw new LayoutPlanError(issues);

    interface StagedPlacement {
      boardId: string;
      cardId: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }

    const staged = new Map<string, StagedPlacement>();
    const stage = (boardId: string, cardId: string): StagedPlacement => {
      const key = placementKey(boardId, cardId);
      const existing = staged.get(key);
      if (existing) return existing;
      const created: StagedPlacement = { boardId, cardId };
      staged.set(key, created);
      return created;
    };

    for (const placement of parsed.placements) {
      const next = stage(placement.boardId, placement.cardId);
      next.x = clampLayoutCoordinate(placement.x);
      next.y = clampLayoutCoordinate(placement.y);
      if (placement.width !== undefined) next.width = placement.width;
      if (placement.height !== undefined) next.height = placement.height;
    }
    // A portal size is a placement size too; explicit placement geometry wins.
    for (const [cardId, size] of Object.entries(parsed.portalSizes ?? {})) {
      const boardIds = new Set<string>();
      for (const placement of parsed.placements) {
        if (placement.cardId === cardId) boardIds.add(placement.boardId);
      }
      if (boardIds.size === 0) {
        for (const placement of this.listCardPlacements(cardId)) boardIds.add(placement.boardId);
      }
      for (const boardId of boardIds) {
        const next = stage(boardId, cardId);
        next.width ??= size.width;
        next.height ??= size.height;
      }
    }

    interface PlacementChange {
      boardId: string;
      cardId: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      create: boolean;
    }

    const placementChanges: PlacementChange[] = [];
    const boards = new Set<string>();
    for (const next of staged.values()) {
      const current = this.getPlacement(next.boardId, next.cardId);
      if (!current) {
        if (next.x === undefined || next.y === undefined) continue;
        const created: PlacementChange = {
          boardId: next.boardId,
          cardId: next.cardId,
          x: next.x,
          y: next.y,
          create: true,
        };
        if (next.width !== undefined) created.width = next.width;
        if (next.height !== undefined) created.height = next.height;
        placementChanges.push(created);
        boards.add(next.boardId);
        continue;
      }
      const change: PlacementChange = {
        boardId: next.boardId,
        cardId: next.cardId,
        create: false,
      };
      let changed = false;
      if (next.x !== undefined && next.x !== current.x) {
        change.x = next.x;
        changed = true;
      }
      if (next.y !== undefined && next.y !== current.y) {
        change.y = next.y;
        changed = true;
      }
      if (next.width !== undefined && next.width !== current.width) {
        change.width = next.width;
        changed = true;
      }
      if (next.height !== undefined && next.height !== current.height) {
        change.height = next.height;
        changed = true;
      }
      if (!changed) continue;
      placementChanges.push(change);
      boards.add(next.boardId);
    }

    interface SectionChange {
      id: string;
      boardId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }

    const sectionChanges: SectionChange[] = [];
    for (const section of parsed.sections ?? []) {
      const current = this.getSection(section.sectionId);
      if (!current) continue;
      const x = clampLayoutCoordinate(section.x);
      const y = clampLayoutCoordinate(section.y);
      const width = Math.max(MIN_LAYOUT_SECTION_WIDTH, section.width);
      const height = Math.max(MIN_LAYOUT_SECTION_HEIGHT, section.height);
      if (
        current.x === x &&
        current.y === y &&
        current.width === width &&
        current.height === height
      ) {
        continue;
      }
      sectionChanges.push({ id: current.id, boardId: current.boardId, x, y, width, height });
      boards.add(current.boardId);
    }

    if (placementChanges.length === 0 && sectionChanges.length === 0) {
      return { placements: 0, sections: 0, boards: 0 };
    }

    this.batch(options.origin ?? LAYOUT_APPLY_ORIGIN, () => {
      for (const change of placementChanges) {
        if (change.create) {
          this.placeCardInternal(change.boardId, change.cardId, {
            x: change.x ?? 0,
            y: change.y ?? 0,
          });
        }
        const fields = this.placements.get(placementKey(change.boardId, change.cardId));
        if (!isMap(fields)) continue;
        if (!change.create) {
          if (change.x !== undefined) fields.set("x", change.x);
          if (change.y !== undefined) fields.set("y", change.y);
        }
        if (change.width !== undefined) fields.set("width", change.width);
        if (change.height !== undefined) fields.set("height", change.height);
      }
      const now = Date.now();
      for (const change of sectionChanges) {
        const fields = this.sections.get(change.id);
        if (!isMap(fields)) continue;
        fields.set("x", change.x);
        fields.set("y", change.y);
        fields.set("width", change.width);
        fields.set("height", change.height);
        fields.set("updatedAt", now);
      }
    });

    return {
      placements: placementChanges.length,
      sections: sectionChanges.length,
      boards: boards.size,
    };
  }

  moveLayer(boardId: string, cardId: string, action: LayerAction): void {
    const ordered = this.listBoardPlacements(boardId);
    const index = ordered.findIndex((placement) => placement.cardId === cardId);
    const placement = ordered[index];
    if (!placement) return;

    const rest = ordered.filter((entry) => entry.cardId !== cardId);
    const target =
      action === "front"
        ? rest.length
        : action === "back"
          ? 0
          : action === "forward"
            ? Math.min(rest.length, index + 1)
            : Math.max(0, index - 1);
    if (target === index) return;

    const below = rest[target - 1]?.z;
    const above = rest[target]?.z;
    const rank = this.rankBetween(below, above);
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isMap(fields)) return;

    const tooTight = below !== undefined && above !== undefined && above - below < MIN_RANK_GAP;
    if (!tooTight) {
      fields.set("z", rank);
      this.commit(`${STRUCT_ORIGIN}layer`);
      return;
    }

    const next = [...rest];
    next.splice(target, 0, placement);
    next.forEach((entry, layer) => {
      const entryFields = this.placements.get(placementKey(boardId, entry.cardId));
      if (!isMap(entryFields) || entry.z === layer) return;
      entryFields.set("z", layer);
    });
    this.commit(`${STRUCT_ORIGIN}layer-renumber`);
  }

  private rankBetween(below: number | undefined, above: number | undefined): number {
    if (below === undefined && above === undefined) return 0;
    if (below === undefined) return (above ?? 0) - 1;
    if (above === undefined) return below + 1;
    return below + (above - below) / 2;
  }

  // ----------------------------------------------------------------- edges

  private cachedEdge(id: string): GraphEdge | undefined {
    const cached = this.edgeCache.get(id);
    if (cached) return cached;
    const value = this.edges.get(id);
    if (!isMap(value)) return undefined;
    const edge = edgeFromMap(id, value);
    this.edgeCache.set(id, edge);
    return edge;
  }

  listEdges(): GraphEdge[] {
    return this.edges
      .keys()
      .map((id) => this.cachedEdge(id))
      .filter((edge): edge is GraphEdge => edge !== undefined);
  }

  private mutateEdge(edgeId: string, mutate: (fields: LoroMap) => void): void {
    const fields = this.edges.get(edgeId);
    if (!isMap(fields)) return;
    mutate(fields);
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}edge`);
  }

  listBoardEdges(boardId: string): GraphEdge[] {
    const placed = new Map(this.listBoardCards(boardId).map((card) => [card.id, card]));
    const sections = new Map(this.listSections(boardId).map((section) => [section.id, section]));
    const portals = this.portalsByTargetBoard(placed);
    return this.listEdges().filter(
      (edge) =>
        edge.boardId === boardId &&
        this.endpointIsDrawn(edgeEndpoints(edge).source, edge.sourceConnector, {
          placed,
          sections,
          portals,
        }) &&
        this.endpointIsDrawn(edgeEndpoints(edge).target, edge.targetConnector, {
          placed,
          sections,
          portals,
        }),
    );
  }

  /**
   * On this board, the first portal card per target board. A board endpoint has
   * no position of its own, so it is drawn between portal instances: no portal
   * on this board means no line, though the link survives in the document.
   */
  private portalsByTargetBoard(placed: Map<string, Card>): Map<string, Card> {
    const portals = new Map<string, Card>();
    for (const card of placed.values()) {
      if (card.primaryTypeId !== PORTAL_TYPE_ID) continue;
      const target = card.properties[PORTAL_BOARD_FIELD_ID];
      if (typeof target !== "string" || target.length === 0) continue;
      if (!portals.has(target)) portals.set(target, card);
    }
    return portals;
  }

  private endpointIsDrawn(
    endpoint: LinkEndpoint,
    connectorId: string | undefined,
    context: {
      placed: Map<string, Card>;
      sections: Map<string, Section>;
      portals: Map<string, Card>;
    },
  ): boolean {
    switch (endpoint.kind) {
      case "card": {
        const card = context.placed.get(endpoint.id);
        if (!card) return false;
        if (!connectorId) return true;
        return card.connectors.some((connector) => connector.id === connectorId);
      }
      case "section": {
        const section = context.sections.get(endpoint.id);
        if (!section) return false;
        if (!connectorId) return true;
        return (section.connectors ?? []).some((connector) => connector.id === connectorId);
      }
      case "board":
        return context.portals.has(endpoint.id);
      default:
        return false;
    }
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.cachedEdge(id);
  }

  setEdge(edge: GraphEdge): void {
    const parsed = graphEdgeSchema.parse(normalizeEdge(edge));
    this.applyEdge(parsed);
    this.commit(`${STRUCT_ORIGIN}set-edge`);
  }

  private applyEdge(edge: GraphEdge): void {
    const fields = this.edges.ensureMergeableMap(edge.id);
    fields.set("boardId", edge.boardId);
    fields.set("source", edge.source);
    fields.set("target", edge.target);
    if (edge.sourceKind) fields.set("sourceKind", edge.sourceKind);
    else fields.delete("sourceKind");
    if (edge.targetKind) fields.set("targetKind", edge.targetKind);
    else fields.delete("targetKind");
    fields.set("kind", edge.kind);
    fields.set("path", edge.path);
    fields.set("bidirectional", edge.bidirectional);
    fields.set("createdAt", edge.createdAt);
    fields.set("updatedAt", edge.updatedAt);
    if (edge.sourceConnector) fields.set("sourceConnector", edge.sourceConnector);
    else fields.delete("sourceConnector");
    if (edge.targetConnector) fields.set("targetConnector", edge.targetConnector);
    else fields.delete("targetConnector");
    if (edge.label) fields.set("label", edge.label);
    else fields.delete("label");
  }

  addEdge(input: CreateEdgeInput): GraphEdge | null {
    const sourceKind = input.sourceKind ?? "card";
    const targetKind = input.targetKind ?? "card";
    const source = { kind: sourceKind, id: input.source };
    const target = { kind: targetKind, id: input.target };
    if (
      isSelfLink(source, target, {
        source: input.sourceConnector,
        target: input.targetConnector,
      })
    ) {
      return null;
    }
    if (!this.endpointExists(source) || !this.endpointExists(target)) return null;

    const now = Date.now();
    const edge: GraphEdge = graphEdgeSchema.parse({
      id: crypto.randomUUID(),
      boardId: input.boardId,
      source: input.source,
      target: input.target,
      sourceKind,
      targetKind,
      kind: input.kind ?? "references",
      path: "bezier",
      bidirectional: false,
      createdAt: now,
      updatedAt: now,
      ...(input.sourceConnector ? { sourceConnector: input.sourceConnector } : {}),
      ...(input.targetConnector ? { targetConnector: input.targetConnector } : {}),
    });
    if (this.isDuplicateEdge(edge)) return null;
    this.applyEdge(edge);
    this.commit(`${STRUCT_ORIGIN}add-edge`);
    return edge;
  }

  /** A link may only point at a thing that exists in this workspace. */
  private endpointExists(endpoint: LinkEndpoint): boolean {
    switch (endpoint.kind) {
      case "card":
        return this.getCard(endpoint.id) !== undefined;
      case "board":
        return this.boards.get(endpoint.id) !== undefined;
      case "section":
        return this.sections.get(endpoint.id) !== undefined;
      default:
        return false;
    }
  }

  /**
   * Two links between the same endpoints on the same connectors are the same
   * connection; drawing it twice is a no-op rather than a second record.
   */
  private isDuplicateEdge(candidate: GraphEdge): boolean {
    const key = linkKey(candidate);
    return this.listEdges().some((edge) => edge.id !== candidate.id && linkKey(edge) === key);
  }

  /** Every link with this thing at either end, including links to containers. */
  listLinksTo(kind: EdgeEndpointKind, id: string): GraphEdge[] {
    const endpoint = { kind, id };
    return this.listEdges().filter((edge) => edgeTouches(edge, endpoint));
  }

  setEdgeEndpointKind(id: string, end: "source" | "target", kind: EdgeEndpointKind): void {
    if (!this.getEdge(id)) return;
    this.mutateEdge(id, (fields) =>
      fields.set(end === "source" ? "sourceKind" : "targetKind", kind),
    );
  }

  removeEdge(id: string): void {
    this.edges.delete(id);
    this.commit(`${STRUCT_ORIGIN}remove-edge`);
  }

  setEdgePath(id: string, path: GraphEdge["path"]): void {
    if (!this.getEdge(id)) return;
    this.mutateEdge(id, (fields) => fields.set("path", path));
  }

  reconnectEdge(
    id: string,
    end: "source" | "target",
    cardId: string,
    connectorId: string | undefined,
    kind: EdgeEndpointKind = "card",
  ): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    const ends = edgeEndpoints(edge);
    const next = { kind, id: cardId };
    const otherEnd = end === "source" ? ends.target : ends.source;
    // The connector at the other end is what decides whether this closes a loop
    // or collapses onto one dot.
    const otherConnector = end === "source" ? edge.targetConnector : edge.sourceConnector;
    if (isSelfLink(next, otherEnd, { source: connectorId, target: otherConnector })) return;
    if (!this.endpointExists(next)) return;

    const fields = { id: cardId };
    if (end === "source") {
      const candidate = {
        ...edge,
        source: fields.id,
        sourceKind: kind,
        sourceConnector: connectorId,
      };
      if (this.isDuplicateEdge(candidate)) return;
      this.mutateEdge(id, (entry) => {
        entry.set("source", fields.id);
        entry.set("sourceKind", kind);
        if (connectorId) entry.set("sourceConnector", connectorId);
        else entry.delete("sourceConnector");
      });
    } else {
      const candidate = {
        ...edge,
        target: fields.id,
        targetKind: kind,
        targetConnector: connectorId,
      };
      if (this.isDuplicateEdge(candidate)) return;
      this.mutateEdge(id, (entry) => {
        entry.set("target", fields.id);
        entry.set("targetKind", kind);
        if (connectorId) entry.set("targetConnector", connectorId);
        else entry.delete("targetConnector");
      });
    }
  }

  reverseEdge(id: string): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    // Swapping ids alone would leave each id paired with the other end's kind,
    // so a card-to-section link reversed would claim a card id is a section.
    const ends = edgeEndpoints(edge);
    this.mutateEdge(id, (fields) => {
      fields.set("source", edge.target);
      fields.set("target", edge.source);
      fields.set("sourceKind", ends.target.kind);
      fields.set("targetKind", ends.source.kind);
      if (edge.sourceConnector) fields.set("targetConnector", edge.sourceConnector);
      else fields.delete("targetConnector");
      if (edge.targetConnector) fields.set("sourceConnector", edge.targetConnector);
      else fields.delete("sourceConnector");
    });
  }

  /** Free-text description of a drawn link; empty clears it. */
  setEdgeLabel(id: string, label: string | null): void {
    const edge = this.getEdge(id);
    if (!edge) return;
    const next = label?.trim() ?? "";
    if ((edge.label ?? "") === next) return;
    this.mutateEdge(id, (fields) => {
      if (next.length > 0) fields.set("label", next);
      else fields.delete("label");
    });
  }

  /**
   * Places the label along its path. `null` restores the midpoint; the value is
   * clamped, so a drag that overshoots the ends still lands on the link.
   */
  setEdgeLabelOffset(id: string, offset: number | null): void {
    const edge = this.getEdge(id);
    if (!edge) return;
    if (offset === null) {
      if (edge.labelOffset === undefined) return;
      this.mutateEdge(id, (fields) => {
        if (fields.get("labelOffset") !== undefined) fields.delete("labelOffset");
      });
      return;
    }
    const clamped = Math.min(1, Math.max(0, Number.isFinite(offset) ? offset : 0.5));
    if (edge.labelOffset !== undefined && Math.abs(edge.labelOffset - clamped) < 0.001) return;
    this.mutateEdge(id, (fields) => fields.set("labelOffset", clamped));
  }

  setEdgeBidirectional(id: string, bidirectional: boolean): void {
    if (!this.getEdge(id)) return;
    this.mutateEdge(id, (fields) => fields.set("bidirectional", bidirectional));
  }

  // ------------------------------------------------------------ connectors

  addConnector(cardId: string, position?: { x: number; y: number }): Connector | null {
    const card = this.getCard(cardId);
    if (!card) return null;

    const anchor = position ?? nextFreeAnchor(card.connectors);
    const connector: Connector = { id: createConnectorId(), ...anchor };
    const order = card.connectors.length;
    this.mutateCard(cardId, (fields) => {
      const connectors = fields.ensureMergeableMap(CONNECTORS_FIELD);
      const connectorFields = connectors.ensureMergeableMap(connector.id);
      connectorFields.set("x", connector.x);
      connectorFields.set("y", connector.y);
      connectorFields.set("order", order);
    });
    return connector;
  }

  removeConnector(cardId: string, connectorId: string): void {
    if (!this.getCard(cardId)) return;
    const attached = this.listEdges().filter(
      (edge) =>
        (edge.source === cardId && edge.sourceConnector === connectorId) ||
        (edge.target === cardId && edge.targetConnector === connectorId),
    );
    this.mutateCard(
      cardId,
      (fields) => {
        const connectors = fields.get(CONNECTORS_FIELD);
        if (isMap(connectors)) connectors.delete(connectorId);
      },
      false,
    );
    for (const edge of attached) this.edges.delete(edge.id);
    this.commit(`${STRUCT_ORIGIN}remove-connector`);
  }

  moveConnector(
    cardId: string,
    connectorId: string,
    position: { x: number; y: number },
    options: { snap?: boolean } = {},
  ): void {
    const card = this.getCard(cardId);
    if (!card) return;

    const next = options.snap ? snapToAnchor(position) : position;
    const fields = this.connectorFields(cardId, connectorId);
    if (!fields) return;
    fields.set("x", next.x);
    fields.set("y", next.y);
    const cardFields = this.cards.get(cardId);
    if (isMap(cardFields)) cardFields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}move-connector`);
  }

  // -------------------------------------------------------------- drawings

  /**
   * One card's scene, or null when the card has no drawing entry. Tombstoned
   * elements are filtered out; `order` is the live paint order, bottom-first.
   */
  drawing(cardId: string): Drawing | null {
    const fields = this.drawingEntry(cardId);
    if (!fields) return null;
    const byId = this.liveDrawingElements(fields);
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
  }

  private drawingEntry(cardId: string): LoroMap | undefined {
    const value = this.drawings.get(cardId);
    return isMap(value) ? value : undefined;
  }

  private drawingEntryForWrite(cardId: string): LoroMap {
    return this.drawingEntry(cardId) ?? this.drawings.ensureMergeableMap(cardId);
  }

  /** Live elements of one drawing keyed by id; tombstones are skipped. */
  private liveDrawingElements(fields: LoroMap): Map<string, DrawingElement> {
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
  }

  /** Marks a drawing as written: one timestamp and one version bump per call. */
  private touchDrawing(fields: LoroMap, now: number): void {
    fields.set("updatedAt", now);
    fields.set("version", nextDrawingVersion(readDrawingVersion(fields)));
  }

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
    const fields = this.drawingEntryForWrite(id);
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
    this.touchDrawing(fields, Date.now());
    this.commit(`${STRUCT_ORIGIN}set-drawing`);

    const drawing = this.drawing(id);
    if (!drawing) throw new Error(`Drawing was not written: ${id}`);
    return drawing;
  }

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

    const fields = this.drawingEntryForWrite(id);
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

    if (!changed) return this.drawing(id);
    this.touchDrawing(fields, now);
    this.commit(`${STRUCT_ORIGIN}apply-drawing`);
    return this.drawing(id);
  }

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

    const fields = this.drawingEntryForWrite(id);
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

    this.touchDrawing(fields, Date.now());
    this.commit(`${STRUCT_ORIGIN}drawing-element`);
    return drawingElementFromMap(parsed.id, target);
  }

  /** Tombstones an element and takes it out of the paint order. */
  removeDrawingElement(cardId: string, elementId: string): void {
    const id = entityIdSchema.parse(cardId);
    const targetId = entityIdSchema.parse(elementId);
    const fields = this.drawingEntry(id);
    if (!fields) return;
    const elements = fields.get("elements");
    const target = isMap(elements) ? elements.get(targetId) : undefined;
    if (!isMap(target)) return;

    let changed = false;
    if (target.get("deletedAt") === undefined) {
      target.set("deletedAt", Date.now());
      changed = true;
    }
    if (this.dropFromDrawingOrder(fields, targetId)) changed = true;
    if (!changed) return;

    this.touchDrawing(fields, Date.now());
    this.commit(`${STRUCT_ORIGIN}remove-drawing-element`);
  }

  /** Removes a tombstone for good; a live element is removed outright. */
  purgeDrawingElement(cardId: string, elementId: string): void {
    const id = entityIdSchema.parse(cardId);
    const targetId = entityIdSchema.parse(elementId);
    const fields = this.drawingEntry(id);
    if (!fields) return;

    let changed = false;
    const elements = fields.get("elements");
    if (isMap(elements) && elements.get(targetId) !== undefined) {
      elements.delete(targetId);
      changed = true;
    }
    if (this.dropFromDrawingOrder(fields, targetId)) changed = true;
    if (!changed) return;

    this.touchDrawing(fields, Date.now());
    this.commit(`${STRUCT_ORIGIN}purge-drawing-element`);
  }

  /** Removes every occurrence of an id from the z-order list; true if it moved. */
  private dropFromDrawingOrder(fields: LoroMap, elementId: string): boolean {
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
  }

  /**
   * Sets the whole z-order. Unknown ids are ignored and live elements the
   * caller left out keep their relative order after the listed ones. Moves are
   * Loro move operations, so concurrent reorders converge instead of forking.
   */
  setDrawingOrder(cardId: string, order: readonly string[]): void {
    const id = entityIdSchema.parse(cardId);
    const fields = this.drawingEntry(id);
    if (!fields) return;
    const list = fields.get("order");
    if (!isMovableList(list)) return;

    const live = this.liveDrawingElements(fields);
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

    this.touchDrawing(fields, Date.now());
    this.commit(`${STRUCT_ORIGIN}drawing-order`);
  }

  /** Drops a card's whole scene; the card itself is untouched. */
  clearDrawing(cardId: string): void {
    const id = entityIdSchema.parse(cardId);
    if (this.drawings.get(id) === undefined) return;
    this.drawings.delete(id);
    this.commit(`${STRUCT_ORIGIN}clear-drawing`);
  }

  // -------------------------------------------------------------- observe

  observe(onChange: (change: WorkspaceChange) => void): () => void {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }

  /** Raw Loro update bytes for a provider. */
  exportUpdate(): Uint8Array {
    return this.doc.export({ mode: "update" });
  }

  importUpdate(update: Uint8Array): void {
    this.doc.import(update);
  }

  exportSnapshot(): Uint8Array {
    return this.doc.export({ mode: "snapshot" });
  }

  importSnapshot(snapshot: Uint8Array): void {
    this.doc.import(snapshot);
  }

  /** Test/debug helper: all values, for parity checks. */
  toJSON(): Record<string, Value> {
    return this.doc.toJSON() as Record<string, Value>;
  }
}
