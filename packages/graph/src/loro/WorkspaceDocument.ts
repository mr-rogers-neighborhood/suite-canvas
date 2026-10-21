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
import {
  type Board,
  boardSchema,
  type Card,
  type Connector,
  cardSchema,
  type GraphEdge,
  graphEdgeSchema,
  type Placement,
  placementSchema,
} from "../schema.js";

export type WorkspaceSection = "boards" | "cards" | "placements" | "edges";
export type WorkspaceAction = "add" | "update" | "delete";
export type LayerAction = "forward" | "front" | "backward" | "back";

export interface WorkspaceChange {
  section: WorkspaceSection;
  action: WorkspaceAction;
  key: string;
  value: Board | Card | Placement | GraphEdge | null;
}

/** Shared text containers for one card, stable until the cards map changes. */
export interface CardContainers {
  contentId: ContainerID | null;
  titleId: ContainerID | null;
}

export interface CreateCardInput {
  id?: string;
  kind?: Card["kind"];
  /** Place the card on this board straight away; omit to create it in the inbox. */
  boardId?: string;
  position?: { x: number; y: number };
}

export interface CreateEdgeInput {
  boardId: string;
  source: string;
  target: string;
  sourceConnector?: string | undefined;
  targetConnector?: string | undefined;
  kind?: GraphEdge["kind"];
}

/** Deterministic id so every client seeds the same default board. */
export const DEFAULT_BOARD_ID = "board-1";
/** Below this gap two ranks are one float step apart; the board renumbers. */
const MIN_RANK_GAP = 1e-7;

export const CONNECTORS_FIELD = "connectors";

/** Origin prefixes that keep text/editor history out of the structural undo stack. */
export const TEXT_ORIGIN_PREFIX = "loroSyncPlugin";
export const INIT_ORIGIN = "sys:init";
const STRUCT_ORIGIN = "struct:";

export function placementKey(boardId: string, cardId: string): string {
  return `${boardId}/${cardId}`;
}

/** Backfills fields added after a document was created. */
export function normalizeCard(card: Card): Card {
  const legacy = card as Partial<Card> & { connectors?: Connector[] };
  return {
    ...card,
    connectors:
      Array.isArray(legacy.connectors) && legacy.connectors.length > 0
        ? legacy.connectors
        : [...defaultConnectors()],
    deletedAt: legacy.deletedAt ?? null,
  } as Card;
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

  return cardSchema.parse({
    id,
    kind: "note",
    createdAt: readNumber(fields, "createdAt") ?? 0,
    updatedAt: readNumber(fields, "updatedAt") ?? 0,
    connectors: connectors.map((entry) => entry.connector),
    deletedAt: readNumber(fields, "deletedAt") ?? null,
    data: fields.get("data") ?? {},
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
  static readonly CONTENT_KEY = "content";
  static readonly TITLES_KEY = "titles";
  static readonly META_KEY = "meta";

  readonly doc: LoroDoc;
  private readonly boards: LoroMap;
  private readonly cards: LoroMap;
  private readonly placements: LoroMap;
  private readonly edges: LoroMap;
  private readonly content: LoroMap;
  private readonly titles: LoroMap;
  private readonly meta: LoroMap;
  private readonly cardCache = new Map<string, Card>();
  private readonly placementCache = new Map<string, Placement>();
  private readonly edgeCache = new Map<string, GraphEdge>();
  private readonly boardCache = new Map<string, Board>();
  private readonly undoManager: UndoManager;
  private readonly known: Record<WorkspaceSection, Set<string>>;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  private readonly containerCache = new Map<string, CardContainers>();
  private readonly containerListeners = new Map<string, Set<() => void>>();

  constructor(doc: LoroDoc = new LoroDoc()) {
    this.doc = doc;
    this.boards = doc.getMap(WorkspaceDocument.BOARDS_KEY);
    this.cards = doc.getMap(WorkspaceDocument.CARDS_KEY);
    this.placements = doc.getMap(WorkspaceDocument.PLACEMENTS_KEY);
    this.edges = doc.getMap(WorkspaceDocument.EDGES_KEY);
    this.content = doc.getMap(WorkspaceDocument.CONTENT_KEY);
    this.titles = doc.getMap(WorkspaceDocument.TITLES_KEY);
    this.meta = doc.getMap(WorkspaceDocument.META_KEY);
    this.known = {
      boards: new Set(this.boards.keys()),
      cards: new Set(this.cards.keys()),
      placements: new Set(this.placements.keys()),
      edges: new Set(this.edges.keys()),
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
          root !== WorkspaceDocument.EDGES_KEY
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
        this.containerCache.delete(cardId);
        const listeners = this.containerListeners.get(cardId);
        if (!listeners) continue;
        for (const listener of listeners) listener();
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
      excludeOriginPrefixes: [TEXT_ORIGIN_PREFIX, INIT_ORIGIN, "text:"],
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
    fields.set("kind", card.kind);
    fields.set("createdAt", card.createdAt);
    fields.set("updatedAt", card.updatedAt);
    fields.set("deletedAt", card.deletedAt ?? null);
    fields.set("data", card.data);

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
    const card = cardSchema.parse({
      id: input.id ?? crypto.randomUUID(),
      kind: input.kind ?? "note",
      createdAt: now,
      updatedAt: now,
      connectors: defaultConnectors(),
      deletedAt: null,
      data: {},
    }) as Card;

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

  /** Title text, falling back to the body's first line, then "Untitled". */
  displayTitle(cardId: string): string {
    const title = firstLine(textOf(this.peekTitle(cardId)));
    if (title) return title;
    const body = firstLine(textOf(this.peekContent(cardId)));
    return body || "Untitled";
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
