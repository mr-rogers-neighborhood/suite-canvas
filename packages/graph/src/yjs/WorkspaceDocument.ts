import * as Y from "yjs";
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
/**
 * 1: single-board `nodes`/`edges` → workspace.
 * 2: whole-record map values → nested field maps, so independent edits of the
 *    same card/placement/edge merge instead of clobbering each other.
 */
const SCHEMA_VERSION = 2;

type Fields = Y.Map<unknown>;

export const CONNECTORS_FIELD = "connectors";

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
        : defaultConnectors(),
    deletedAt: legacy.deletedAt ?? null,
  };
}

function normalizeEdge(edge: GraphEdge): GraphEdge {
  const legacy = edge as GraphEdge & { bidirectional?: boolean; path?: GraphEdge["path"] };
  return {
    ...edge,
    bidirectional: typeof legacy.bidirectional === "boolean" ? legacy.bidirectional : false,
    path: legacy.path ?? "bezier",
  };
}

/** Nested record maps: one key per fact, so concurrent edits merge. */
function isFields(value: unknown): value is Fields {
  return value instanceof Y.Map;
}

function connectorFromFields(id: string, fields: Fields): Connector {
  const x = fields.get("x");
  const y = fields.get("y");
  return {
    id,
    x: typeof x === "number" ? x : 0,
    y: typeof y === "number" ? y : 0,
  };
}

export function cardFromFields(id: string, fields: Fields): Card {
  const connectorsField = fields.get(CONNECTORS_FIELD);
  const connectors: Connector[] = [];
  if (isFields(connectorsField)) {
    for (const [connectorId, connectorFields] of connectorsField) {
      if (isFields(connectorFields))
        connectors.push(connectorFromFields(connectorId, connectorFields));
    }
  }

  const kind = fields.get("kind");
  // No `normalizeCard` here: minting default connectors on read would hand out
  // fresh ids on every read, which breaks handles and the links that use them.
  return {
    id,
    kind: kind === "note" ? kind : "note",
    createdAt: Number(fields.get("createdAt") ?? 0),
    updatedAt: Number(fields.get("updatedAt") ?? 0),
    connectors,
    deletedAt: (fields.get("deletedAt") as number | null | undefined) ?? null,
    data: (fields.get("data") as Record<string, never> | undefined) ?? {},
  } as Card;
}

export function placementFromFields(key: string, fields: Fields): Placement {
  const [boardId, cardId] = key.split("/");
  const width = fields.get("width");
  const height = fields.get("height");
  return placementSchema.parse({
    boardId: (fields.get("boardId") as string | undefined) ?? boardId ?? "",
    cardId: (fields.get("cardId") as string | undefined) ?? cardId ?? "",
    x: Number(fields.get("x") ?? 0),
    y: Number(fields.get("y") ?? 0),
    z: Number(fields.get("z") ?? 0),
    createdAt: Number(fields.get("createdAt") ?? 0),
    ...(typeof width === "number" ? { width } : {}),
    ...(typeof height === "number" ? { height } : {}),
  });
}

export function edgeFromFields(id: string, fields: Fields): GraphEdge {
  const read = (key: string): string | undefined => {
    const value = fields.get(key);
    return typeof value === "string" ? value : undefined;
  };

  const edge: Record<string, unknown> = {
    id,
    boardId: read("boardId") ?? "",
    source: read("source") ?? "",
    target: read("target") ?? "",
    kind: read("kind") ?? "references",
    path: read("path") ?? "bezier",
    bidirectional: fields.get("bidirectional") === true,
    createdAt: Number(fields.get("createdAt") ?? 0),
    updatedAt: Number(fields.get("updatedAt") ?? 0),
  };
  const sourceConnector = read("sourceConnector");
  const targetConnector = read("targetConnector");
  const label = read("label");
  if (sourceConnector) edge.sourceConnector = sourceConnector;
  if (targetConnector) edge.targetConnector = targetConnector;
  if (label) edge.label = label;
  return normalizeEdge(graphEdgeSchema.parse(edge));
}

