import {
  type ContainerID,
  getType,
  isContainer,
  LoroDoc,
  type LoroList,
  type LoroMap,
  type LoroText,
  UndoManager,
  type Value,
} from "loro-crdt";
import {
  createConnectorId,
  defaultConnectors,
  nextFreeAnchor,
  snapToAnchor,
} from "../connectors.js";
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
}

export interface CreateTypeInput {
  id?: string;
  name: string;
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
  sourceConnector?: string | undefined;
  targetConnector?: string | undefined;
  kind?: GraphEdge["kind"];
}

/** One placement in a multi-card move; only geometry is written. */
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
}

/** Deterministic id so every client seeds the same default board. */
export const DEFAULT_BOARD_ID = "board-1";
/** Spatial sections start at version 4. */
export const SCHEMA_VERSION = 4;
/** Below this gap two ranks are one float step apart; the board renumbers. */
const MIN_RANK_GAP = 1e-7;

export const CONNECTORS_FIELD = "connectors";

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

function connectorFromMap(id: string, fields: LoroMap): Connector {
  return {
    id,
    x: readNumber(fields, "x") ?? 0,
    y: readNumber(fields, "y") ?? 0,
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

  return fieldDefinitionSchema.parse({
    id,
    name: readString(fields, "name") ?? "Field",
    kind: readString(fields, "kind") ?? "text",
    required: readBoolean(fields, "required") ?? false,
    order: readNumber(fields, "order") ?? Number.MAX_SAFE_INTEGER,
    options,
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
  return cardTypeSchema.parse({
    id,
    name: readString(fields, "name") ?? "Type",
    glyph: readString(fields, "glyph") ?? "\u25c7",
    createdAt: readNumber(fields, "createdAt") ?? 0,
    updatedAt: readNumber(fields, "updatedAt") ?? 0,
    fields: definitions,
    ...(color ? { color } : {}),
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
    case "date":
      if (typeof value !== "string") fail("a string");
      return;
    case "card":
      // Soft validation: the target may be trashed or purged already.
      if (typeof value !== "string" || value.trim().length === 0) fail("a card id");
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
  return normalizeEdge(
    graphEdgeSchema.parse({
      id,
      boardId: readString(fields, "boardId") ?? "",
      source: readString(fields, "source") ?? "",
      target: readString(fields, "target") ?? "",
      ...(sourceConnector ? { sourceConnector } : {}),
      ...(targetConnector ? { targetConnector } : {}),
      kind: readString(fields, "kind") ?? "references",
      path: readString(fields, "path") ?? "bezier",
      bidirectional: readBoolean(fields, "bidirectional") ?? false,
      ...(label ? { label } : {}),
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
  private readonly cardCache = new Map<string, Card>();
  private readonly placementCache = new Map<string, Placement>();
  private readonly edgeCache = new Map<string, GraphEdge>();
  private readonly boardCache = new Map<string, Board>();
  private readonly typeCache = new Map<string, CardType>();
  private readonly tagCache = new Map<string, Tag>();
  private readonly sectionCache = new Map<string, Section>();
  private readonly referenceCache = new Map<string, string[]>();
  private readonly pendingReferences = new Set<string>();
  private referencesScheduled = false;
  private readonly undoManager: UndoManager;
  private readonly known: Record<WorkspaceSection, Set<string>>;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
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

  private commit(origin = `${STRUCT_ORIGIN}write`): void {
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

  // ---------------------------------------------------------------- boards

  private cachedBoard(id: string): Board | undefined {
    const cached = this.boardCache.get(id);
    if (cached) return cached;
    const value = this.boards.get(id);
    if (!isMap(value)) return undefined;
    const board = boardSchema.parse({
      id,
      name: readString(value, "name") ?? "Board",
      createdAt: readNumber(value, "createdAt") ?? 0,
      updatedAt: readNumber(value, "updatedAt") ?? 0,
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

  deleteBoard(id: string, options: { cards?: "keep" | "trash" } = {}): void {
    const cardsOption = options.cards ?? "keep";
    for (const key of [...this.placements.keys()]) {
      const fields = this.placements.get(key);
      if (isMap(fields) && readString(fields, "boardId") === id) this.placements.delete(key);
    }
    for (const edgeId of [...this.edges.keys()]) {
      const fields = this.edges.get(edgeId);
      if (isMap(fields) && readString(fields, "boardId") === id) this.edges.delete(edgeId);
    }
    for (const sectionId of [...this.sections.keys()]) {
      const fields = this.sections.get(sectionId);
      if (isMap(fields) && readString(fields, "boardId") === id) this.sections.delete(sectionId);
    }
    this.boards.delete(id);

    if (cardsOption === "trash") {
      const now = Date.now();
      for (const card of this.listCards()) {
        if (card.deletedAt) continue;
        if (this.listCardPlacements(card.id).length > 0) continue;
        this.mutateCard(card.id, (fields) => fields.set("deletedAt", now), false);
      }
    }
    this.commit(`${STRUCT_ORIGIN}delete-board`);
  }

  ensureBoard(): Board {
    const [first] = this.listBoards();
    if (first) return first;
    return this.createBoard({ id: DEFAULT_BOARD_ID, name: "Board 1" });
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
    if (type.color) fields.set("color", type.color);
    else if (fields.get("color") !== undefined) fields.delete("color");
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
    });
    this.writeType(type, commit);
    this.typeCache.set(type.id, type);
    return type;
  }

  updateType(id: string, patch: { name?: string; glyph?: string; color?: string | null }): void {
    const type = this.getType(id);
    if (!type) return;
    const fields = this.types.get(id);
    if (!isMap(fields)) return;
    if (patch.name !== undefined) fields.set("name", patch.name.trim() || type.name);
    if (patch.glyph !== undefined) fields.set("glyph", patch.glyph || type.glyph);
    if (patch.color !== undefined) {
      if (patch.color) fields.set("color", patch.color);
      else if (fields.get("color") !== undefined) fields.delete("color");
    }
    fields.set("updatedAt", Date.now());
    this.commit(`${STRUCT_ORIGIN}type`);
  }

  /**
   * Deletes a type and reassigns the cards that used it. One commit, so the
   * whole command is one undo step. The built-in note type cannot be deleted.
   */
  deleteType(id: string, options: { reassignTo?: string } = {}): number {
    if (id === DEFAULT_TYPE_ID) {
      throw new Error("The note type cannot be deleted");
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

  /** Idempotent: the three starter types exist in every workspace. */
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
    if (this.meta.get("schemaVersion") !== SCHEMA_VERSION) {
      this.meta.set("schemaVersion", SCHEMA_VERSION);
      changed = true;
    }
    if (changed) this.commit(`${STRUCT_ORIGIN}seed`);
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
  updateField(typeId: string, fieldId: string, patch: { name?: string; required?: boolean }): void {
    const field = this.typeFields(typeId)?.get(fieldId);
    if (!isMap(field)) return;
    if (patch.name !== undefined) field.set("name", patch.name.trim() || "Field");
    if (patch.required !== undefined) field.set("required", patch.required);
    this.touchType(typeId);
    this.commit(`${STRUCT_ORIGIN}field`);
  }

  /** Removes the definition only; card values stay dormant and can be revived. */
  removeField(typeId: string, fieldId: string): void {
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
    this.sections.delete(id);
    this.commit(`${STRUCT_ORIGIN}delete-section`);
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
    const card = cardSchema.parse({
      id: input.id ?? crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      connectors: defaultConnectors(),
      deletedAt: null,
      typeIds: [typeId],
      primaryTypeId: typeId,
      tags: [],
      properties: {},
    });

    this.applyCard(card);
    this.content.ensureMergeableMap(card.id);
    this.titles.ensureMergeableMap(card.id);
    if (input.boardId) {
      this.placeCardInternal(input.boardId, card.id, input.position ?? { x: 0, y: 0 });
    }
    this.commit(`${STRUCT_ORIGIN}create-card`);
    return card;
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
    return this.listEdges().filter(
      (edge) =>
        edge.boardId === boardId &&
        placed.has(edge.source) &&
        placed.has(edge.target) &&
        this.anchorsResolve(edge, placed),
    );
  }

  private anchorsResolve(edge: GraphEdge, placed: Map<string, Card>): boolean {
    const resolve = (cardId: string, connectorId: string | undefined): boolean => {
      if (!connectorId) return true;
      const connectors = placed.get(cardId)?.connectors ?? [];
      return connectors.some((connector) => connector.id === connectorId);
    };
    return resolve(edge.source, edge.sourceConnector) && resolve(edge.target, edge.targetConnector);
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
    if (input.source === input.target) return null;

    const now = Date.now();
    const edge: GraphEdge = graphEdgeSchema.parse({
      id: crypto.randomUUID(),
      boardId: input.boardId,
      source: input.source,
      target: input.target,
      kind: input.kind ?? "references",
      path: "bezier",
      bidirectional: false,
      createdAt: now,
      updatedAt: now,
      ...(input.sourceConnector ? { sourceConnector: input.sourceConnector } : {}),
      ...(input.targetConnector ? { targetConnector: input.targetConnector } : {}),
    });
    this.applyEdge(edge);
    this.commit(`${STRUCT_ORIGIN}add-edge`);
    return edge;
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
  ): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    if (end === "source") {
      if (cardId === edge.target) return;
      this.mutateEdge(id, (fields) => {
        fields.set("source", cardId);
        if (connectorId) fields.set("sourceConnector", connectorId);
        else fields.delete("sourceConnector");
      });
    } else {
      if (cardId === edge.source) return;
      this.mutateEdge(id, (fields) => {
        fields.set("target", cardId);
        if (connectorId) fields.set("targetConnector", connectorId);
        else fields.delete("targetConnector");
      });
    }
  }

  reverseEdge(id: string): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    this.mutateEdge(id, (fields) => {
      fields.set("source", edge.target);
      fields.set("target", edge.source);
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
