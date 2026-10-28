import { LoroDoc, type LoroMap, type Value } from "loro-crdt";
import type { Drawing, DrawingElement } from "../drawings.js";
import type { HistoryPoint, HistoryRestorePreview } from "../history.js";
import type { ApplyLayoutPlanOptions, LayoutPlan, LayoutPlanSummary } from "../layoutPlan.js";
import type {
  Board,
  Card,
  CardType,
  Connector,
  EdgeEndpointKind,
  FieldDefinition,
  GraphEdge,
  Placement,
  Section,
  SelectOption,
  Tag,
} from "../schema.js";
import type { PaletteSwatch, SurfaceStyle } from "../style.js";
import type { SavedView, ViewQuery } from "../views.js";
import type { DocApi } from "./api.js";
import { createDocApi } from "./api.js";
import { DocContext } from "./context.js";
import { CardsFacade } from "./facade/cards.js";
import { STRUCT_KEYS } from "./keys.js";
import type {
  CreateEdgeInput,
  CreateFieldInput,
  CreateSectionInput,
  CreateTypeInput,
  CreateViewInput,
  DuplicateBoardOptions,
  LayerAction,
  PlacementMoveInput,
  WorkspaceChange,
} from "./model.js";

export { cardFromMap, normalizeCard } from "../records/cards.js";
export {
  cardTypeFromMap,
  edgeFromMap,
  fieldFromMap,
  placementFromMap,
  sectionFromMap,
  tagFromMap,
} from "../records/entities.js";
export { readBends, readSurfaceStyle } from "../records/values.js";
export {
  CONNECTORS_FIELD,
  cleanWorkspaceName,
  DEFAULT_BOARD_ID,
  DEFAULT_WORKSPACE_NAME,
  INDEX_ORIGIN,
  INIT_ORIGIN,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  PROPERTY_BLOCK_NODE_NAME,
  placementKey,
  SCHEMA_VERSION,
  TEXT_ORIGIN_PREFIX,
  WORKSPACE_NAME_MAX_LENGTH,
  workspaceNameProblem,
} from "./constants.js";
export type {
  CardContainers,
  CardFieldView,
  CreateCardInput,
  CreateEdgeInput,
  CreateFieldInput,
  CreatePortalCardInput,
  CreateSectionInput,
  CreateTypeInput,
  CreateViewInput,
  DuplicateBoardOptions,
  DuplicateCardOptions,
  LayerAction,
  PlacementMoveInput,
  WorkspaceAction,
  WorkspaceChange,
  WorkspaceSection,
} from "./model.js";

/** Binds every root of `doc` to the context the domain modules read through. */
function openContext(doc: LoroDoc): DocContext {
  return new DocContext(doc, {
    boards: doc.getMap(WorkspaceDocument.BOARDS_KEY),
    cards: doc.getMap(WorkspaceDocument.CARDS_KEY),
    placements: doc.getMap(WorkspaceDocument.PLACEMENTS_KEY),
    edges: doc.getMap(WorkspaceDocument.EDGES_KEY),
    types: doc.getMap(WorkspaceDocument.TYPES_KEY),
    tags: doc.getMap(WorkspaceDocument.TAGS_KEY),
    sections: doc.getMap(WorkspaceDocument.SECTIONS_KEY),
    content: doc.getMap(WorkspaceDocument.CONTENT_KEY),
    titles: doc.getMap(WorkspaceDocument.TITLES_KEY),
    references: doc.getMap(WorkspaceDocument.REFERENCES_KEY),
    meta: doc.getMap(WorkspaceDocument.META_KEY),
    viewsMap: doc.getMap(WorkspaceDocument.VIEWS_KEY),
    drawings: doc.getMap(WorkspaceDocument.DRAWINGS_KEY),
  });
}

/**
 * The document facade: roots, workspace metadata, boards, views, types, tags, sections,
 * placements, edges and drawings. The card domain lives in {@link CardsFacade}, which this
 * class extends, so every method stays on one prototype.
 */