function fieldsOfCard(card: Card): Fields {
  const fields = new Y.Map<unknown>();
  fields.set("kind", card.kind);
  fields.set("createdAt", card.createdAt);
  fields.set("updatedAt", card.updatedAt);
  fields.set("deletedAt", card.deletedAt ?? null);
  fields.set("data", card.data);
  const connectors = new Y.Map<Fields>();
  for (const connector of card.connectors) {
    const connectorFields = new Y.Map<unknown>();
    connectorFields.set("x", connector.x);
    connectorFields.set("y", connector.y);
    connectors.set(connector.id, connectorFields);
  }
  fields.set(CONNECTORS_FIELD, connectors);
  return fields;
}

function fieldsOfPlacement(placement: Placement): Fields {
  const fields = new Y.Map<unknown>();
  fields.set("boardId", placement.boardId);
  fields.set("cardId", placement.cardId);
  fields.set("x", placement.x);
  fields.set("y", placement.y);
  fields.set("z", placement.z);
  fields.set("createdAt", placement.createdAt);
  if (placement.width !== undefined) fields.set("width", placement.width);
  if (placement.height !== undefined) fields.set("height", placement.height);
  return fields;
}

function fieldsOfEdge(edge: GraphEdge): Fields {
  const fields = new Y.Map<unknown>();
  fields.set("boardId", edge.boardId);
  fields.set("source", edge.source);
  fields.set("target", edge.target);
  fields.set("kind", edge.kind);
  fields.set("path", edge.path);
  fields.set("bidirectional", edge.bidirectional);
  fields.set("createdAt", edge.createdAt);
  fields.set("updatedAt", edge.updatedAt);
  if (edge.sourceConnector) fields.set("sourceConnector", edge.sourceConnector);
  if (edge.targetConnector) fields.set("targetConnector", edge.targetConnector);
  if (edge.label) fields.set("label", edge.label);
  return fields;
}

function sortByLayer(placements: Placement[]): Placement[] {
  return [...placements].sort(
    (a, b) => a.z - b.z || a.createdAt - b.createdAt || a.cardId.localeCompare(b.cardId),
  );
}

type XmlNode = Y.XmlElement | Y.XmlText | Y.XmlHook;

function nodeText(node: XmlNode): string {
  if (node instanceof Y.XmlText) return node.toString();
  if (node instanceof Y.XmlElement) return node.toArray().map(nodeText).join("");
  return "";
}

/** Plain text of a rich-text fragment; block children become lines. */
export function fragmentText(fragment: Y.XmlFragment | undefined): string {
  if (!fragment) return "";
  return fragment.toArray().map(nodeText).join("\n");
}

