import { getType, isContainer, LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import { placementKey, SCHEMA_VERSION, WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import type { ReferenceIndex } from "./references.js";
import { mentionTargets, outgoingReferences } from "./references.js";
import type { Card, Placement, Section } from "./schema.js";
import { cardAnchor, sectionsAt } from "./sections.js";

/** What a share link exposes: one board, a selection of its cards, or one card. */
export type ShareScope = "board" | "selection" | "card";

/** The board a single-card projection lives on. */
export const SHARE_BOARD_ID = "share-board";
export const SHARE_BOARD_NAME = "Shared card";

const PROJECTION_ORIGIN = "sys:projection";

export interface ProjectionReference {
  cardId: string;
  title: string;
  direction: "in" | "out";
  kind: "mention" | "property" | "arrow";
  /** True when the referenced card is not part of the projection. */
  private: boolean;
}

export interface ProjectionResult {
  workspace: WorkspaceDocument;
  references: ProjectionReference[];
}

/** Stand-in title for a card a board share may not name. */
export const PRIVATE_REFERENCE_TITLE = "Private card";

export type ProjectionOptions =
  | { scope: "board"; boardId: string }
  | { scope: "card"; cardId: string }
  | { scope: "selection"; boardId: string; cardIds: readonly string[] };

function isMap(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isList(value: unknown): value is LoroList {
  return isContainer(value) && getType(value) === "List";
}

function isText(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

/** A value Loro stores inline rather than as a child container. */
function isScalar(value: unknown): value is string | number | boolean | null | Uint8Array {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  );
}

/**
 * Copy one map's entries into another map, including the container structure
 * rich text depends on. Containers become mergeable children so copying the
 * same key twice lands on the same child instead of forking it.
 */
function copyMap(source: LoroMap, target: LoroMap): void {
  for (const [key, value] of source.entries()) {
    if (isMap(value)) {
      copyMap(value, target.ensureMergeableMap(key));
      continue;
    }
    if (isList(value)) {
      copyList(value, target.ensureMergeableList(key));
      continue;
    }
    if (isText(value)) {
      copyText(value, target.ensureMergeableText(key));
      continue;
    }
    if (isScalar(value)) target.set(key, value);
  }
}

/** List items are inserted as new containers so their order is preserved. */
function copyList(source: LoroList, target: LoroList): void {
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      copyMap(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isList(value)) {
      copyList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      copyText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (isScalar(value)) target.insert(index, value);
  });
}

/** Text carries marks in its delta; attributes survive the round trip. */
function copyText(source: LoroText, target: LoroText): void {
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
}

/** Copy the map stored under `key`, skipping keys that hold nothing copyable. */
function copyEntry(source: LoroMap, target: LoroMap, key: string): void {
  const value = source.get(key);
  if (isMap(value)) copyMap(value, target.ensureMergeableMap(key));
}

function copyMeta(source: LoroDoc, target: LoroDoc): void {
  const from = source.getMap(WorkspaceDocument.META_KEY);
  const to = target.getMap(WorkspaceDocument.META_KEY);
  for (const [key, value] of from.entries()) {
    if (isScalar(value)) to.set(key, value);
  }
  if (to.get("schemaVersion") === undefined) to.set("schemaVersion", SCHEMA_VERSION);
}

/**
 * The mention index the projection needs, parsed from live text instead of the
 * workspace's derived index: a share can be built before the coalescing
 * microtask that refreshes the stored index has run.
 */
function mentionIndex(source: WorkspaceDocument, cards: readonly Card[]): ReferenceIndex {
  const index: Record<string, string[]> = {};
  for (const card of cards) {
    const targets = mentionTargets([source.peekTitle(card.id), source.peekContent(card.id)]);
    if (targets.length > 0) index[card.id] = targets;
  }
  return index;
}

/** Copies the cards, their content and the schema they depend on. */
function copyCards(source: WorkspaceDocument, target: LoroDoc, copied: ReadonlySet<string>): void {
  const sourceCards = source.doc.getMap(WorkspaceDocument.CARDS_KEY);
  const sourceTypes = source.doc.getMap(WorkspaceDocument.TYPES_KEY);
  const sourceTags = source.doc.getMap(WorkspaceDocument.TAGS_KEY);
  const sourceContent = source.doc.getMap(WorkspaceDocument.CONTENT_KEY);
  const sourceTitles = source.doc.getMap(WorkspaceDocument.TITLES_KEY);
  const targetCards = target.getMap(WorkspaceDocument.CARDS_KEY);
  const targetTypes = target.getMap(WorkspaceDocument.TYPES_KEY);
  const targetTags = target.getMap(WorkspaceDocument.TAGS_KEY);
  const targetContent = target.getMap(WorkspaceDocument.CONTENT_KEY);
  const targetTitles = target.getMap(WorkspaceDocument.TITLES_KEY);

  const typeIds = new Set<string>();
  const tagIds = new Set<string>();

  for (const cardId of [...copied].sort()) {
    const card = source.getCard(cardId);
    if (!card) continue;
    copyEntry(sourceCards, targetCards, cardId);
    for (const typeId of card.typeIds) typeIds.add(typeId);
    for (const tagId of card.tags) tagIds.add(tagId);
    copyEntry(sourceContent, targetContent, cardId);
    copyEntry(sourceTitles, targetTitles, cardId);
  }

  // Only the schema the shared cards actually use travels with them.
  for (const typeId of [...typeIds].sort()) copyEntry(sourceTypes, targetTypes, typeId);
  for (const tagId of [...tagIds].sort()) copyEntry(sourceTags, targetTags, tagId);
}

function collectReferences(
  source: WorkspaceDocument,
  copied: ReadonlySet<string>,
  redactPrivateTitles: boolean,
): ProjectionReference[] {
  const trashed = new Set(source.listTrashedCards().map((card) => card.id));
  const cards = source.listCards().filter((card) => !card.deletedAt);
  const types = source.listTypes();
  const edges = source
    .listEdges()
    .filter((edge) => !trashed.has(edge.source) && !trashed.has(edge.target));
  const mentions = mentionIndex(source, cards);

  const seen = new Set<string>();
  const rows: ProjectionReference[] = [];

  const add = (
    cardId: string,
    direction: "in" | "out",
    kind: ProjectionReference["kind"],
  ): void => {
    if (trashed.has(cardId)) return;
    const dedupe = `${cardId}\u0000${direction}\u0000${kind}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    // A board share may say a link exists but not name the off-board card it
    // points at. A card share shows those titles as inert context.
    const isPrivate = !copied.has(cardId);
    rows.push({
      cardId,
      title:
        isPrivate && redactPrivateTitles ? PRIVATE_REFERENCE_TITLE : source.displayTitle(cardId),
      direction,
      kind,
      private: isPrivate,
    });
  };

  // One pass builds the adjacency this loop reads. Asking the per-card helpers
  // for every copied card re-scans the whole workspace each time, which made a
  // 5 000-card board cost ~19 s per rebuild instead of well under a second:
  // `incomingReferences`, `propertySources` and `arrowSources` were O(cards),
  // O(cards) and O(edges) per card.
  const mentionIn = new Map<string, string[]>();
  for (const [originId, targets] of Object.entries(mentions)) {
    for (const targetId of targets) {
      const list = mentionIn.get(targetId);
      if (list) list.push(originId);
      else mentionIn.set(targetId, [originId]);
    }
  }

  const fieldKinds = new Map<string, string>();
  for (const type of types) {
    for (const field of type.fields) fieldKinds.set(field.id, field.kind);
  }
  const propertyOut = new Map<string, string[]>();
  const propertyIn = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const card of cards) {
    for (const [fieldId, value] of Object.entries(card.properties)) {
      if (typeof value !== "string" || value.length === 0) continue;
      // An unknown field is kept, so a missing type definition never hides a link.
      const kind = fieldKinds.get(fieldId);
      if (kind !== undefined && kind !== "card") continue;
      // `outgoingPropertyLinks` excludes a self-link; `propertySources` does not.
      if (value !== card.id) push(propertyOut, card.id, value);
      push(propertyIn, value, card.id);
    }
  }

  const arrowOut = new Map<string, string[]>();
  const arrowIn = new Map<string, string[]>();
  for (const edge of edges) {
    push(arrowOut, edge.source, edge.target);
    push(arrowIn, edge.target, edge.source);
  }

  for (const cardId of [...copied].sort()) {
    for (const targetId of outgoingReferences(cardId, mentions)) add(targetId, "out", "mention");
    for (const originId of mentionIn.get(cardId) ?? []) add(originId, "in", "mention");
    for (const targetId of propertyOut.get(cardId) ?? []) add(targetId, "out", "property");
    for (const originId of propertyIn.get(cardId) ?? []) add(originId, "in", "property");
    for (const otherId of arrowOut.get(cardId) ?? []) add(otherId, "out", "arrow");
    for (const otherId of arrowIn.get(cardId) ?? []) add(otherId, "in", "arrow");
  }

  return rows.sort(
    (a, b) =>
      a.cardId.localeCompare(b.cardId) ||
      a.direction.localeCompare(b.direction) ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Gives every out-of-share reference a title container, so the viewer reads the
 * row's label from the projection instead of falling back to "Untitled". Only
 * the title is written: the stub has no card record, content, placement or
 * type, so it stays non-navigable.
 */
function writeReferenceTitleStubs(
  workspace: WorkspaceDocument,
  references: readonly ProjectionReference[],
  copied: ReadonlySet<string>,
): void {
  const titles = workspace.doc.getMap(WorkspaceDocument.TITLES_KEY);
  const written = new Set<string>();

  for (const reference of references) {
    if (copied.has(reference.cardId) || written.has(reference.cardId)) continue;
    written.add(reference.cardId);

    const root = titles.ensureMergeableMap(reference.cardId);
    root.set("nodeName", "doc");
    root.ensureMergeableMap("attributes");
    const blocks = root.ensureMergeableList("children");
    const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    const text = inline.insertContainer(0, new LoroText());
    text.insert(0, reference.title);
  }
}

/**
 * Sections a selection share keeps: every section whose rectangle holds a
 * copied card's anchor. `sectionsAt` returns every containing section, so a
 * nested card's ancestors travel with it. Geometry is copied untouched, so the
 * viewer derives the same membership from the same coordinates.
 */
function selectionSections(placements: readonly Placement[], sections: Section[]): Section[] {
  const kept = new Set<string>();
  for (const placement of placements) {
    for (const section of sectionsAt(cardAnchor(placement), sections)) kept.add(section.id);
  }
  return sections.filter((section) => kept.has(section.id));
}

/**
 * Builds a self-contained workspace for a share link. The projection owns a
 * fresh document, so nothing the source holds outside the selected scope can
 * leak into it; references to cards left out are reported with `private: true`
 * instead of being copied. A board share redacts those titles; a card or
 * selection share keeps them, because the viewer shows them as inert context.
 *
 * A card share is rejected when the card is missing or in the trash: there is
 * nothing to publish, and an empty `share-board` would look like a real, empty
 * board to the viewer. A selection share with no ids is rejected as invalid
 * input, but one whose cards all left the board projects an empty board.
 */
export function projectWorkspace(
  source: WorkspaceDocument,
  options: ProjectionOptions,
): ProjectionResult {
  if (options.scope === "selection" && options.cardIds.length === 0) {
    throw new Error("A selection share needs at least one card");
  }

  const doc = new LoroDoc();
  const workspace = new WorkspaceDocument(doc);
  copyMeta(source.doc, doc);

  const copied = new Set<string>();
  let boardId: string;
  let placements: readonly Placement[] = [];

  if (options.scope === "card") {
    const card = source.getCard(options.cardId);
    if (!card) throw new Error(`Unknown card: ${options.cardId}`);
    if (card.deletedAt) throw new Error(`Card is in the trash: ${options.cardId}`);
    boardId = SHARE_BOARD_ID;
    workspace.createBoard({ id: SHARE_BOARD_ID, name: SHARE_BOARD_NAME });
    copied.add(card.id);
  } else {
    const board = source.getBoard(options.boardId);
    if (!board) throw new Error(`Unknown board: ${options.boardId}`);
    boardId = board.id;
    copyEntry(
      source.doc.getMap(WorkspaceDocument.BOARDS_KEY),
      doc.getMap(WorkspaceDocument.BOARDS_KEY),
      board.id,
    );
    const selected = options.scope === "selection" ? new Set(options.cardIds) : undefined;
    for (const card of source.listBoardCards(board.id)) {
      if (selected && !selected.has(card.id)) continue;
      copied.add(card.id);
    }
    placements = source
      .listBoardPlacements(board.id)
      .filter((placement) => copied.has(placement.cardId));
    const sections = source.listSections(board.id);
    const keptSections = selected ? selectionSections(placements, sections) : sections;
    for (const section of keptSections) {
      copyEntry(
        source.doc.getMap(WorkspaceDocument.SECTIONS_KEY),
        doc.getMap(WorkspaceDocument.SECTIONS_KEY),
        section.id,
      );
    }
  }

  copyCards(source, doc, copied);

  if (options.scope === "card") {
    for (const cardId of copied) workspace.placeCard(boardId, cardId, { x: 0, y: 0 });
  } else {
    const sourcePlacements = source.doc.getMap(WorkspaceDocument.PLACEMENTS_KEY);
    const targetPlacements = doc.getMap(WorkspaceDocument.PLACEMENTS_KEY);
    for (const placement of placements) {
      if (!copied.has(placement.cardId)) continue;
      copyEntry(
        sourcePlacements,
        targetPlacements,
        placementKey(placement.boardId, placement.cardId),
      );
    }
    const sourceEdges = source.doc.getMap(WorkspaceDocument.EDGES_KEY);
    const targetEdges = doc.getMap(WorkspaceDocument.EDGES_KEY);
    for (const edge of source.listBoardEdges(boardId)) {
      if (!copied.has(edge.source) || !copied.has(edge.target)) continue;
      copyEntry(sourceEdges, targetEdges, edge.id);
    }
  }

  workspace.ensureReferences();

  const references = collectReferences(source, copied, options.scope === "board");
  writeReferenceTitleStubs(workspace, references, copied);

  doc.commit({ origin: PROJECTION_ORIGIN });

  return { workspace, references };
}

/** Origin of the writes that replace a live projection with a fresh rebuild. */
export const PROJECTION_APPLY_ORIGIN = "sys:projection-apply";

/** Root maps a projection owns; a rebuild replaces every one of them. */
const PROJECTION_ROOTS = [
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
] as const;

/**
 * Rewrites a map from scratch. `clear()` first frees every key, so a rebuild
 * can never leave an entry of the previous projection behind; `ensureMergeable*`
 * may hand back the container the clear just detached, so each child is cleared
 * before it is filled.
 */
function overwriteMap(source: LoroMap, target: LoroMap): void {
  target.clear();
  for (const [key, value] of source.entries()) {
    if (isMap(value)) {
      overwriteMap(value, target.ensureMergeableMap(key));
      continue;
    }
    if (isList(value)) {
      overwriteList(value, target.ensureMergeableList(key));
      continue;
    }
    if (isText(value)) {
      overwriteText(value, target.ensureMergeableText(key));
      continue;
    }
    if (isScalar(value)) target.set(key, value);
  }
}

/** List items are re-created in order; the old items are gone after `clear()`. */
function overwriteList(source: LoroList, target: LoroList): void {
  target.clear();
  source.toArray().forEach((value, index) => {
    if (isMap(value)) {
      overwriteMap(value, target.insertContainer(index, new LoroMap()));
      return;
    }
    if (isList(value)) {
      overwriteList(value, target.insertContainer(index, new LoroList()));
      return;
    }
    if (isText(value)) {
      overwriteText(value, target.insertContainer(index, new LoroText()));
      return;
    }
    if (isScalar(value)) target.insert(index, value);
  });
}

/** Deletes the old text before applying the delta so no stale mark survives. */
function overwriteText(source: LoroText, target: LoroText): void {
  if (target.length > 0) target.delete(0, target.length);
  const delta = source.toDelta();
  if (delta.length > 0) target.applyDelta(delta);
}

/**
 * Replaces a live projection document with a freshly built one, in place.
 *
 * A share room keeps one document for the life of the room, so its peer id stays
 * the same across rebuilds and each rebuild's writes win against the previous
 * ones. Everything the projection owns is cleared and rewritten, including the
 * nested containers rich text and field options live in; the source document is
 * only read. All writes land in a single commit so viewers never observe a
 * half-cleared workspace.
 */
export function applyProjection(target: WorkspaceDocument, source: WorkspaceDocument): void {
  for (const key of PROJECTION_ROOTS) {
    overwriteMap(source.doc.getMap(key), target.doc.getMap(key));
  }
  target.doc.commit({ origin: PROJECTION_APPLY_ORIGIN });
}