export class WorkspaceDocument extends CardsFacade {
  static readonly BOARDS_KEY = STRUCT_KEYS.boards;
  static readonly CARDS_KEY = STRUCT_KEYS.cards;
  static readonly PLACEMENTS_KEY = STRUCT_KEYS.placements;
  static readonly EDGES_KEY = STRUCT_KEYS.edges;
  static readonly TYPES_KEY = STRUCT_KEYS.types;
  static readonly TAGS_KEY = STRUCT_KEYS.tags;
  static readonly SECTIONS_KEY = STRUCT_KEYS.sections;
  static readonly CONTENT_KEY = STRUCT_KEYS.content;
  static readonly TITLES_KEY = STRUCT_KEYS.titles;
  static readonly REFERENCES_KEY = STRUCT_KEYS.references;
  static readonly META_KEY = STRUCT_KEYS.meta;
  static readonly VIEWS_KEY = STRUCT_KEYS.views;
  static readonly DRAWINGS_KEY = "drawings";

  /** Every root map a document holds, in the order a projection replaces them. */
  static readonly ROOT_KEYS = [
    WorkspaceDocument.BOARDS_KEY,
    WorkspaceDocument.CARDS_KEY,
    WorkspaceDocument.PLACEMENTS_KEY,
    WorkspaceDocument.EDGES_KEY,
    WorkspaceDocument.TYPES_KEY,
    WorkspaceDocument.TAGS_KEY,
    WorkspaceDocument.SECTIONS_KEY,
    WorkspaceDocument.CONTENT_KEY,
    WorkspaceDocument.TITLES_KEY,
    WorkspaceDocument.REFERENCES_KEY,
    WorkspaceDocument.META_KEY,
    WorkspaceDocument.VIEWS_KEY,
    WorkspaceDocument.DRAWINGS_KEY,
  ] as const;

  private readonly ctx: DocContext;
  private readonly undoApi: DocApi["undo"];
  private readonly workspaceApi: DocApi["workspace"];
  private readonly boardsApi: DocApi["boards"];
  private readonly viewsApi: DocApi["views"];
  private readonly cardTypesApi: DocApi["cardTypes"];
  private readonly tagsApi: DocApi["tags"];
  private readonly sectionsApi: DocApi["sections"];
  private readonly placementsApi: DocApi["placements"];
  private readonly edgesApi: DocApi["edges"];
  private readonly historyApi: DocApi["history"];
  private readonly drawingsApi: DocApi["drawings"];
  private readonly snapshotApi: DocApi["snapshot"];

  constructor(doc: LoroDoc = new LoroDoc()) {
    const ctx = openContext(doc);
    const api = createDocApi(ctx);
    super(api.cards);
    this.ctx = ctx;
    this.undoApi = api.undo;
    this.workspaceApi = api.workspace;
    this.boardsApi = api.boards;
    this.viewsApi = api.views;
    this.cardTypesApi = api.cardTypes;
    this.tagsApi = api.tags;
    this.sectionsApi = api.sections;
    this.placementsApi = api.placements;
    this.edgesApi = api.edges;
    this.historyApi = api.history;
    this.drawingsApi = api.drawings;
    this.snapshotApi = api.snapshot;
    this.ctx.attach();
  }

  /** The Loro document this facade reads and writes. */
  get doc(): LoroDoc {
    return this.ctx.doc;
  }

  /**
   * The drawings root of a document. A share projection copies scenes into a
   * second doc, and this is the only way to name that root outside the facade.
   */
  static drawingRoot(doc: LoroDoc): LoroMap {
    return doc.getMap(WorkspaceDocument.DRAWINGS_KEY);
  }

  batch<T>(origin: string, fn: () => T): T {
    return this.ctx.batch(origin, fn);
  }

  undo(): void {
    this.undoApi.undo();
  }

  redo(): void {
    this.undoApi.redo();
  }

  canUndo(): boolean {
    return this.undoApi.canUndo();
  }

  canRedo(): boolean {
    return this.undoApi.canRedo();
  }

  /** Saved points, newest first; the first one is the document as it stands. */
  listHistoryPoints(limit?: number): HistoryPoint[] {
    return this.historyApi.listHistoryPoints(limit);
  }