/** First non-empty line of a rich-text fragment, trimmed. */
function firstLine(fragment: Y.XmlFragment | undefined): string {
  return (
    fragmentText(fragment)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

/**
 * A workspace document. Boards are views over one shared card pool, so cards
 * can appear on several boards and moving one between boards stays atomic.
 * Every write is validated against the Zod schemas before it reaches the CRDT.
 */
export class WorkspaceDocument {
  static readonly BOARDS_KEY = "boards";
  static readonly CARDS_KEY = "cards";
  static readonly PLACEMENTS_KEY = "placements";
  static readonly EDGES_KEY = "edges";
  static readonly CONTENT_KEY = "content";
  static readonly TITLES_KEY = "titles";
  static readonly META_KEY = "meta";

  readonly doc: Y.Doc;
  private readonly boards: Y.Map<Board>;
  private readonly cards: Y.Map<Fields>;
  private readonly placements: Y.Map<Fields>;
  private readonly edges: Y.Map<Fields>;
  private readonly content: Y.Map<Y.XmlFragment>;
  private readonly titles: Y.Map<Y.XmlFragment>;
  /** Local, never-synced fragments used until the shared one arrives. */
  private readonly placeholders = new Map<string, Y.XmlFragment>();

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.boards = doc.getMap<Board>(WorkspaceDocument.BOARDS_KEY);
    this.cards = doc.getMap<Fields>(WorkspaceDocument.CARDS_KEY);
    this.placements = doc.getMap<Fields>(WorkspaceDocument.PLACEMENTS_KEY);
    this.edges = doc.getMap<Fields>(WorkspaceDocument.EDGES_KEY);
    this.content = doc.getMap<Y.XmlFragment>(WorkspaceDocument.CONTENT_KEY);
    this.titles = doc.getMap<Y.XmlFragment>(WorkspaceDocument.TITLES_KEY);

    migrateLegacyDocument(doc);
    migrateRecordsToFieldMaps(doc);
  }

  /** Seeding is once per workspace, not once per board. */
  hasSeeded(): boolean {
    return this.doc.getMap<unknown>(WorkspaceDocument.META_KEY).get("seeded") === true;
  }

  markSeeded(): void {
    this.doc.getMap<unknown>(WorkspaceDocument.META_KEY).set("seeded", true);
  }

  // ---------------------------------------------------------------- boards

  listBoards(): Board[] {
    return Array.from(this.boards.values()).sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
  }

  getBoard(id: string): Board | undefined {
    return this.boards.get(id);
  }

  createBoard(input: { id?: string; name?: string } = {}): Board {
    const now = Date.now();
    const board: Board = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name ?? `Board ${this.boards.size + 1}`,
      createdAt: now,
      updatedAt: now,
    };
    this.boards.set(board.id, boardSchema.parse(board));
    return board;
  }

  renameBoard(id: string, name: string): void {
    const board = this.boards.get(id);
    if (!board) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    this.boards.set(id, { ...board, name: trimmed, updatedAt: Date.now() });
  }

  /**
   * Deletes a board and everything that only made sense on it. Cards survive:
   * `cards: "trash"` sends the ones left without a board to the trash, while
   * cards still placed elsewhere are never affected.
   */
  deleteBoard(id: string, options: { cards?: "keep" | "trash" } = {}): void {
    const cardsOption = options.cards ?? "keep";

    for (const [key, value] of this.placements) {
      if (placementFromFields(key, value).boardId === id) this.placements.delete(key);
    }
    for (const [edgeId, value] of this.edges) {
      if (edgeFromFields(edgeId, value).boardId === id) this.edges.delete(edgeId);
    }
    this.boards.delete(id);

    if (cardsOption === "trash") {
      const now = Date.now();
      for (const card of this.listCards()) {
        if (card.deletedAt) continue;
        if (this.listCardPlacements(card.id).length > 0) continue;
        this.mutateCard(card.id, (fields) => fields.set("deletedAt", now));
      }
    }
  }

  /** Returns the first board, creating a default one when the workspace is empty. */
  ensureBoard(): Board {
    const [first] = this.listBoards();
    if (first) return first;
    return this.createBoard({ id: DEFAULT_BOARD_ID, name: "Board 1" });
  }

  // ----------------------------------------------------------------- cards

  listCards(): Card[] {
    return Array.from(this.cards.entries(), ([id, value]) => this.materializeCard(id, value));
  }

  private materializeCard(id: string, value: unknown): Card {
    // A plain record is either pre-migration data or a write from an old client.
    return isFields(value) ? cardFromFields(id, value) : normalizeCard(value as Card);
  }

  getCard(id: string): Card | undefined {
    const value = this.cards.get(id);
    return value ? this.materializeCard(id, value) : undefined;
  }

  /** Full write. Prefer the field-level operations below for concurrent edits. */
  setCard(card: Card): void {
    const parsed = cardSchema.parse(normalizeCard(card));
    this.doc.transact(() => {
      const existing = this.cards.get(card.id);
      if (!isFields(existing)) {
        this.cards.set(parsed.id, fieldsOfCard(parsed));
        return;
      }

      existing.set("kind", parsed.kind);
      existing.set("createdAt", parsed.createdAt);
      existing.set("updatedAt", parsed.updatedAt);
      existing.set("deletedAt", parsed.deletedAt ?? null);
      existing.set("data", parsed.data);

      const current = existing.get(CONNECTORS_FIELD);
      const connectors: Y.Map<Fields> = isFields(current)
        ? (current as Y.Map<Fields>)
        : new Y.Map<Fields>();
      if (!isFields(current)) existing.set(CONNECTORS_FIELD, connectors);

      const wanted = new Set(parsed.connectors.map((connector) => connector.id));
      for (const connector of parsed.connectors) {
        const fields = connectors.get(connector.id);
        if (isFields(fields)) {
          fields.set("x", connector.x);
          fields.set("y", connector.y);
        } else {
          const created = new Y.Map<unknown>();
          created.set("x", connector.x);
          created.set("y", connector.y);
          connectors.set(connector.id, created);
        }
      }
      for (const connectorId of [...connectors.keys()]) {
        if (!wanted.has(connectorId)) connectors.delete(connectorId);
      }
    });
  }

  /** Field-level edit; only the touched keys are written. */
  private mutateCard(cardId: string, mutate: (fields: Fields) => void): void {
    const fields = this.cards.get(cardId);
    if (!isFields(fields)) return;
    this.doc.transact(() => {
      mutate(fields);
      fields.set("updatedAt", Date.now());
    });
  }

  private connectorFields(cardId: string, connectorId: string): Fields | undefined {
    const cardFields = this.cards.get(cardId);
    if (!isFields(cardFields)) return undefined;
    const connectors = cardFields.get(CONNECTORS_FIELD);
    if (!isFields(connectors)) return undefined;
    const fields = connectors.get(connectorId);
    return isFields(fields) ? fields : undefined;
  }

  createCard(input: CreateCardInput = {}): Card {
    const now = Date.now();
    const card = {
      id: input.id ?? crypto.randomUUID(),
      kind: input.kind ?? "note",
      createdAt: now,
      updatedAt: now,
      connectors: defaultConnectors(),
      deletedAt: null,
      data: {},
    } as Card;

    // One transaction so a peer never sees the card before its text containers.
    this.doc.transact(() => {
      this.cards.set(card.id, fieldsOfCard(card));
      this.getContent(card.id);
      this.getTitle(card.id);
      if (input.boardId) {
        this.placeCard(input.boardId, card.id, input.position ?? { x: 0, y: 0 });
      }
    });
    return card;
  }

  isTrashed(cardId: string): boolean {
    return Boolean(this.getCard(cardId)?.deletedAt);
  }

  trashCard(id: string): void {
    const card = this.getCard(id);
    if (!card || card.deletedAt) return;
    const now = Date.now();
    this.mutateCard(id, (fields) => fields.set("deletedAt", now));
  }

  restoreCard(id: string): void {
    const card = this.getCard(id);
    if (!card?.deletedAt) return;
    this.mutateCard(id, (fields) => fields.set("deletedAt", null));
  }

  /** Destroys a card and everything that referenced it. Used by "delete forever". */
  purgeCard(id: string): void {
    // Snapshot first: deleting while iterating a Y.Map skips entries.
    const placements = this.listPlacements().filter((placement) => placement.cardId === id);
    const edges = this.listEdges().filter((edge) => edge.source === id || edge.target === id);
    this.doc.transact(() => {
      this.cards.delete(id);
      for (const placement of placements) {
        this.placements.delete(placementKey(placement.boardId, placement.cardId));
      }
      for (const edge of edges) this.edges.delete(edge.id);
      this.content.delete(id);
      this.titles.delete(id);
    });
  }

  /**
   * Re-runs the legacy migration. Safe to call after the document finishes
   * loading, which is when a not-yet-hydrated client actually sees old data.
   */
  migrateLegacy(): void {
    migrateLegacyDocument(this.doc);
  }

  emptyTrash(): void {
    for (const card of this.listCards()) {
      if (card.deletedAt) this.purgeCard(card.id);
    }
  }

  /**
   * The shared body fragment, if it has arrived. Reading never creates a shared
   * container: a client that mounts before the document loads would publish a
   * competing fragment, win the CRDT race and orphan the real content.
   */
  peekContent(cardId: string): Y.XmlFragment {
    return this.content.get(cardId) ?? this.placeholder(`content:${cardId}`);
  }

  /** Title fragment, with the same read-never-creates guarantee as `peekContent`. */
  peekTitle(cardId: string): Y.XmlFragment {
    return this.titles.get(cardId) ?? this.placeholder(`title:${cardId}`);
  }

  private placeholder(key: string): Y.XmlFragment {
    const existing = this.placeholders.get(key);
    if (existing) return existing;
    const fragment = new Y.XmlFragment();
    this.placeholders.set(key, fragment);
    return fragment;
  }

  /** Creates the body fragment if it is missing. Only writers should call this. */
  getContent(cardId: string): Y.XmlFragment {
    const existing = this.content.get(cardId);
    if (existing) return existing;
    const fragment = new Y.XmlFragment();
    this.content.set(cardId, fragment);
    return fragment;
  }

  /** Creates the title fragment if it is missing. Only writers should call this. */
  getTitle(cardId: string): Y.XmlFragment {
    const existing = this.titles.get(cardId);
    if (existing) return existing;
    const fragment = new Y.XmlFragment();
    this.titles.set(cardId, fragment);
    return fragment;
  }

  /** Title text, falling back to the body's first line, then "Untitled". */
  displayTitle(cardId: string): string {
    const title = firstLine(this.titles.get(cardId));
    if (title) return title;
    const body = firstLine(this.content.get(cardId));
    return body || "Untitled";
  }

  // ------------------------------------------------------------ placements

  listPlacements(): Placement[] {
    return Array.from(this.placements.entries(), ([key, value]) =>
      this.materializePlacement(key, value),
    );
  }

  private materializePlacement(key: string, value: unknown): Placement {
    return isFields(value) ? placementFromFields(key, value) : placementSchema.parse(value);
  }

  listCardPlacements(cardId: string): Placement[] {
    return this.listPlacements()
      .filter((placement) => placement.cardId === cardId)
      .sort((a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId));
  }

  getPlacement(boardId: string, cardId: string): Placement | undefined {
    const key = placementKey(boardId, cardId);
    const value = this.placements.get(key);
    return value ? this.materializePlacement(key, value) : undefined;
  }

  /** The board a card calls home: its oldest placement. */
  homeBoardId(cardId: string): string | null {
    return this.listCardPlacements(cardId)[0]?.boardId ?? null;
  }

  listBoardPlacements(boardId: string): Placement[] {
    return sortByLayer(this.listPlacements().filter((placement) => placement.boardId === boardId));
  }

  /** Cards on a board, back to front, excluding trashed ones. */
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

  /**
   * Strictly increasing timestamp, so "home = oldest placement" stays stable even
   * when several placements are created in the same millisecond.
   */
  private nextPlacementTime(): number {
    const latest = this.listPlacements().reduce(
      (max, placement) => Math.max(max, placement.createdAt),
      0,
    );
    return Math.max(Date.now(), latest + 1);
  }

  placeCard(boardId: string, cardId: string, position: { x: number; y: number }): Placement | null {
    if (!this.cards.get(cardId) || !this.boards.get(boardId)) return null;

    const existing = this.getPlacement(boardId, cardId);
    if (existing) {
      this.updatePlacementPosition(boardId, cardId, position);
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
    this.placements.set(placementKey(boardId, cardId), fieldsOfPlacement(placement));
    return placement;
  }

  unplaceCard(boardId: string, cardId: string): void {
    this.placements.delete(placementKey(boardId, cardId));
  }

  updatePlacementPosition(
    boardId: string,
    cardId: string,
    position: { x: number; y: number },
  ): void {
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isFields(fields)) return;
    this.doc.transact(() => {
      fields.set("x", position.x);
      fields.set("y", position.y);
    });
  }

  /** Records a resized card. Size is per placement: a card can be small on one board. */
  updatePlacementSize(
    boardId: string,
    cardId: string,
    size: { width: number; height: number },
  ): void {
    const fields = this.placements.get(placementKey(boardId, cardId));
    if (!isFields(fields)) return;
    this.doc.transact(() => {
      fields.set("width", size.width);
      fields.set("height", size.height);
    });
  }

  /** Reassigns stacking order within one board (0 = furthest back). */
  moveLayer(boardId: string, cardId: string, action: LayerAction): void {
    const order = this.listBoardPlacements(boardId);
    const index = order.findIndex((placement) => placement.cardId === cardId);
    if (index < 0) return;

    const [placement] = order.splice(index, 1);
    if (!placement) return;

    const target =
      action === "front"
        ? order.length
        : action === "back"
          ? 0
          : action === "forward"
            ? Math.min(order.length, index + 1)
            : Math.max(0, index - 1);

    order.splice(target, 0, placement);

    // One transaction per reorder so peers never see a half-sorted stack.
    this.doc.transact(() => {
      order.forEach((entry, z) => {
        if (entry.z === z) return;
        this.placements.get(placementKey(boardId, entry.cardId))?.set("z", z);
      });
    });
  }

  // ----------------------------------------------------------------- edges

  listEdges(): GraphEdge[] {
    return Array.from(this.edges.entries(), ([id, value]) => this.materializeEdge(id, value));
  }

  private materializeEdge(id: string, value: unknown): GraphEdge {
    return isFields(value) ? edgeFromFields(id, value) : normalizeEdge(value as GraphEdge);
  }

  /** Field-level edge edit inside one transaction. */
  private mutateEdge(edgeId: string, mutate: (fields: Fields) => void): void {
    const fields = this.edges.get(edgeId);
    if (!isFields(fields)) return;
    this.doc.transact(() => {
      mutate(fields);
      fields.set("updatedAt", Date.now());
    });
  }

  /**
   * Edges on a board that can be drawn: both endpoints are placed on it and
   * neither is trashed. Dormant edges stay in the CRDT and revive on return.
   */
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

  /**
   * A link whose connector was deleted cannot be drawn. Such edges can still
   * exist in older documents, so they are filtered out rather than rendered.
   */
  private anchorsResolve(edge: GraphEdge, placed: Map<string, Card>): boolean {
    const resolve = (cardId: string, connectorId: string | undefined): boolean => {
      if (!connectorId) return true;
      const connectors = placed.get(cardId)?.connectors ?? [];
      return connectors.some((connector) => connector.id === connectorId);
    };
    return resolve(edge.source, edge.sourceConnector) && resolve(edge.target, edge.targetConnector);
  }

  getEdge(id: string): GraphEdge | undefined {
    const value = this.edges.get(id);
    return value ? this.materializeEdge(id, value) : undefined;
  }

  setEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, fieldsOfEdge(graphEdgeSchema.parse(normalizeEdge(edge))));
  }

  addEdge(input: CreateEdgeInput): GraphEdge | null {
    if (input.source === input.target) return null;

    const now = Date.now();
    const edge: GraphEdge = {
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
    };
    this.setEdge(edge);
    return edge;
  }

  removeEdge(id: string): void {
    this.edges.delete(id);
  }

  setEdgePath(id: string, path: GraphEdge["path"]): void {
    if (!this.getEdge(id)) return;
    this.mutateEdge(id, (fields) => fields.set("path", path));
  }

  /** Reattaches one end of a link to another card/connector. */
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

  /** Swaps the endpoints (and their connectors) of an existing link. */
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
    this.mutateCard(cardId, (fields) => {
      const current = fields.get(CONNECTORS_FIELD);
      const connectors: Y.Map<Fields> = isFields(current)
        ? (current as Y.Map<Fields>)
        : new Y.Map<Fields>();
      if (!isFields(current)) fields.set(CONNECTORS_FIELD, connectors);
      const connectorFields = new Y.Map<unknown>();
      connectorFields.set("x", connector.x);
      connectorFields.set("y", connector.y);
      connectors.set(connector.id, connectorFields);
    });
    return connector;
  }

  removeConnector(cardId: string, connectorId: string): void {
    if (!this.getCard(cardId)) return;
    // Links anchored to the connector go with it; a dangling link is undrawable.
    const attached = this.listEdges().filter(
      (edge) =>
        (edge.source === cardId && edge.sourceConnector === connectorId) ||
        (edge.target === cardId && edge.targetConnector === connectorId),
    );
    this.doc.transact(() => {
      this.mutateCard(cardId, (fields) => {
        const current = fields.get(CONNECTORS_FIELD);
        if (isFields(current)) (current as Y.Map<Fields>).delete(connectorId);
      });
      for (const edge of attached) this.removeEdge(edge.id);
    });
  }

  /**
   * Moves a connector. Positions are free-form; pass `snap: true` to force the
   * nearest corner/side midpoint (the UI magnetizes while dragging instead).
   */
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
    this.doc.transact(() => {
      fields.set("x", next.x);
      fields.set("y", next.y);
      this.cards.get(cardId)?.set("updatedAt", Date.now());
    });
  }

  // -------------------------------------------------------------- observe

  observe(onChange: (change: WorkspaceChange) => void): () => void {
    const watch = <T>(
      map: Y.Map<T>,
      section: WorkspaceSection,
      read: (key: string) => WorkspaceChange["value"],
    ) => {
      // Top-level keys: add, delete, or a whole record replaced by an old client.
      const topHandler = (event: Y.YMapEvent<T>): void => {
        event.keysChanged.forEach((key) => {
          const changed = event.changes.keys.get(key)?.action;
          const value = read(key);
          const action: WorkspaceAction =
            value === null ? "delete" : changed === "add" ? "add" : "update";
          onChange({ section, action, key, value });
        });
      };

      // Nested field edits: records are field maps, so most writes land here.
      const deepHandler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
        const touched = new Set<string>();
        for (const event of events) {
          if (event.target === map) continue;
          const key = event.path[0];
          if (key !== undefined) touched.add(String(key));
        }
        for (const key of touched) {
          const value = read(key);
          if (value === null) continue;
          onChange({ section, action: "update", key, value });
        }
      };

      map.observe(topHandler);
      map.observeDeep(deepHandler);
      return () => {
        map.unobserve(topHandler);
        map.unobserveDeep(deepHandler);
      };
    };

    return combine([
      watch(this.boards, "boards", (key) => this.boards.get(key) ?? null),
      watch(this.cards, "cards", (key) => {
        const fields = this.cards.get(key);
        return fields ? this.materializeCard(key, fields) : null;
      }),
      watch(this.placements, "placements", (key) => {
        const fields = this.placements.get(key);
        return fields ? this.materializePlacement(key, fields) : null;
      }),
      watch(this.edges, "edges", (key) => {
        const fields = this.edges.get(key);
        return fields ? this.materializeEdge(key, fields) : null;
      }),
    ]);
  }
}

