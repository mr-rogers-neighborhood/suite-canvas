import { LoroDoc } from "loro-crdt";
import { placementKey, WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import type { Placement, Section } from "../schema.js";
import { cardAnchor, sectionsAt } from "../sections.js";

import { copyEntry, copyMeta } from "./containers.js";
import { collectReferences, copyCards, writeReferenceTitleStubs } from "./references.js";

/**
 * Owns building the projected document: the scope a share covers, the cards and
 * sections it copies, and the references it reports as private.
 */

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