  getHistoryPoint(pointId: string): HistoryPoint | null {
    return this.historyApi.getHistoryPoint(pointId);
  }

  /** What restoring one point would add, remove and rewrite. Writes nothing. */
  previewRestore(pointId: string): HistoryRestorePreview | null {
    return this.historyApi.previewRestore(pointId);
  }

  /** Restores a point as one undoable change every peer receives. */
  restoreToPoint(pointId: string): HistoryRestorePreview | null {
    return this.historyApi.restoreToPoint(pointId);
  }

  stopCapturing(): void {
    this.undoApi.stopCapturing();
  }

  hasSeeded(): boolean {
    return this.workspaceApi.hasSeeded();
  }

  markSeeded(): void {
    this.workspaceApi.markSeeded();
  }

  hasWorkspaceName(): boolean {
    return this.workspaceApi.hasWorkspaceName();
  }

  workspaceName(): string {
    return this.workspaceApi.workspaceName();
  }

  renameWorkspace(name: string): void {
    this.workspaceApi.renameWorkspace(name);
  }

  palette(): PaletteSwatch[] {
    return this.workspaceApi.palette();
  }

  setPalette(palette: readonly PaletteSwatch[]): void {
    this.workspaceApi.setPalette(palette);
  }

  observeWorkspaceMeta(listener: () => void): () => void {
    return this.workspaceApi.observeWorkspaceMeta(listener);
  }

  listBoards(): Board[] {
    return this.boardsApi.listBoards();
  }

  getBoard(id: string): Board | undefined {
    return this.boardsApi.getBoard(id);
  }

  createBoard(input: { id?: string; name?: string } = {}): Board {
    return this.boardsApi.createBoard(input);
  }

  renameBoard(id: string, name: string): void {
    this.boardsApi.renameBoard(id, name);
  }

  setBoardIcon(id: string, icon: string | null): void {
    this.boardsApi.setBoardIcon(id, icon);
  }

  setBoardColor(id: string, color: Board["color"] | null): void {
    this.boardsApi.setBoardColor(id, color);
  }

  setBoardTemplate(id: string, template: boolean): void {
    this.boardsApi.setBoardTemplate(id, template);
  }

  setBoardCover(id: string, attachmentId: string | null): void {
    this.boardsApi.setBoardCover(id, attachmentId);
  }

  setBoardTags(id: string, tagIds: readonly string[]): void {
    this.boardsApi.setBoardTags(id, tagIds);
  }

  addBoardTag(id: string, tagId: string): void {
    this.boardsApi.addBoardTag(id, tagId);
  }

  removeBoardTag(id: string, tagId: string): void {
    this.boardsApi.removeBoardTag(id, tagId);
  }

  setPortalTarget(cardId: string, boardId: string | null): void {
    this.boardsApi.setPortalTarget(cardId, boardId);
  }

  deleteBoard(id: string, options: { cards?: "keep" | "trash" } = {}): void {
    this.boardsApi.deleteBoard(id, options);
  }

  ensureBoard(): Board {
    return this.boardsApi.ensureBoard();
  }

  duplicateBoard(sourceId: string, options: DuplicateBoardOptions = {}): Board | null {
    return this.boardsApi.duplicateBoard(sourceId, options);
  }

  listViews(): SavedView[] {
    return this.viewsApi.listViews();
  }

  getView(id: string): SavedView | undefined {
    return this.viewsApi.getView(id);
  }

  createView(input: CreateViewInput): SavedView {
    return this.viewsApi.createView(input);
  }

  updateView(id: string, patch: { name?: string; query?: ViewQuery }): SavedView | undefined {
    return this.viewsApi.updateView(id, patch);
  }

  deleteView(id: string): void {
    this.viewsApi.deleteView(id);
  }

  moveView(id: string, position: number): void {
    this.viewsApi.moveView(id, position);
  }

  observeViews(listener: () => void): () => void {
    return this.viewsApi.observeViews(listener);
  }

  get viewsRevision(): number {
    return this.viewsApi.viewsRevision;
  }