function combine(disposers: Array<() => void>): () => void {
  return () => {
    for (const dispose of disposers) dispose();
  };
}

interface LegacyNode {
  id: string;
  kind: Card["kind"];
  position: { x: number; y: number };
  z?: number;
  createdAt: number;
  updatedAt: number;
  connectors?: Connector[];
  data?: unknown;
}

/**
 * Converts a single-board document (legacy `nodes`/`edges` maps) into a
 * workspace with one board. Deterministic ids make concurrent migrations
 * converge; it is safe to run twice.
 */
export function migrateLegacyDocument(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(WorkspaceDocument.META_KEY);
  if (meta.get("schemaVersion") === SCHEMA_VERSION) return;

  const version = meta.get("schemaVersion");
  if (typeof version === "number" && version >= 1) return;

  const legacyNodes = doc.getMap<LegacyNode>("nodes");
  const legacyEdges = doc.getMap<GraphEdge>("edges");
  if (legacyNodes.size === 0) {
    // Nothing to migrate yet. Leave the version unset: this client may simply
    // not have hydrated the document, and stamping now would skip real data.
    return;
  }

  {
    const boards = doc.getMap<Board>(WorkspaceDocument.BOARDS_KEY);
    const cards = doc.getMap<Card>(WorkspaceDocument.CARDS_KEY);
    const placements = doc.getMap<Placement>(WorkspaceDocument.PLACEMENTS_KEY);

    if (!boards.get(DEFAULT_BOARD_ID)) {
      const first = legacyNodes.values().next().value as LegacyNode | undefined;
      const createdAt = first?.createdAt ?? Date.now();
      boards.set(DEFAULT_BOARD_ID, {
        id: DEFAULT_BOARD_ID,
        name: "Board 1",
        createdAt,
        updatedAt: createdAt,
      });
    }

    const titles = doc.getMap<Y.XmlFragment>(WorkspaceDocument.TITLES_KEY);
    for (const node of Array.from(legacyNodes.values())) {
      if (!titles.get(node.id)) {
        titles.set(node.id, new Y.XmlFragment());
      }
      if (!cards.get(node.id)) {
        cards.set(
          node.id,
          cardSchema.parse({
            id: node.id,
            kind: node.kind ?? "note",
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            connectors:
              Array.isArray(node.connectors) && node.connectors.length > 0
                ? node.connectors
                : defaultConnectors(),
            deletedAt: null,
            data: {},
          }),
        );
      }

      const key = placementKey(DEFAULT_BOARD_ID, node.id);
      if (!placements.get(key)) {
        placements.set(
          key,
          placementSchema.parse({
            boardId: DEFAULT_BOARD_ID,
            cardId: node.id,
            x: node.position?.x ?? 0,
            y: node.position?.y ?? 0,
            z: typeof node.z === "number" ? node.z : 0,
            createdAt: node.createdAt,
          }),
        );
      }
    }

    // The edges map keeps its key across the schema change, so snapshot before
    // writing back or the iterator skips entries.
    const edges = doc.getMap<GraphEdge>(WorkspaceDocument.EDGES_KEY);
    for (const edge of Array.from(legacyEdges.values())) {
      const existing = edges.get(edge.id);
      if (existing?.boardId) continue;
      edges.set(
        edge.id,
        graphEdgeSchema.parse({
          ...edge,
          path: edge.path ?? "bezier",
          bidirectional: edge.bidirectional ?? false,
          boardId: edge.boardId ?? DEFAULT_BOARD_ID,
        }),
      );
    }
  }

  // Titles are created lazily on read, so legacy cards get one on first mount.
  meta.set("schemaVersion", 1);
}

