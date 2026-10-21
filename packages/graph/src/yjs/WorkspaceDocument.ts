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
const SCHEMA_VERSION = 1;

export function placementKey(boardId: string, cardId: string): string {
  return `${boardId}/${cardId}`;
}

function toAction(action: unknown): WorkspaceAction {
  return action === "add" || action === "delete" ? action : "update";
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
  private readonly cards: Y.Map<Card>;
  private readonly placements: Y.Map<Placement>;
  private readonly edges: Y.Map<GraphEdge>;
  private readonly content: Y.Map<Y.XmlFragment>;
  private readonly titles: Y.Map<Y.XmlFragment>;

  constructor(doc: Y.Doc = new Y.Doc()) {
    this.doc = doc;
    this.boards = doc.getMap<Board>(WorkspaceDocument.BOARDS_KEY);
    this.cards = doc.getMap<Card>(WorkspaceDocument.CARDS_KEY);
    this.placements = doc.getMap<Placement>(WorkspaceDocument.PLACEMENTS_KEY);
    this.edges = doc.getMap<GraphEdge>(WorkspaceDocument.EDGES_KEY);
    this.content = doc.getMap<Y.XmlFragment>(WorkspaceDocument.CONTENT_KEY);
    this.titles = doc.getMap<Y.XmlFragment>(WorkspaceDocument.TITLES_KEY);

    migrateLegacyDocument(doc);
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

    for (const [key, placement] of this.placements) {
      if (placement.boardId === id) this.placements.delete(key);
    }
    for (const [edgeId, edge] of this.edges) {
      if (edge.boardId === id) this.edges.delete(edgeId);
    }
    this.boards.delete(id);

    if (cardsOption === "trash") {
      const now = Date.now();
      for (const card of this.cards.values()) {
        if (card.deletedAt) continue;
        if (this.listCardPlacements(card.id).length > 0) continue;
        this.cards.set(card.id, { ...card, deletedAt: now, updatedAt: now });
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
    return Array.from(this.cards.values(), normalizeCard);
  }

  getCard(id: string): Card | undefined {
    const card = this.cards.get(id);
    return card ? normalizeCard(card) : undefined;
  }

  setCard(card: Card): void {
    this.cards.set(card.id, cardSchema.parse(normalizeCard(card)));
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

    this.setCard(card);
    this.getContent(card.id);
    this.getTitle(card.id);

    if (input.boardId) {
      this.placeCard(input.boardId, card.id, input.position ?? { x: 0, y: 0 });
    }
    return card;
  }

  isTrashed(cardId: string): boolean {
    return Boolean(this.getCard(cardId)?.deletedAt);
  }

  trashCard(id: string): void {
    const card = this.getCard(id);
    if (!card || card.deletedAt) return;
    const now = Date.now();
    this.setCard({ ...card, deletedAt: now, updatedAt: now });
  }

  restoreCard(id: string): void {
    const card = this.getCard(id);
    if (!card?.deletedAt) return;
    this.setCard({ ...card, deletedAt: null, updatedAt: Date.now() });
  }

  /** Destroys a card and everything that referenced it. Used by "delete forever". */
  purgeCard(id: string): void {
    this.cards.delete(id);
    for (const [key, placement] of this.placements) {
      if (placement.cardId === id) this.placements.delete(key);
    }
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) this.edges.delete(edgeId);
    }
    this.content.delete(id);
    this.titles.delete(id);
  }

  emptyTrash(): void {
    for (const card of this.listCards()) {
      if (card.deletedAt) this.purgeCard(card.id);
    }
  }

  getContent(cardId: string): Y.XmlFragment {
    const existing = this.content.get(cardId);
    if (existing) return existing;
    const fragment = new Y.XmlFragment();
    this.content.set(cardId, fragment);
    return fragment;
  }

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
    return Array.from(this.placements.values());
  }

  listCardPlacements(cardId: string): Placement[] {
    return this.listPlacements()
      .filter((placement) => placement.cardId === cardId)
      .sort((a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId));
  }

  getPlacement(boardId: string, cardId: string): Placement | undefined {
    return this.placements.get(placementKey(boardId, cardId));
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
      const moved: Placement = { ...existing, ...position };
      this.placements.set(placementKey(boardId, cardId), placementSchema.parse(moved));
      return moved;
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
    this.placements.set(placementKey(boardId, cardId), placementSchema.parse(placement));
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
    const placement = this.getPlacement(boardId, cardId);
    if (!placement) return;
    this.placements.set(
      placementKey(boardId, cardId),
      placementSchema.parse({ ...placement, ...position }),
    );
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

    order.forEach((entry, z) => {
      if (entry.z === z) return;
      this.placements.set(placementKey(boardId, entry.cardId), { ...entry, z });
    });
  }

  // ----------------------------------------------------------------- edges

  listEdges(): GraphEdge[] {
    return Array.from(this.edges.values(), normalizeEdge);
  }

  /**
   * Edges on a board that can be drawn: both endpoints are placed on it and
   * neither is trashed. Dormant edges stay in the CRDT and revive on return.
   */
  listBoardEdges(boardId: string): GraphEdge[] {
    const placed = new Set(this.listBoardCards(boardId).map((card) => card.id));
    return this.listEdges().filter(
      (edge) => edge.boardId === boardId && placed.has(edge.source) && placed.has(edge.target),
    );
  }

  getEdge(id: string): GraphEdge | undefined {
    const edge = this.edges.get(id);
    return edge ? normalizeEdge(edge) : undefined;
  }

  setEdge(edge: GraphEdge): void {
    this.edges.set(edge.id, graphEdgeSchema.parse(normalizeEdge(edge)));
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
    const edge = this.getEdge(id);
    if (!edge) return;
    this.setEdge({ ...edge, path, updatedAt: Date.now() });
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

    const next: GraphEdge = { ...edge, updatedAt: Date.now() };
    if (end === "source") {
      if (cardId === edge.target) return;
      next.source = cardId;
      if (connectorId) next.sourceConnector = connectorId;
      else delete next.sourceConnector;
    } else {
      if (cardId === edge.source) return;
      next.target = cardId;
      if (connectorId) next.targetConnector = connectorId;
      else delete next.targetConnector;
    }

    this.setEdge(next);
  }

  /** Swaps the endpoints (and their connectors) of an existing link. */
  reverseEdge(id: string): void {
    const edge = this.getEdge(id);
    if (!edge) return;

    const next: GraphEdge = {
      ...edge,
      source: edge.target,
      target: edge.source,
      updatedAt: Date.now(),
    };

    if (edge.sourceConnector) next.targetConnector = edge.sourceConnector;
    else delete next.targetConnector;
    if (edge.targetConnector) next.sourceConnector = edge.targetConnector;
    else delete next.sourceConnector;

    this.setEdge(next);
  }

  setEdgeBidirectional(id: string, bidirectional: boolean): void {
    const edge = this.getEdge(id);
    if (!edge) return;
    this.setEdge({ ...edge, bidirectional, updatedAt: Date.now() });
  }

  // ------------------------------------------------------------ connectors

  addConnector(cardId: string, position?: { x: number; y: number }): Connector | null {
    const card = this.getCard(cardId);
    if (!card) return null;

    const anchor = position ?? nextFreeAnchor(card.connectors);
    const connector: Connector = { id: createConnectorId(), ...anchor };
    this.setCard({
      ...card,
      connectors: [...card.connectors, connector],
      updatedAt: Date.now(),
    });
    return connector;
  }

  removeConnector(cardId: string, connectorId: string): void {
    const card = this.getCard(cardId);
    if (!card) return;
    this.setCard({
      ...card,
      connectors: card.connectors.filter((connector) => connector.id !== connectorId),
      updatedAt: Date.now(),
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
    this.setCard({
      ...card,
      connectors: card.connectors.map((connector) =>
        connector.id === connectorId ? { ...connector, ...next } : connector,
      ),
      updatedAt: Date.now(),
    });
  }

  // -------------------------------------------------------------- observe

  observe(onChange: (change: WorkspaceChange) => void): () => void {
    const watch = <T>(
      map: Y.Map<T>,
      section: WorkspaceSection,
      read: (key: string) => WorkspaceChange["value"],
    ) => {
      const handler = (event: Y.YMapEvent<T>): void => {
        event.keysChanged.forEach((key) => {
          const action = toAction(event.changes.keys.get(key)?.action);
          onChange({ section, action, key, value: read(key) });
        });
      };
      map.observe(handler);
      return () => map.unobserve(handler);
    };

    return combine([
      watch(this.boards, "boards", (key) => this.boards.get(key) ?? null),
      watch(this.cards, "cards", (key) => {
        const card = this.cards.get(key);
        return card ? normalizeCard(card) : null;
      }),
      watch(this.placements, "placements", (key) => this.placements.get(key) ?? null),
      watch(this.edges, "edges", (key) => {
        const edge = this.edges.get(key);
        return edge ? normalizeEdge(edge) : null;
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

  const legacyNodes = doc.getMap<LegacyNode>("nodes");
  const legacyEdges = doc.getMap<GraphEdge>("edges");
  if (legacyNodes.size > 0) {
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

    for (const node of Array.from(legacyNodes.values())) {
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
  meta.set("schemaVersion", SCHEMA_VERSION);
}