  listTypes(): CardType[] {
    return this.cardTypesApi.listTypes();
  }

  getType(id: string): CardType | undefined {
    return this.cardTypesApi.getType(id);
  }

  createType(input: CreateTypeInput): CardType {
    return this.cardTypesApi.createType(input);
  }

  updateType(
    id: string,
    patch: {
      name?: string;
      pluralName?: string | null;
      glyph?: string;
      /** An icon reference; `null` clears it and the glyph draws instead. */
      icon?: string | null;
      color?: string | null;
      /** The default paint for every card of this type; `null` clears it. */
      style?: SurfaceStyle | null;
      /** `null` clears the template; a card id points at the template card. */
      templateCardId?: string | null;
    },
  ): void {
    this.cardTypesApi.updateType(id, patch);
  }

  deleteType(id: string, options: { reassignTo?: string } = {}): number {
    return this.cardTypesApi.deleteType(id, options);
  }

  ensureDefaultTypes(): void {
    this.cardTypesApi.ensureDefaultTypes();
  }

  addField(typeId: string, input: CreateFieldInput): FieldDefinition {
    return this.cardTypesApi.addField(typeId, input);
  }

  updateField(
    typeId: string,
    fieldId: string,
    patch: { name?: string; required?: boolean; display?: string | null },
  ): void {
    this.cardTypesApi.updateField(typeId, fieldId, patch);
  }

  removeField(typeId: string, fieldId: string): void {
    this.cardTypesApi.removeField(typeId, fieldId);
  }

  moveField(typeId: string, fieldId: string, toIndex: number): void {
    this.cardTypesApi.moveField(typeId, fieldId, toIndex);
  }

  addSelectOption(
    typeId: string,
    fieldId: string,
    input: { label: string; color?: string },
  ): SelectOption {
    return this.cardTypesApi.addSelectOption(typeId, fieldId, input);
  }

  updateSelectOption(
    typeId: string,
    fieldId: string,
    optionId: string,
    patch: { label?: string; color?: string | null },
  ): void {
    this.cardTypesApi.updateSelectOption(typeId, fieldId, optionId, patch);
  }

  removeSelectOption(typeId: string, fieldId: string, optionId: string): void {
    this.cardTypesApi.removeSelectOption(typeId, fieldId, optionId);
  }

  listTags(): Tag[] {
    return this.tagsApi.listTags();
  }

  getTag(id: string): Tag | undefined {
    return this.tagsApi.getTag(id);
  }

  findTagByName(name: string): Tag | undefined {
    return this.tagsApi.findTagByName(name);
  }

  createTag(input: { name: string; color?: string }): Tag {
    return this.tagsApi.createTag(input);
  }

  ensureTag(name: string): Tag {
    return this.tagsApi.ensureTag(name);
  }

  renameTag(id: string, name: string): void {
    this.tagsApi.renameTag(id, name);
  }

  deleteTag(id: string): void {
    this.tagsApi.deleteTag(id);
  }

  listSections(boardId?: string): Section[] {
    return this.sectionsApi.listSections(boardId);
  }

  getSection(id: string): Section | undefined {
    return this.sectionsApi.getSection(id);
  }

  createSection(input: CreateSectionInput): Section {
    return this.sectionsApi.createSection(input);
  }

  renameSection(id: string, title: string): void {
    this.sectionsApi.renameSection(id, title);
  }

  setSectionColor(id: string, color: Section["color"] | null): void {
    this.sectionsApi.setSectionColor(id, color);
  }

  setSectionTags(id: string, tagIds: readonly string[]): void {
    this.sectionsApi.setSectionTags(id, tagIds);
  }

  addSectionTag(id: string, tagId: string): void {
    this.sectionsApi.addSectionTag(id, tagId);
  }

  removeSectionTag(id: string, tagId: string): void {
    this.sectionsApi.removeSectionTag(id, tagId);
  }