/**
 * Rewrites whole-record values (`cards: Record<id, Card>`) as nested field
 * maps. Field-granular storage is what stops two clients editing different
 * parts of the same card from clobbering each other; the schema change is
 * transparent because every read goes through a materialiser.
 */
export function migrateRecordsToFieldMaps(doc: Y.Doc): void {
  const meta = doc.getMap<unknown>(WorkspaceDocument.META_KEY);
  const version = meta.get("schemaVersion");
  if (typeof version === "number" && version >= SCHEMA_VERSION) return;

  const cards = doc.getMap<Fields>(WorkspaceDocument.CARDS_KEY);
  const placements = doc.getMap<Fields>(WorkspaceDocument.PLACEMENTS_KEY);
  const edges = doc.getMap<Fields>(WorkspaceDocument.EDGES_KEY);
  const boards = doc.getMap<Board>(WorkspaceDocument.BOARDS_KEY);
  const isEmpty =
    cards.size === 0 && placements.size === 0 && edges.size === 0 && boards.size === 0;
  if (isEmpty) {
    // Not hydrated yet: stamping here would skip migrating real data later.
    return;
  }

  let converted = false;
  const rewrite = <T>(
    map: Y.Map<Fields>,
    toFields: (value: T) => Fields,
    parse: (value: unknown) => T,
  ): void => {
    for (const [key, value] of Array.from(map.entries())) {
      if (isFields(value)) continue;
      map.set(key, toFields(parse(value)));
      converted = true;
    }
  };

  doc.transact(() => {
    rewrite(cards, fieldsOfCard, (value) => cardSchema.parse(value));
    rewrite(placements, fieldsOfPlacement, (value) => placementSchema.parse(value));
    rewrite(edges, fieldsOfEdge, (value) => graphEdgeSchema.parse(value));
  });

  if (converted) meta.set("schemaVersion", SCHEMA_VERSION);
}