  updateSectionGeometry(id: string, rect: Pick<Section, "x" | "y" | "width" | "height">): void {
    this.sectionsApi.updateSectionGeometry(id, rect);
  }

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
    this.sectionsApi.moveSectionsBatch(input);
  }

  deleteSection(id: string): void {
    this.sectionsApi.deleteSection(id);
  }

  addSectionConnector(sectionId: string, position?: { x: number; y: number }): Connector | null {
    return this.sectionsApi.addSectionConnector(sectionId, position);
  }

  removeSectionConnector(sectionId: string, connectorId: string): void {
    this.sectionsApi.removeSectionConnector(sectionId, connectorId);
  }

  moveSectionConnector(
    sectionId: string,
    connectorId: string,
    position: { x: number; y: number },
    options: { snap?: boolean } = {},
  ): void {
    this.sectionsApi.moveSectionConnector(sectionId, connectorId, position, options);
  }

  listPlacements(): Placement[] {
    return this.placementsApi.listPlacements();
  }

  getPlacementByKey(key: string): Placement | undefined {
    return this.placementsApi.getPlacementByKey(key);
  }

  listCardPlacements(cardId: string): Placement[] {
    return this.placementsApi.listCardPlacements(cardId);
  }

  getPlacement(boardId: string, cardId: string): Placement | undefined {
    return this.placementsApi.getPlacement(boardId, cardId);
  }

  homeBoardId(cardId: string): string | null {
    return this.placementsApi.homeBoardId(cardId);
  }

  listBoardPlacements(boardId: string): Placement[] {
    return this.placementsApi.listBoardPlacements(boardId);
  }

  listBoardCards(boardId: string): Card[] {
    return this.placementsApi.listBoardCards(boardId);
  }

  listInboxCards(): Card[] {
    return this.placementsApi.listInboxCards();
  }

  listTrashedCards(): Card[] {
    return this.placementsApi.listTrashedCards();
  }

  placeCard(boardId: string, cardId: string, position: { x: number; y: number }): Placement | null {
    return this.placementsApi.placeCard(boardId, cardId, position);
  }

  unplaceCard(boardId: string, cardId: string): void {
    this.placementsApi.unplaceCard(boardId, cardId);
  }

  updatePlacementPosition(
    boardId: string,
    cardId: string,
    position: { x: number; y: number },
  ): void {
    this.placementsApi.updatePlacementPosition(boardId, cardId, position);
  }

  movePlacements(boardId: string, moves: PlacementMoveInput[]): void {
    this.placementsApi.movePlacements(boardId, moves);
  }

  updatePlacementSize(
    boardId: string,
    cardId: string,
    size: { width: number; height: number },
  ): void {
    this.placementsApi.updatePlacementSize(boardId, cardId, size);
  }

  updatePlacementGeometry(
    boardId: string,
    cardId: string,
    geometry: { x: number; y: number; width: number; height: number },
  ): void {
    this.placementsApi.updatePlacementGeometry(boardId, cardId, geometry);
  }

  applyLayoutPlan(plan: LayoutPlan, options: ApplyLayoutPlanOptions = {}): LayoutPlanSummary {
    return this.placementsApi.applyLayoutPlan(plan, options);
  }

  moveLayer(boardId: string, cardId: string, action: LayerAction): void {
    this.placementsApi.moveLayer(boardId, cardId, action);
  }

  listEdges(): GraphEdge[] {
    return this.edgesApi.listEdges();
  }

  listBoardEdges(boardId: string): GraphEdge[] {
    return this.edgesApi.listBoardEdges(boardId);
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.edgesApi.getEdge(id);
  }

  setEdge(edge: GraphEdge): void {
    this.edgesApi.setEdge(edge);
  }

  addEdge(input: CreateEdgeInput): GraphEdge | null {
    return this.edgesApi.addEdge(input);
  }

  /**
   * Drops every link but one over each pair, keeping the most recently written: the
   * one the reader drew last. Older documents accumulated copies while a link's
   * identity was its dots; this heals them when a workspace is opened.
   */
  pruneDuplicateLinks(): number {
    return this.edgesApi.pruneDuplicateLinks();
  }

  listLinksTo(kind: EdgeEndpointKind, id: string): GraphEdge[] {
    return this.edgesApi.listLinksTo(kind, id);
  }

  setEdgeEndpointKind(id: string, end: "source" | "target", kind: EdgeEndpointKind): void {
    this.edgesApi.setEdgeEndpointKind(id, end, kind);
  }

  removeEdge(id: string): void {
    this.edgesApi.removeEdge(id);
  }

  setEdgePath(id: string, path: GraphEdge["path"]): void {
    this.edgesApi.setEdgePath(id, path);
  }

  setEdgeRoute(
    id: string,
    route: {
      bends?: { x: number; y: number }[] | undefined;
      layer?: "below" | "above" | undefined;
    },
  ): void {
    this.edgesApi.setEdgeRoute(id, route);
  }

  setEdgeStyle(id: string, style: SurfaceStyle | null): void {
    this.edgesApi.setEdgeStyle(id, style);
  }

  reconnectEdge(
    id: string,
    end: "source" | "target",
    cardId: string,
    connectorId: string | undefined,
    kind: EdgeEndpointKind = "card",
  ): void {
    this.edgesApi.reconnectEdge(id, end, cardId, connectorId, kind);
  }

  reverseEdge(id: string): void {
    this.edgesApi.reverseEdge(id);
  }

  setEdgeLabel(id: string, label: string | null): void {
    this.edgesApi.setEdgeLabel(id, label);
  }

  setEdgeLabelOffset(id: string, offset: number | null): void {
    this.edgesApi.setEdgeLabelOffset(id, offset);
  }

  setEdgeBidirectional(id: string, bidirectional: boolean): void {
    this.edgesApi.setEdgeBidirectional(id, bidirectional);
  }

  addConnector(cardId: string, position?: { x: number; y: number }): Connector | null {
    return this.edgesApi.addConnector(cardId, position);
  }

  removeConnector(cardId: string, connectorId: string): void {
    this.edgesApi.removeConnector(cardId, connectorId);
  }

  moveConnector(
    cardId: string,
    connectorId: string,
    position: { x: number; y: number },
    options: { snap?: boolean } = {},
  ): void {
    this.edgesApi.moveConnector(cardId, connectorId, position, options);
  }

  drawing(cardId: string): Drawing | null {
    return this.drawingsApi.drawing(cardId);
  }

  setDrawing(
    cardId: string,
    elements: readonly DrawingElement[],
    order?: readonly string[],
  ): Drawing {
    return this.drawingsApi.setDrawing(cardId, elements, order);
  }

  applyDrawing(
    cardId: string,
    elements: readonly DrawingElement[],
    order?: readonly string[],
  ): Drawing | null {
    return this.drawingsApi.applyDrawing(cardId, elements, order);
  }

  upsertDrawingElement(cardId: string, element: DrawingElement): DrawingElement {
    return this.drawingsApi.upsertDrawingElement(cardId, element);
  }

  removeDrawingElement(cardId: string, elementId: string): void {
    this.drawingsApi.removeDrawingElement(cardId, elementId);
  }

  purgeDrawingElement(cardId: string, elementId: string): void {
    this.drawingsApi.purgeDrawingElement(cardId, elementId);
  }

  setDrawingOrder(cardId: string, order: readonly string[]): void {
    this.drawingsApi.setDrawingOrder(cardId, order);
  }

  clearDrawing(cardId: string): void {
    this.drawingsApi.clearDrawing(cardId);
  }

  observe(onChange: (change: WorkspaceChange) => void): () => void {
    return this.snapshotApi.observe(onChange);
  }

  exportUpdate(): Uint8Array {
    return this.snapshotApi.exportUpdate();
  }

  importUpdate(update: Uint8Array): void {
    this.snapshotApi.importUpdate(update);
  }

  exportSnapshot(): Uint8Array {
    return this.snapshotApi.exportSnapshot();
  }

  importSnapshot(snapshot: Uint8Array): void {
    this.snapshotApi.importSnapshot(snapshot);
  }

  toJSON(): Record<string, Value> {
    return this.snapshotApi.toJSON();
  }
}
